import { parseArgs } from 'node:util';
import { outboxFor } from '../api/outbox.js';
import { localOrigin, readSettings } from '../config/settings.js';
import { readEnvironment } from '../environment/read.js';
import { confirm } from '../io.js';
import { requireRepoLink } from '../repo/link.js';
import {
  addPackages,
  portSketch,
  pullAdvice,
  pullPlanFor,
  pullSketch,
  sketchFiles,
  sketchReferenceDir
} from '../runs/pull.js';
import { requireApi, type Command } from './context.js';
import { devUrl } from './done.js';
import { launchRuns } from './run.js';
import { chooseAgent, parseComponent, parseIteration } from './shared.js';

export const pull: Command = {
  name: 'pull',
  summary:
    'Bring a web sketch into rough/ as a new local iteration, copied or ported into this stack, or list what there is',
  usage:
    'pull <page>/<component>[/<sketch>] [--port] [--add] [--agent <id>] [--model <name>] [--headless]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        port: { type: 'boolean', default: false },
        add: { type: 'boolean', default: false },
        agent: { type: 'string' },
        model: { type: 'string' },
        headless: { type: 'boolean', default: false },
        'dev-url': { type: 'string' }
      }
    });
    const named = positionals[0] ?? '';
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const api = await requireApi(context);

    if (named.split('/').length < 3) {
      const { page, component } = parseComponent(named);
      const sketches = await api.sketches(link.orgId, link.project, page, component);
      if (!sketches.length) {
        io.out(`${page}/${component} has no web sketches to pull.`);
        return 0;
      }
      io.out(`Web sketches of ${page}/${component}, newest first:`);
      const width = Math.max(...sketches.map(sketch => sketch.id.length));
      for (const sketch of sketches) {
        const status = sketch.status === 'exploring' ? '' : ` (${sketch.status})`;
        io.out(`  ${sketch.id.padEnd(width)}  ${sketch.name}${status}`);
      }
      io.out(`Pull one with roughbook pull ${page}/${component}/<sketch>.`);
      return 0;
    }

    const { page, component, iteration } = parseIteration(named);
    const target = { page, component, sketch: iteration };
    // The sketch's files first, so the plan is made before anything is allocated (F7).
    const files = await sketchFiles(api, link, target);
    let plan = await pullPlanFor(repoRoot, link, files);
    let how = values.port ? 'port' : plan.how;
    if (how === 'port' && !values.port && plan.add) {
      // Only packages this app does not list stand between a port and a copy: the designer may
      // add them, and nothing is added without a yes.
      for (const line of plan.why) io.out(line);
      const approved =
        values.add ||
        (await confirm(
          io,
          `Add ${plan.missingPackages.join(', ')} to this app with "${plan.add}" and copy the sketch as it is? Otherwise your agent ports it into this app's own components.`,
          false
        ));
      if (approved) {
        io.out(`Running ${plan.add}`);
        const added = await (context.addPackages ?? addPackages)(repoRoot, plan.add);
        if (!added.ok) {
          const tail = added.output.trim().split('\n').slice(-5);
          for (const line of tail) io.err(`  ${line}`);
          throw new Error(
            `${plan.add} did not finish. Add the packages by hand and pull again, or port the sketch with roughbook pull ${named} --port.`
          );
        }
        plan = await pullPlanFor(repoRoot, link, files);
        how = plan.how;
      }
    } else if (how === 'port') {
      for (const line of values.port ? [] : plan.why) io.out(line);
    }

    if (how === 'copy') {
      const pulled = await pullSketch(repoRoot, api, link, target, {
        assetOrigin: localOrigin(await readSettings(context.configDir))
      });
      const count = pulled.files.length;
      io.out(
        `${page}/${component}/${pulled.iteration}: ${pulled.folder}, from the web sketch ${pulled.parent} (${count} file${count === 1 ? '' : 's'})`
      );
      for (const line of pullAdvice(pulled)) io.out(line);
      io.out(
        `Review it in roughbook start, or refine it: roughbook run ${page}/${component} --refine ${pulled.iteration} --intent "<what to change>"`
      );
      return 0;
    }

    // A port: a pull run, whose agent rebuilds the sketch in this repo's stack.
    const environment = await readEnvironment(repoRoot, link);
    const { adapter, detection } = await chooseAgent(context, values.agent);
    if (values.headless && !detection.headless.ready) throw new Error(detection.headless.reason);
    const dev = devUrl(values['dev-url'], context.env, environment.start.url);
    const outbox = outboxFor(repoRoot);
    await outbox.flush(api);
    io.out(
      `Porting ${iteration} into this repo's stack: your agent rebuilds it from the sketch's files, kept as a reference in ${sketchReferenceDir(page, component, iteration)}/.`
    );
    const runs = await portSketch(
      repoRoot,
      api,
      link,
      target,
      {
        agent: adapter.id,
        mode: adapter.kind === 'editor' ? 'editor' : values.headless ? 'headless' : 'interactive',
        files
      },
      { assetOrigin: localOrigin(await readSettings(context.configDir)), devUrl: dev }
    );
    return launchRuns(context, {
      adapter,
      detection,
      runs,
      model: values.model ?? null,
      headless: values.headless,
      devUrl: dev,
      screenshots: true,
      api,
      outbox,
      link
    });
  }
};
