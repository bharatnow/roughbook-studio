// An iteration that renders one of the app's own components as it is (decision 2 of the brownfield
// plan): for the module stacks, an entry that re-exports the real file's component as its default,
// beside the fixture. Doctor's map checks render each section and shared part through one, and B2's
// baselines are the same pointer, kept. A fork of the baseline (B3) copies the files instead, with
// the same entry pointed at the copy.
import path from 'node:path';
import type { MapComponent } from '../../map/types.js';
import {
  copiedFiles,
  layOut,
  localSpec,
  readAll,
  type AppCopy,
  type AppCopyInput
} from '../fromApp.js';

const MODULE = /\.(tsx|ts|jsx|js|mjs|mts)$/;
const EXPORT = /^(default|[A-Za-z_$][\w$]*)$/;

function reExport(exported: string, spec: string): string {
  return exported === 'default'
    ? `export { default } from ${JSON.stringify(spec)};`
    : `export { ${exported} as default } from ${JSON.stringify(spec)};`;
}

/** The pointer's files for a stack whose entry is a module and whose fixture is a JSON file. */
export function modulePointer(files: { entry: string; fixture: string | null }) {
  return (
    component: MapComponent,
    input: { iterationDir: string; fixture: string | null }
  ): Record<string, string> | null => {
    const source = component.files[0];
    if (!source || !MODULE.test(source) || !EXPORT.test(component.export)) {
      return null;
    }
    const relative = path.posix.relative(input.iterationDir, source).replace(MODULE, '');
    const spec = relative.startsWith('.') ? relative : `./${relative}`;
    return {
      [files.entry]: `// ${component.name}, as the app has it in ${source}: a pointer, never a copy.\n${reExport(component.export, spec)}\n`,
      ...(files.fixture && input.fixture !== null ? { [files.fixture]: input.fixture } : {})
    };
  };
}

/**
 * A fork's starting files for the module stacks: the component's files copied by their own names,
 * their relative imports rewritten, and the entry re-exporting the copy as the pointer re-exports
 * the real file. A default export whose file has the entry's name is the entry itself.
 */
export function moduleFromApp(files: { entry: string; fixture: string | null }) {
  return (component: MapComponent, input: AppCopyInput): AppCopy | null => {
    const source = component.files[0];
    if (!source || !MODULE.test(source) || !EXPORT.test(component.export)) return null;
    const texts = readAll(component, input);
    if (!texts) return null;
    const own =
      component.export === 'default' && path.posix.basename(source) === files.entry
        ? { [source]: files.entry }
        : {};
    const copies = layOut(
      component.files,
      [files.entry, ...(files.fixture ? [files.fixture] : [])],
      own
    );
    const copied = copiedFiles(texts, copies, input.iterationDir);
    const copy = copies[source]!;
    return {
      files: {
        ...copied,
        ...(copy === files.entry
          ? {}
          : {
              [files.entry]: `// ${component.name}, copied from ${source}: this iteration changes the copy, ${copy}.\n${reExport(component.export, localSpec(copy))}\n`
            }),
        ...(files.fixture && input.fixture !== null ? { [files.fixture]: input.fixture } : {})
      },
      copies
    };
  };
}
