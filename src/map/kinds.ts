// Atoms told apart from sections (decision 5 of the brownfield plan): buttons, inputs, icons and
// badges are the design system's, listed in the map but never cards. A component is an atom by
// where it lives (a ui/ or icons/ folder, as shadcn/ui and atomic design put them) or by what it
// is called, whoever renders it.

const ATOM_FOLDERS = new Set([
  'ui',
  'atoms',
  'atom',
  'primitives',
  'primitive',
  'icons',
  'icon',
  'svg',
  'svgs',
  'shadcn',
  'elements'
]);

const ATOM_NAME =
  /^(?:Themed|Base|App|Ui|UI)?(?:Button|IconButton|Btn|Input|TextInput|TextField|Textarea|TextArea|Select|Option|Checkbox|CheckBox|Radio|RadioGroup|Switch|Toggle|Slider|Label|Badge|Chip|Tag|Pill|Avatar|Icon|Spinner|Loader|Skeleton|Separator|Divider|Tooltip|Kbd|Logo|Link|NavLink|Image|Img|Picture|Typography|Text|Heading|Title|Paragraph|View|Toaster|Toast|Portal|Spacer|Stack|Box|Flex|Grid|Container|Collapsible)$|Icon$|^Icon[A-Z]|(Loader|Loading|Spinner|Skeleton|Field|Fields|Picker|Select|Input)$/;

/** Whether a component is an atom, by its file's folders or its name. */
export function isAtom(file: string, name: string): boolean {
  const folders = file.split('/').slice(0, -1);
  return folders.some(folder => ATOM_FOLDERS.has(folder.toLowerCase())) || ATOM_NAME.test(name);
}

/** Folders whose files are tests, stories or tooling, never the app's components. */
export const NOT_COMPONENT_FOLDERS = new Set([
  '__tests__',
  '__mocks__',
  'test',
  'tests',
  'e2e',
  'cypress',
  'playwright',
  '.storybook',
  'scripts'
]);

/** Whether a file is a test, a story or a type declaration, never one of the app's components. */
export function isToolingFile(file: string): boolean {
  const name = file.split('/').at(-1)!;
  return (
    /\.(stories|story|test|spec|cy)\.[^.]+$/.test(name) ||
    name.endsWith('.d.ts') ||
    file.split('/').some(folder => NOT_COMPONENT_FOLDERS.has(folder))
  );
}
