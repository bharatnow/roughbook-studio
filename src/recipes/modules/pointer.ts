// An iteration that renders one of the app's own components as it is (decision 2 of the brownfield
// plan): for the module stacks, an entry that re-exports the real file's component as its default,
// beside the fixture. Doctor's map checks render each section and shared part through one, and B2's
// baselines are the same pointer, kept.
import path from 'node:path';
import type { MapComponent } from '../../map/types.js';

const MODULE = /\.(tsx|ts|jsx|js|mjs|mts)$/;

/** The pointer's files for a stack whose entry is a module and whose fixture is a JSON file. */
export function modulePointer(files: { entry: string; fixture: string | null }) {
  return (
    component: MapComponent,
    input: { iterationDir: string; fixture: string | null }
  ): Record<string, string> | null => {
    const source = component.files[0];
    if (!source || !MODULE.test(source) || !/^(default|[A-Za-z_$][\w$]*)$/.test(component.export)) {
      return null;
    }
    const relative = path.posix.relative(input.iterationDir, source).replace(MODULE, '');
    const spec = relative.startsWith('.') ? relative : `./${relative}`;
    const line =
      component.export === 'default'
        ? `export { default } from ${JSON.stringify(spec)};`
        : `export { ${component.export} as default } from ${JSON.stringify(spec)};`;
    return {
      [files.entry]: `// ${component.name}, as the app has it in ${source}: a pointer, never a copy.\n${line}\n`,
      ...(files.fixture && input.fixture !== null ? { [files.fixture]: input.fixture } : {})
    };
  };
}
