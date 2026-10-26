// What the local UI's promote panel shows (B4), in @roughbook/ui's shapes (its promote-finish.ts):
// the drift known at the start, and what the finish found, from this machine's promotion record.
// The ui stays presentational; the words and the diff's text are made here.
import { unifiedText } from '../repo/diff.js';
import {
  describePromotion,
  type CommandRun,
  type FileDiff,
  type PromoteHow,
  type PromoteTarget,
  type PromotionRecord
} from '../runs/promotion.js';

/** @roughbook/ui's PromoteDrift. */
export type PromoteDriftView =
  | { state: 'in-place'; note?: string }
  | { state: 'merge'; files: string[]; note?: string }
  | { state: 'conflict'; conflicts: { path: string; where?: string }[]; note?: string };

/** @roughbook/ui's PromoteDiffFile. */
export type PromoteDiffFileView = {
  path: string;
  patch: string;
  status: 'modified' | 'added' | 'deleted';
  binary?: boolean;
};

/** @roughbook/ui's PromoteCheck. */
export type PromoteCheckView = {
  name: string;
  kind: 'build' | 'check';
  result: 'passed' | 'failed' | 'skipped';
  command: string;
  note?: string;
  output?: string;
};

/** @roughbook/ui's PromoteCommitResult. */
export type PromoteCommitView = { ok: boolean; message: string; commit?: string | null };

/** @roughbook/ui's PromoteFinish. */
export type PromoteFinishView = {
  outcome: 'done' | 'conflict' | 'out-of-scope' | 'failed';
  message?: string;
  drift?: PromoteDriftView | null;
  files: PromoteDiffFileView[];
  outOfScope: { path: string; reverted?: boolean }[];
  checks: PromoteCheckView[];
  branch?: string | null;
  commit?: PromoteCommitView | null;
};

/** The drift the start found, as the panel shows it before the promote; none for a new file. */
export function driftView(how: PromoteHow, targets: PromoteTarget[]): PromoteDriftView | null {
  if (how === 'new') return null;
  if (how === 'in-place') return { state: 'in-place' };
  return {
    state: 'merge',
    files: targets.filter(target => target.drifted).map(target => target.path)
  };
}

/** A check's name as a person says it, from its command. */
function checkName(command: string): string {
  if (/\btsc\b|type-?check/i.test(command)) return 'Type check';
  if (/\blint\b|eslint|pint|phpcs|ktlint|swiftlint|analy[sz]e/i.test(command)) return 'Lint';
  if (/\btest\b|vitest|jest|phpunit|pest|pytest/i.test(command)) return 'Tests';
  return command;
}

function checkView(run: CommandRun, kind: 'build' | 'check'): PromoteCheckView {
  return {
    name: kind === 'build' ? 'Build' : checkName(run.command),
    kind,
    result: run.result,
    command: run.command,
    ...(run.note ? { note: run.note } : {}),
    ...(run.tail.length ? { output: run.tail.join('\n') } : {})
  };
}

/** Each conflict the agent reported, by the target it names first, with its words. */
function conflictsView(record: PromotionRecord): { path: string; where?: string }[] {
  return (record.result?.conflicts ?? []).map(text => {
    const named = record.targets.find(target => text.includes(target.path));
    if (!named) return { path: text };
    const where = text
      .replace(named.path, '')
      .replace(/^[\s,:;-]+/, '')
      .trim();
    return where ? { path: named.path, where } : { path: named.path };
  });
}

/** What a finished promote shows in the panel: the diff, the scope, the checks and the commit. */
export function finishView(record: PromotionRecord, diffs: FileDiff[]): PromoteFinishView {
  const result = record.result!;
  const drift: PromoteDriftView | null =
    result.outcome === 'conflict'
      ? {
          state: 'conflict',
          conflicts: conflictsView(record),
          ...(result.conflicts.length
            ? {}
            : { note: 'The agent wrote nothing; where the changes conflict is in its report.' })
        }
      : driftView(record.how, record.targets);
  const commit: PromoteCommitView | null =
    record.commit?.state === 'committed'
      ? {
          ok: true,
          message: `Committed on ${record.branch!.name}. Nothing was pushed.`,
          commit: record.commit.sha
        }
      : record.commit?.state === 'declined'
        ? { ok: true, message: `Left uncommitted on ${record.branch!.name}.`, commit: null }
        : null;
  return {
    outcome: result.outcome,
    message: describePromotion(record)[0] ?? '',
    drift,
    files: diffs.map(diff => ({
      path: diff.path,
      patch: diff.hunks ? unifiedText(diff.path, diff.hunks) : '',
      status:
        diff.status === 'added' ? 'added' : diff.status === 'removed' ? 'deleted' : 'modified',
      ...(diff.hunks === null ? { binary: true } : {})
    })),
    outOfScope: result.outOfScope.map(file => ({
      path: file,
      ...(record.putBack?.includes(file) ? { reverted: true } : {})
    })),
    checks: [
      ...(result.build ? [checkView(result.build, 'build')] : []),
      ...result.checks.map(run => checkView(run, 'check'))
    ],
    branch: record.commit ? record.branch!.name : null,
    commit
  };
}
