import {
  AppPreview,
  GENERATION_STATE_LABELS,
  HelpTip,
  IterationInspector,
  IterationNotesForm,
  REFINEMENT_PRESETS,
  RatingForm,
  RejectDrawer,
  ReviewButton,
  SelectConfirmDrawer,
  Stage,
  decisionOf,
  describeIterationState,
  describeRating,
  generationStateOf,
  iterationStatusLabel,
  latestHumanReview,
  reviewSummary
} from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { iterationPath, post, screenshotUrl } from '../api';
import { describe, findComponent, useStudio } from '../data';
import { Missing } from '../parts/missing';
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

function presetLabel(preset: string): string {
  return REFINEMENT_PRESETS.find(item => item.value === preset)?.label ?? preset;
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
  if (!project || !state) return <Missing>Loading…</Missing>;
  if (!found || !iteration || !project.local.iterations.includes(key)) {
    return <Missing back>{key} is not in this repo.</Missing>;
  }

  const record = found.component;
  const base = `/${page}/${component}`;
  const selected = iteration.number === record.selectedIteration;
  const run = runs.find(
    item => item.page === page && item.component === component && item.iteration === id
  );
  const target = { project: project.tree.slug, page, component, iterationId: id };
  const parentHere = iteration.parent
    ? project.local.iterations.includes(`${page}/${component}/${iteration.parent}`)
    : false;
  const latestReview = reviewSummary(latestHumanReview(reviews));

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
        backHref={`${base}/iterations#${id}`}
        backLabel="Back to canvas"
        backOnEscape
        kicker={`${record.name} / ${id}`}
        title={iteration.name}
        note={[iteration.direction, describeIterationState(iteration)].filter(Boolean).join(' · ')}
        relativePath={`rough/${page}/${component}/${id}`}
        source={{
          editorHref: null,
          viewHref: null,
          editorUnavailable: 'Open it from the repo in your editor.'
        }}
        parentHref={iteration.parent && parentHere ? `${base}/${iteration.parent}` : null}
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
          <IterationInspector
            direction={iteration.direction}
            hypothesis={iteration.hypothesis}
            latestReview={latestReview}
            rating={describeRating(rating)}
            decision={iterationStatusLabel(decisionOf(iteration.status))}
            generation={GENERATION_STATE_LABELS[generationStateOf(iteration)]}
            created={iteration.created ?? null}
            tags={iteration.tags}
            methods={iteration.methods}
            refinement={
              iteration.refinement ? { preset: presetLabel(iteration.refinement.preset) } : null
            }
            parent={
              iteration.parent
                ? {
                    label: iteration.parent,
                    href: parentHere ? `${base}/${iteration.parent}` : null
                  }
                : null
            }
            whySelected={iteration.feedback.selectionReason}
            whyRejected={iteration.feedback.rejectionReason}
            likes={iteration.feedback.likes}
            dislikes={iteration.feedback.dislikes}
            controls={{
              notes: (
                <IterationNotesForm
                  project={project.tree.slug}
                  page={page}
                  component={component}
                  iterationId={id}
                  designerNotes={iteration.feedback.designerNotes}
                />
              ),
              madeBy: run ? <RunCard run={run} compact /> : null,
              screenshots: (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    className={`${action} disabled:opacity-50`}
                    disabled={shooting}
                    onClick={() => void takeScreenshots()}
                  >
                    {shooting
                      ? 'Taking screenshots'
                      : taken
                        ? 'Take them again'
                        : 'Take screenshots'}
                  </button>
                  <HelpTip label="About screenshots">
                    The desktop and phone screenshots stay in this repo. The stage shows the desktop
                    one when the dev server is not running.
                  </HelpTip>
                </span>
              )
            }}
          />
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
        latestReviewSummary={latestReview}
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
