import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { Failure, get } from './api';
import type { Component, Page, ProjectView, RunView, StudioState, TerminalInfo } from './types';

type Notice = { tone: 'error' | 'info'; text: string } | null;

type StudioData = {
  state: StudioState | null;
  project: ProjectView | null;
  runs: RunView[];
  terminals: TerminalInfo[];
  /** The runs and terminals have been read once, so a session seen after is a new one. */
  runsReady: boolean;
  /** Why the project could not be read, such as the server being out of reach. */
  problem: string | null;
  notice: Notice;
  say(notice: Notice): void;
  refresh(): Promise<void>;
  refreshRuns(): Promise<void>;
  refreshState(): Promise<void>;
};

const Context = createContext<StudioData | null>(null);

export function useStudio(): StudioData {
  const data = useContext(Context);
  if (!data) throw new Error('useStudio outside StudioDataProvider');
  return data;
}

/** Turns a failed call into words for the notice bar. */
export function describe(error: unknown): string {
  if (error instanceof Failure) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Whether the page can be seen: false in a background tab or a minimised window. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export function StudioDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState | null>(null);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [runsReady, setRunsReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refreshState = useCallback(async () => {
    try {
      setState(await get<StudioState>('/api/state'));
    } catch (error) {
      setProblem(describe(error));
    }
  }, []);

  /** `fresh` when the designer came back to the page, so the server asks the backend again. */
  const refreshProject = useCallback(async (fresh = false) => {
    try {
      setProject(await get<ProjectView>(fresh ? '/api/project?fresh' : '/api/project'));
      setProblem(null);
    } catch (error) {
      setProblem(describe(error));
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      const [nextRuns, nextTerminals] = await Promise.all([
        get<RunView[]>('/api/runs'),
        get<TerminalInfo[]>('/api/terminals')
      ]);
      setRuns(nextRuns);
      setTerminals(nextTerminals);
      setRunsReady(true);
    } catch {
      // The next tick tries again; the project read reports the problem.
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshProject(), refreshRuns(), refreshState()]);
  }, [refreshProject, refreshRuns, refreshState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Runs change while an agent works: often while one is open, rarely otherwise. The project is
  // the local server's copy of the backend's, so asking for it here is cheap: the server decides
  // when to ask the backend again (src/server/projectCache.ts). A hidden page asks for nothing.
  const visible = usePageVisible();
  const anyOpen = runs.some(run => run.status === 'started');
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => void refreshRuns(), anyOpen ? 2000 : 10_000);
    return () => window.clearInterval(timer);
  }, [visible, anyOpen, refreshRuns]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => void refreshProject(), anyOpen ? 5000 : 20_000);
    return () => window.clearInterval(timer);
  }, [visible, anyOpen, refreshProject]);

  // Coming back from the terminal, the editor or the web: what changed meanwhile.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'hidden') return;
      void Promise.all([refreshProject(true), refreshRuns(), refreshState()]);
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [refreshProject, refreshRuns, refreshState]);

  const value = useMemo<StudioData>(
    () => ({
      state,
      project,
      runs,
      terminals,
      runsReady,
      problem,
      notice,
      say: setNotice,
      refresh,
      refreshRuns,
      refreshState
    }),
    [
      state,
      project,
      runs,
      terminals,
      runsReady,
      problem,
      notice,
      refresh,
      refreshRuns,
      refreshState
    ]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The page and component a screen is about, from the project. */
export function findComponent(
  project: ProjectView | null,
  page: string,
  component: string
): { page: Page; component: Component } | null {
  const foundPage = project?.tree.pages.find(item => item.slug === page);
  const found = foundPage?.components.find(item => item.slug === component);
  return foundPage && found ? { page: foundPage, component: found } : null;
}

/** The component's iterations that are in this repo, in number order. */
export function localIterations(project: ProjectView, page: string, component: Component) {
  const here = new Set(project.local.iterations);
  return component.iterations
    .filter(item => here.has(`${page}/${component.slug}/${item.id}`))
    .sort((a, b) => a.number - b.number);
}
