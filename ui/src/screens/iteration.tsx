import {
  AppPreview,
  IterationNotesForm,
  RejectDrawer,
  ReviewButton,
  SelectConfirmDrawer,
  Stage,
  describeIterationState,
  latestHumanReview,
  reviewSummary
} from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { screenshotUrl } from '../api';
import { findComponent, useStudio } from '../data';
import { RefineDrawer, useReviews } from '../parts/refine';
import { RunCard } from '../parts/run-card';

const action =
  'inline-flex h-9 items-center gap-2 rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist hover:bg-frost';

/** The desktop screenshot, fetched with the token, for when the dev server is not answering. */
function useScreenshot(page: string, component: string, iteration: string, taken: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!taken) return;
    let made: string | null = null;
    let live = true;
    void screenshotUrl(page, component, iteration, 'desktop').then(next => {
      made = next;
      if (live) setUrl(next);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [page, component, iteration, taken]);
  return url;
}

export function IterationScreen({
  page,
  component,
  iteration: id,
  refine
}: {
  page: string;
  component: string;
  iteration: string;
  refine: boolean;
}) {
  const { state, project, runs } = useStudio();
  const [selectOpen, setSelectOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(refine);
  const key = `${page}/${component}/${id}`;
  const shot = useScreenshot(page, component, id, Boolean(project?.local.screenshots[key]?.length));
  const reviews = useReviews(page, component, id);
  useEffect(() => setRefineOpen(refine), [refine]);

  const found = findComponent(project, page, component);
  const iteration = found?.component.iterations.find(item => item.id === id);
  if (!project || !state) return <p className="text-sm text-slate">Loading…</p>;
  if (!found || !iteration || !project.local.iterations.includes(key)) {
    return <p className="text-sm text-slate">{key} is not in this repo.</p>;
  }

  const record = found.component;
  const base = `/${page}/${component}`;
  const selected = iteration.number === record.selectedIteration;
  const run = runs.find(
    item => item.page === page && item.component === component && item.iteration === id
  );
  const target = { project: project.tree.slug, page, component, iterationId: id };

  return (
    <>
      <Stage
        backHref={`${base}/iterations`}
        backLabel={`${record.name} iterations`}
        kicker={`${record.name} / ${id}`}
        title={iteration.name}
        note={[iteration.direction, describeIterationState(iteration)].filter(Boolean).join(' · ')}
        relativePath={`rough/${page}/${component}/${id}`}
        source={{
          editorHref: null,
          viewHref: null,
          editorUnavailable: 'Open it from the repo in your editor.'
        }}
        parentHref={iteration.parent ? `${base}/${iteration.parent}` : null}
        parentLabel={iteration.parent ? `From ${iteration.parent}` : null}
        selected={selected}
        extraActions={
          <>
            <button type="button" className={action} onClick={() => setSelectOpen(true)}>
              {selected ? 'Selected' : 'Select'}
            </button>
            <button type="button" className={action} onClick={() => setRejectOpen(true)}>
              Reject
            </button>
            <button type="button" className={action} onClick={() => setRefineOpen(true)}>
              Refine
            </button>
            <ReviewButton
              target={target}
              reviews={reviews}
              feedback={iteration.feedback}
              critiquePrompt=""
              refineHref={`${base}/${id}?refine=1`}
            />
          </>
        }
        inspector={
          <div className="flex flex-col gap-5 text-sm">
            {iteration.hypothesis ? (
              <div>
                <p className="font-mono text-[10px] tracking-[0.08em] text-steel uppercase">
                  Tests
                </p>
                <p className="mt-1 text-graphite">{iteration.hypothesis}</p>
              </div>
            ) : null}
            {run ? (
              <div>
                <p className="font-mono text-[10px] tracking-[0.08em] text-steel uppercase">Run</p>
                <ul className="mt-1">
                  <RunCard run={run} />
                </ul>
              </div>
            ) : null}
            <div>
              <p className="font-mono text-[10px] tracking-[0.08em] text-steel uppercase">Notes</p>
              <div className="mt-1">
                <IterationNotesForm
                  project={project.tree.slug}
                  page={page}
                  component={component}
                  iterationId={id}
                  designerNotes={iteration.feedback.designerNotes}
                />
              </div>
            </div>
            {reviewSummary(latestHumanReview(reviews)) ? (
              <p className="text-xs text-slate">
                Your latest review: {reviewSummary(latestHumanReview(reviews))}
              </p>
            ) : null}
          </div>
        }
      >
        <AppPreview
          src={`${state.devUrl}/rough-preview/${key}`}
          previewKey={key}
          devUrl={state.devUrl}
          screenshotUrl={shot}
          commit={null}
          syncedAt={null}
        />
      </Stage>

      <SelectConfirmDrawer
        open={selectOpen}
        onClose={() => setSelectOpen(false)}
        project={project.tree.slug}
        page={page}
        component={component}
        iterationId={id}
        number={iteration.number}
        componentName={record.name}
        selected={selected}
        latestReviewSummary={reviewSummary(latestHumanReview(reviews))}
      />
      <RejectDrawer
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        project={project.tree.slug}
        page={page}
        component={component}
        iterationId={id}
      />
      <RefineDrawer
        open={refineOpen}
        onClose={() => setRefineOpen(false)}
        page={page}
        component={component}
        parent={id}
        parentName={iteration.name}
        feedback={iteration.feedback}
      />
    </>
  );
}
