import { parseArgs } from 'node:util';
import { localOrigin, readSettings } from '../config/settings.js';
import { requireRepoLink } from '../repo/link.js';
import { pullAdvice, pullSketch } from '../runs/pull.js';
import { requireApi, type Command } from './context.js';
import { parseComponent, parseIteration } from './shared.js';

export const pull: Command = {
  name: 'pull',
  summary: 'Bring a web sketch into rough/ as a new local iteration, or list what there is',
  usage: 'pull <page>/<component>[/<sketch>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
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
    const pulled = await pullSketch(
      repoRoot,
      api,
      link,
      { page, component, sketch: iteration },
      { assetOrigin: localOrigin(await readSettings(context.configDir)) }
    );
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
};
