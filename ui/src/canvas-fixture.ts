// A project for the canvas's tests: two pages, a component with every kind of card, and the runs
// the local server would list beside it.
import type { Iteration, ProjectView, RunView } from './types.ts';

const FEEDBACK = {
  likes: [],
  dislikes: [],
  selectionReason: '',
  rejectionReason: '',
  designerNotes: ''
};

export function iteration(id: string, extra: Partial<Iteration> = {}): Iteration {
  return {
    id,
    number: Number(id.slice('iteration-'.length)),
    name: `Direction ${id.slice(-2)}`,
    status: 'exploring',
    parent: null,
    direction: '',
    hypothesis: '',
    tags: [],
    methods: [],
    metaMissing: false,
    generation: { mode: 'manual' },
    // An hour apart, in number order, all before the runs below.
    created: new Date(Date.UTC(2026, 9, 1, Number(id.slice(-2)))).toISOString(),
    origin: 'local',
    refinement: null,
    feedback: FEEDBACK,
    ...extra
  };
}

export const PROJECT: ProjectView = {
  tree: {
    slug: 'site',
    name: 'Site',
    delivery: { componentsDir: 'src/components', publicDir: 'public' },
    pages: [
      {
        slug: 'home',
        name: 'Home',
        components: [
          {
            slug: 'hero',
            name: 'Hero',
            status: 'active',
            brief: '',
            userQuestion: '',
            messages: { primary: '', supporting: [] },
            selectedIteration: 1,
            copy: { versions: [], approved: null },
            promotions: [{ iteration: 'iteration-01', file: 'src/components/Hero.tsx', at: 'x' }],
            iterations: [
              // Selected, here, with screenshots.
              iteration('iteration-01'),
              // Here, pulled from the web sketch iteration-41; no screenshots yet.
              iteration('iteration-02', { parent: 'iteration-41' }),
              // A fork of iteration-01 an agent is making now.
              iteration('iteration-03', {
                parent: 'iteration-01',
                generation: { mode: 'pending' }
              }),
              // Made in another designer's studio: its code is in their repo.
              iteration('iteration-05'),
              // Here, and turned down.
              iteration('iteration-06', { status: 'rejected' }),
              // A web sketch, not pulled.
              iteration('iteration-40', { origin: 'sketch', generation: { mode: 'sketch' } }),
              // A web sketch pulled as iteration-02.
              iteration('iteration-41', { origin: 'sketch', generation: { mode: 'sketch' } }),
              // A web sketch the web is still making.
              iteration('iteration-42', { origin: 'sketch', generation: { mode: 'pending' } })
            ]
          },
          {
            slug: 'features',
            name: 'Features',
            status: 'active',
            brief: '',
            userQuestion: '',
            messages: { primary: '', supporting: [] },
            selectedIteration: null,
            copy: { versions: [], approved: null },
            promotions: [],
            iterations: []
          }
        ]
      },
      {
        slug: 'about',
        name: 'About',
        components: [
          {
            slug: 'team',
            name: 'Team',
            status: 'active',
            brief: '',
            userQuestion: '',
            messages: { primary: '', supporting: [] },
            selectedIteration: null,
            copy: { versions: [], approved: null },
            promotions: [],
            // An older backend: no origin, so a finished web sketch is told by its mode.
            iterations: [
              iteration('iteration-01', { origin: undefined }),
              iteration('iteration-02', { origin: undefined, generation: { mode: 'sketch' } })
            ]
          }
        ]
      }
    ]
  },
  local: {
    iterations: [
      'home/hero/iteration-01',
      'home/hero/iteration-02',
      'home/hero/iteration-03',
      'home/hero/iteration-06',
      'home/hero/iteration-08',
      'about/team/iteration-01'
    ],
    screenshots: { 'home/hero/iteration-01': ['desktop', 'phone'] }
  }
};

function run(runId: string, extra: Partial<RunView>): RunView {
  return {
    runId,
    page: 'home',
    component: 'hero',
    iteration: 'iteration-00',
    parent: null,
    kind: 'generate',
    agent: 'claude-code',
    mode: 'interactive',
    promptFile: `rough/home/hero/prompts/${runId}.md`,
    startedAt: '2026-10-15T09:00:00.000Z',
    status: 'started',
    finishedAt: null,
    outcome: null,
    failure: null,
    warnings: [],
    outOfScope: [],
    reported: null,
    terminal: null,
    headless: null,
    ...extra
  };
}

export const TERMINAL = {
  id: '11111111-1111-4111-8111-111111111111',
  runId: 'run-fork',
  title: 'home/hero/iteration-03',
  status: 'running' as const,
  exitCode: null,
  stopped: false,
  startedAt: '2026-10-15T10:00:00.000Z'
};

/** Newest first, as the local server lists them. */
export const RUNS: RunView[] = [
  // A new direction, started a moment ago: the project read has not caught up with it.
  run('run-new', {
    iteration: 'iteration-08',
    startedAt: '2026-10-15T10:05:00.000Z'
  }),
  // The fork of iteration-01 being made, in the built-in terminal.
  run('run-fork', {
    iteration: 'iteration-03',
    parent: 'iteration-01',
    kind: 'fork',
    startedAt: '2026-10-15T10:00:00.000Z',
    terminal: TERMINAL
  }),
  // A run that failed before its iteration was recorded.
  run('run-failed', {
    iteration: 'iteration-07',
    parent: 'iteration-01',
    kind: 'refine',
    startedAt: '2026-10-14T10:00:00.000Z',
    status: 'finished',
    finishedAt: '2026-10-14T10:10:00.000Z',
    outcome: 'failed'
  }),
  // The run that made iteration-01, long finished.
  run('run-first', {
    iteration: 'iteration-01',
    startedAt: '2026-10-01T10:00:00.000Z',
    status: 'finished',
    finishedAt: '2026-10-01T10:30:00.000Z',
    outcome: 'completed',
    finishedBy: 'local-ui'
  })
];
