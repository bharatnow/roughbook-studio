import {
  AppPreview,
  IterationNotesForm,
  RatingForm,
  RejectDrawer,
  ReviewButton,
  SelectConfirmDrawer,
  Stage,
  describeIterationState,
  describeRating,
  latestHumanReview,
  reviewSummary
} from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { iterationPath, post, screenshotUrl } from '../api';
import { describe, findComponent, useStudio } from '../data';
import { useRatings } from '../parts/ratings';
import { RefineDrawer, useReviews } from '../parts/refine';
import { RunCard } from '../parts/run-card';

const action =
  'inline-flex h-9 items-center gap-2 rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist hover:bg-frost';

/**
 * The desktop screenshot, fetched with the token, for when the dev server is not answering;
 * fetched again when `version` changes, after the screenshots were taken again.
 */
function useScreenshot(
  page: string,
  component: string,
  iteration: string,
  taken: boolean,
  version: number
) {
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
  }, [page, component, iteration, taken, version]);
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
  const { state, project, runs, refresh, say } = useStudio();
  const [selectOpen, setSelectOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(refine);
  const [shooting, setShooting] = useState(false);
  const [shotVersion, setShotVersion] = useState(0);
  const key = `${page}/${component}/${id}`;
  const taken = Boolean(project?.local.screenshots[key]?.length);
  const shot = useScreenshot(page, component, id, taken, shotVersion);
  const reviews = useReviews(page, component, id);
  const rating = useRatings(page, component)[id] ?? null;
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

  async function takeScreenshots() {
    setShooting(true);
    try {
      const shots = await post<{ files: Record<string, string>; warning: string | null }>(
        `${iterationPath(page, component, id)}/screenshots`
      );
      say(
        shots.warning
          ? { tone: 'error', text: shots.warning }
          : { tone: 'info', text: 'Took the desktop and phone screenshots.' }
      );
      setShotVersion(version => version + 1);
    } catch (error) {
      say({ tone: 'error', text: describe(error) });
    } finally {
      setShooting(false);
      await refresh();
    }
  }

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
            <RatingForm
              project={project.tree.slug}
              page={page}
              component={component}
              iterationId={id}
              rating={rating}
            />
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
            <div>
              <p className="font-mono text-[10px] tracking-[0.08em] text-steel uppercase">Rating</p>
              <p className="mt-1 text-xs text-slate">
                {describeRating(rating) ?? 'Not rated yet.'}
              </p>
            </div>
            {run ? (
              <div>
                <p className="font-mono text-[10px] tracking-[0.08em] text-steel uppercase">Run</p>
                <ul className="mt-1">
                  <RunCard run={run} />
                </ul>
              </div>
            ) : null}
            <div>
              <p className="font-mono text-[10px] tracking-[0.08em] text-steel uppercase">
                Screenshots
              </p>
              <p className="mt-1 text-xs text-slate">
                {taken
                  ? 'Shown here when the dev server is not running.'
                  : 'None yet. They are shown here when the dev server is not running.'}
              </p>
              <button
                type="button"
                className={`${action} mt-2 disabled:opacity-50`}
                disabled={shooting}
                onClick={() => void takeScreenshots()}
              >
                {shooting ? 'Taking screenshots' : taken ? 'Take them again' : 'Take screenshots'}
              </button>
            </div>
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
        rating={rating?.mine ?? null}
      />
      <RejectDrawer
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        project={project.tree.slug}
        page={page}
        component={component}
        iterationId={id}
        rating={rating?.mine ?? null}
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
