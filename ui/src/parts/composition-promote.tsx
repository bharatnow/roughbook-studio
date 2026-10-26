import {
  HelpTip,
  InteractiveResultPanel,
  PromoteBranchChoice,
  PromoteDriftNote,
  PromoteFinishView,
  branchNameProblem,
  useUiHost,
  type PromoteFinish,
  type PromoteResult
} from '@roughbook/ui';
import { SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import { post } from '../api';
import { describe } from '../data';
import type { PromotePlan } from './promote-plan';

/** The folder a page's compositions are in, which names a composition's promote here. */
const COMPOSITIONS = 'compositions';

/**
 * A page composition's Promote (B6 of the brownfield plan), from B4's panel parts: what it writes
 * (the page's files and each new section's file), whether the page moved since it was saved, the
 * sections that keep the app's own version, the branch choice, then Finish with the diff, the
 * scope, the checks and the commit. The promote goes to the designer's agent, as a component's.
 */
export function CompositionPromote({
  project,
  page,
  id,
  plan,
  agentName,
  onChanged
}: {
  project: string;
  page: string;
  id: string;
  plan: PromotePlan | null;
  agentName: string;
  onChanged?: () => void;
}) {
  const { actions } = useUiHost();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PromoteResult | null>(null);
  const [onBranch, setOnBranch] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState<PromoteFinish | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const target = { project, page, component: COMPOSITIONS, iteration: id };
  const branchOffered = Boolean(plan?.branchChoice) && !plan?.branchChoice.unavailable;
  const branch = branchName ?? plan?.branchChoice.defaultName ?? `roughbook/${page}-${id}`;
  const branching = branchOffered && onBranch;
  const shownFinish = finished ?? plan?.finish ?? null;
  const open = plan?.open && !result;

  async function promote() {
    setBusy(true);
    setFinished(null);
    setFinishError(null);
    try {
      setResult(
        await post<PromoteResult>('/api/promote', {
          page,
          composition: id,
          ...(branching ? { branch: branch.trim() } : {})
        }).catch((error): PromoteResult => ({
          ok: false,
          launched: false,
          message: describe(error),
          commands: [],
          assets: [],
          missingAssets: []
        }))
      );
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!actions.finishPromotion) return;
    setFinishing(true);
    setFinishError(null);
    try {
      setFinished(await actions.finishPromotion(target));
      onChanged?.();
    } catch (caught) {
      setFinishError(
        caught instanceof Error ? caught.message : 'The promote could not be finished.'
      );
    } finally {
      setFinishing(false);
    }
  }

  const pageFiles = (plan?.targets ?? []).filter(item => !item.section);
  const newFiles = (plan?.targets ?? []).filter(item => item.section);
  return (
    <section id="promote" className="flex min-w-0 flex-col gap-3">
      <h2 className="font-display text-base tracking-tight text-graphite">Promote</h2>
      <p className="text-sm text-slate">
        Hands the composition to {agentName}, which arranges the page’s own files in its order
        {newFiles.length ? ' and writes each new section’s file' : ''}, and changes nothing else.
      </p>
      {plan?.problem ? (
        <p role="alert" className="text-sm text-danger">
          {plan.problem}
        </p>
      ) : null}
      {plan?.drift && !shownFinish ? <PromoteDriftNote drift={plan.drift} /> : null}
      {pageFiles.length || newFiles.length ? (
        <ul className="flex flex-col gap-1 text-sm text-graphite">
          {pageFiles.map(item => (
            <li key={item.path} className="font-mono text-xs">
              {item.path}
            </li>
          ))}
          {newFiles.map(item => (
            <li key={item.path} className="font-mono text-xs">
              + {item.path}{' '}
              <span className="font-sans text-steel">({item.section!.name}, a new section)</span>
            </li>
          ))}
        </ul>
      ) : null}
      {plan?.keepsApp?.length ? (
        <div className="flex items-start gap-1 text-sm text-slate">
          <p>
            {plan.keepsApp.map(item => item.name).join(', ')}{' '}
            {plan.keepsApp.length === 1 ? 'keeps' : 'keep'} the app’s own version here.
          </p>
          <HelpTip label="About sections that keep the app's version">
            A section’s own design ships through its own promote:{' '}
            {plan.keepsApp
              .map(
                item => `roughbook promote ${page}/${item.component} --iteration ${item.iteration}`
              )
              .join('; ')}
            .
          </HelpTip>
        </div>
      ) : null}
      {plan?.branchChoice ? (
        <PromoteBranchChoice
          checked={onBranch}
          onCheckedChange={setOnBranch}
          name={branch}
          onNameChange={setBranchName}
          unavailable={plan.branchChoice.unavailable}
          agentName={agentName}
        />
      ) : null}
      <div>
        <button
          type="button"
          onClick={() => void promote()}
          disabled={
            busy || Boolean(plan?.problem) || (branching && Boolean(branchNameProblem(branch)))
          }
          className="inline-flex h-9 items-center gap-2 rounded-control bg-violet px-3 text-sm text-white hover:bg-violet/90 disabled:opacity-50"
        >
          <SquareTerminal className="size-4" strokeWidth={1.5} />
          {busy ? 'Preparing' : `Promote in ${agentName}`}
        </button>
      </div>
      {result ? <InteractiveResultPanel result={result} /> : null}
      {(result?.ok || open) && actions.finishPromotion && !shownFinish ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void finish()}
              disabled={finishing}
              className="inline-flex h-9 items-center rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist disabled:opacity-50"
            >
              {finishing ? 'Finishing: running the checks' : 'Finish'}
            </button>
            <HelpTip label="About Finish">
              When {agentName} is done, Finish shows the diff, names any file changed outside the
              page’s files and its new sections’, and runs the app’s build and checks.
            </HelpTip>
          </div>
          {finishError ? (
            <p role="alert" className="text-sm text-danger">
              {finishError}
            </p>
          ) : null}
        </div>
      ) : null}
      {shownFinish ? (
        <PromoteFinishView target={target} finish={shownFinish} componentName="the page" />
      ) : null}
    </section>
  );
}
