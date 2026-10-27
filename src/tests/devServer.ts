// A Vite dev server as the in-page view's plugins see it (decision 61 of the brownfield plan): its
// watcher, its module graph, which keys files with forward slashes on every OS, and its socket.

export type FakeServer = ReturnType<typeof fakeServer>;

/** `modules` by id (a file with forward slashes, or a virtual id), each with its importers. */
export function fakeServer(modules: Record<string, { importers?: string[] }>) {
  const heard: ((event: string, file: string) => void)[] = [];
  const invalidated: string[] = [];
  const sent: unknown[] = [];
  const node = (id: string): { id: string; importers: Set<unknown> } => ({
    id,
    importers: new Set((modules[id]?.importers ?? []).map(node))
  });
  return {
    watcher: {
      add() {},
      on(_event: string, listener: (event: string, file: string) => void) {
        heard.push(listener);
      }
    },
    moduleGraph: {
      getModulesByFile: (file: string) => (modules[file] ? new Set([node(file)]) : undefined),
      getModuleById: (id: string) => (modules[id] ? node(id) : undefined),
      invalidateModule: (mod: { id: string }) => invalidated.push(mod.id)
    },
    ws: { send: (message: unknown) => sent.push(message) },
    /** The watcher hears a change to `file`, named as the OS names it. */
    change: (file: string) => heard.forEach(listener => listener('change', file)),
    invalidated,
    sent
  };
}
