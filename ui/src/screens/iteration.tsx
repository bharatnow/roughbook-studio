import {
  Button,
  GENERATION_STATE_LABELS,
  HelpTip,
  IterationInspector,
  IterationNotesForm,
  PreviewFrame,
  REFINEMENT_PRESETS,
  RatingForm,
  RejectDrawer,
  ReviewButton,
  SelectConfirmDrawer,
  Segmented,
  Stage,
  decisionOf,
  describeIterationState,
  describeRating,
  generationStateOf,
  iterationMorphName,
  iterationStatusLabel,
  latestHumanReview,
  previewAddress,
  reviewSummary,
  snapshotImageName,
  HelpTag,
  VERB_LABELS,
  termLabel,
  useUiHost
} from '@roughbook/ui';
import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { COMPLETE_FEATURES_REASON } from '@roughbook/ui/commands';
import { useEffect, useState } from 'react';
import { get, iterationPath, post, screenshotUrl } from '../api';
import { describe, findComponent, useStudio } from '../data';
import { completeFeaturesOf } from '../features';
import { useHostLine } from '../host';
import { inPageNote, inPageSrc, lazyImportNotice } from '../in-page';
import { lineOf, newest, shotsLine, verbLine, type Line } from '../output';
import { navigate } from '../router';
import { Missing } from '../parts/missing';
import { OutputLine, useLine } from '../parts/output-line';
import { useRatings } from '../parts/ratings';
import { RefineSheet, useReviews } from '../parts/refine';
import { RunCard } from '../parts/run-card';
import { HowFarMenu, NotThisMenu, useRunVerb } from '../parts/verb-run';
import type { AppView, SnapshotView } from '../types';

/**
 * The first screenshot, fetched with the token, for when the dev server is not answering;
 * fetched again when `version` changes, after the screenshots were taken again.
 */
function useScreenshot(
  page: string,
  component: string,
  iteration: string,
  size: string | null,
  version: string
) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!size) return;
    let made: string | null = null;
    let live = true;
    void screenshotUrl(page, component, iteration, size).then(next => {
      made = next;
      if (live) setUrl(next);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [page, component, iteration, size, version]);
  return url;
}

/**
 * Snapshot images, one per shot, fetched with the token; fetched again when `version` changes,
 * after the command rendered them again.
 */
function useSnapshotImages(
  page: string,
  component: string,
  iteration: string,
  names: string[],
  version: string,
  enabled: boolean
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const wanted = names.join(',');
  useEffect(() => {
    if (!enabled || !wanted) return;
    let live = true;
    const made: string[] = [];
    void Promise.all(
      wanted.split(',').map(async name => {
        const url = await screenshotUrl(page, component, iteration, name);
        if (url) made.push(url);
        return [name, url] as const;
      })
    ).then(entries => {
      if (!live) return;
      setUrls(
        Object.fromEntries(entries.filter(([, url]) => url !== null)) as Record<string, string>
      );
    });
    return () => {
      live = false;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [page, component, iteration, wanted, version, enabled]);
  return urls;
}

/** One iteration's snapshot state, asked again often while it renders, and on every change. */
function useSnapshotState(
  page: string,
  component: string,
  iteration: string,
  changeSeq: number,
  enabled: boolean
): [SnapshotView | null, (next: SnapshotView) => void] {
  const [state, setState] = useState<SnapshotView | null>(null);
  const rendering = state?.status === 'rendering';
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const ask = () =>
      void get<SnapshotView>(`${iterationPath(page, component, iteration)}/snapshots`)
        .then(next => {
          if (live) setState(next);
        })
        .catch(() => undefined);
    ask();
    const timer = window.setInterval(ask, rendering ? 1500 : 10_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [page, component, iteration, changeSeq, enabled, rendering]);
  return [state, setState];
}

/**
 * The app's state, asked again often while it starts or is down, so the frame's progress moves,
 * and rarely once it answers.
 */

/** A dimmed control keeps its reason in a help tag, not a title (the shell-style ratchet). */
function withReason(
  reason: string | null | undefined,
  control: ReactElement<{ 'aria-describedby'?: string }>
) {
  return reason ? <HelpTag text={reason}>{control}</HelpTag> : control;
}

/**
 * The app's state, and `trouble`: Turbopack's lost lazy import (B7b), from the app's log or from a
 * preview's own error message, for the screen to say beside its frame.
 */
export function useApp(initial: AppView | null): AppView & { trouble: Line | null } {
  const { state, refreshState } = useStudio();
  const [app, setApp] = useState<AppView | null>(initial);
  const [lazy, setLazy] = useState<Line | null>(null);
  const current = app ?? state?.app ?? null;
  const status = current?.status ?? 'unknown';
  const fault = current?.fault ?? null;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const text = lazyImportNotice(event.data);
      if (text) setLazy(lineOf('error', text));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    let live = true;
    const timer = window.setInterval(
      () => {
        void get<AppView>('/api/app')
          .then(next => {
            if (!live) return;
            setApp(next);
            if (next.status !== status) void refreshState();
          })
          .catch(() => undefined);
      },
      status === 'up' ? 15_000 : 2000
    );
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [status, refreshState]);
  const view: AppView = current ?? {
    status: 'unknown',
    terminal: null,
    since: null,
    lastLine: null,
    fault: null
  };
  // The log's fault stands while the app reports it; a preview's message, until the next one.
  return { ...view, trouble: newest(fault ? lineOf('error', fault, 0) : null, lazy) };
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
  const { state, project, runs, changes, refresh, refreshState } = useStudio();
  const { previewSrc } = useUiHost();
  /** What the stage's own controls said (the app, the device, a render), beside its actions. */
  const said = useLine();
  /** Take screenshots' answer, beside its button in the inspector. */
  const shotSaid = useLine();
  const hostLine = useHostLine();
  const [since] = useState(() => Date.now());
  const [selectOpen, setSelectOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(refine);
  const [shooting, setShooting] = useState(false);
  const [shotVersion, setShotVersion] = useState(0);
  const key = `${page}/${component}/${id}`;
  const taken = project?.local.screenshots[key] ?? [];
  const takenAt = project?.local.screenshotsAt?.[key] ?? '';
  const shot = useScreenshot(page, component, id, taken[0] ?? null, `${takenAt}:${shotVersion}`);
  const reviews = useReviews(page, component, id);
  const rating = useRatings(page, component)[id] ?? null;
  const app = useApp(state?.app ?? null);
  const verbs = useRunVerb();
  useEffect(() => setRefineOpen(refine), [refine]);
  // A live preview through a mobile stack's web target has the repo's snapshots beside it, for
  // final review; in snapshot mode they are the preview itself.
  const [finalReview, setFinalReview] = useState(false);
  const mode = state?.environment.mode ?? 'live';
  const showImages = mode === 'snapshot' || (finalReview && Boolean(state?.environment.snapshot));
  const shotNames = (state?.environment.viewports ?? []).flatMap(viewport =>
    (state?.environment.variants.length ? state.environment.variants : [null]).map(variant =>
      snapshotImageName(viewport.name, variant?.id ?? null, state?.environment.variants ?? [])
    )
  );
  const imagesChanged = changes.keys.filter(item => item === `${key}#images`).length;
  const [snapshot, setSnapshot] = useSnapshotState(page, component, id, changes.seq, showImages);
  const images = useSnapshotImages(
    page,
    component,
    id,
    shotNames,
    `${snapshot?.at ?? ''}:${snapshot?.status ?? ''}:${imagesChanged}:${changes.seq}:${shotVersion}`,
    showImages
  );

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
  // The plain verbs (A7): the stage's everyday actions. Refine is complete-only, dimmed when off.
  const verbTarget = { project: project.tree.slug, page, component, iteration: id };
  const made = generationStateOf(iteration) === 'completed' && !run;
  const notMade = made ? undefined : "It isn't made yet.";
  const waiting = verbs.busy === id ? 'Wait for the last one to start.' : undefined;
  const refineOff = completeFeaturesOf(state) ? undefined : COMPLETE_FEATURES_REASON;
  const goTo = async (
    verb: 'more' | 'different' | 'polish',
    fields: Record<string, string> = {}
  ) => {
    const result = await verbs.run(verb, verbTarget, fields);
    const first = result?.ok ? result.made?.[0] : undefined;
    // What it made is on the canvas, beside this one, where its agent's terminal shows.
    if (first) navigate(`${base}/iterations#${first}`);
  };
  const parentHere = iteration.parent
    ? project.local.iterations.includes(`${page}/${component}/${iteration.parent}`)
    : false;
  const latestReview = reviewSummary(latestHumanReview(reviews));
  const environment = state.environment;
  const src = previewSrc({ project: project.tree.slug, page, component, iteration: id });
  const terms = environment.terms;
  const kicker = `${termLabel('page', terms)} ${found.page.name} · ${termLabel('component', terms)} ${record.name} · ${id}`;

  async function takeScreenshots() {
    setShooting(true);
    shotSaid.clear();
    try {
      const shots = await post<{ files: Record<string, string>; warning: string | null }>(
        `${iterationPath(page, component, id)}/screenshots`,
        { force: true }
      );
      shotSaid.show(shotsLine(shots));
      setShotVersion(version => version + 1);
    } catch (error) {
      shotSaid.fail(error);
    } finally {
      setShooting(false);
      await refresh();
    }
  }

  async function renderAgain() {
    setSnapshot({ status: 'rendering', message: null, at: snapshot?.at ?? null });
    try {
      const next = await post<SnapshotView>(`${iterationPath(page, component, id)}/snapshots`, {
        force: true
      });
      setSnapshot(next);
      if (next.status === 'failed' && next.message) said.fail(next.message);
      setShotVersion(version => version + 1);
    } catch (error) {
      setSnapshot({ status: 'failed', message: describe(error), at: null });
      said.fail(error);
    }
  }

  async function openOnDevice() {
    said.clear();
    try {
      const result = await post<{ ok: boolean; message: string }>(
        `${iterationPath(page, component, id)}/device`
      );
      said.show(verbLine(result));
    } catch (error) {
      said.fail(error);
    }
  }

  async function startApp() {
    said.clear();
    try {
      const result = await post<{ started: boolean; reason: string | null }>('/api/app/start');
      said.info(
        result.started
          ? `Starting the app with ${environment.start.command}; its session is in the terminals.`
          : (result.reason ?? 'The app was not started.')
      );
    } catch (error) {
      said.fail(error);
    }
    await refreshState();
  }

  return (
    <>
      <Stage
        morph={iterationMorphName({ page, component, iteration: id })}
        backHref={`${base}/iterations#${id}`}
        backLabel="Back to canvas"
        backOnEscape
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
        viewports={null}
        extraActions={
          <>
            <RatingForm
              project={project.tree.slug}
              page={page}
              component={component}
              iterationId={id}
              rating={rating}
            />
            {verbs.served('more')
              ? withReason(
                  notMade ?? waiting,
                  <Button
                    type="button"
                    disabled={Boolean(notMade ?? waiting)}
                    onClick={() => void goTo('more')}
                  >
                    {VERB_LABELS.more}
                  </Button>
                )
              : null}
            {verbs.served('different') ? (
              <HowFarMenu
                disabled={notMade ?? waiting}
                onChoose={howFar => void goTo('different', { howFar })}
              />
            ) : null}
            {verbs.served('polish')
              ? withReason(
                  notMade ?? waiting,
                  <Button
                    type="button"
                    disabled={Boolean(notMade ?? waiting)}
                    onClick={() => void goTo('polish')}
                  >
                    {VERB_LABELS.polish}
                  </Button>
                )
              : null}
            {verbs.served('not-this') ? (
              <NotThisMenu
                disabled={waiting}
                onReason={reason =>
                  void verbs.run('not-this', verbTarget, { reasonPreset: reason })
                }
                onOther={() => setRejectOpen(true)}
              />
            ) : (
              <Button type="button" onClick={() => setRejectOpen(true)}>
                {VERB_LABELS['not-this']}
              </Button>
            )}
            {withReason(
              refineOff,
              <Button
                type="button"
                disabled={Boolean(refineOff)}
                onClick={() => setRefineOpen(true)}
              >
                Refine
              </Button>
            )}
            <ReviewButton
              target={target}
              reviews={reviews}
              feedback={iteration.feedback}
              critiquePrompt=""
              refineHref={`${base}/${id}?refine=1`}
            />
            <OutputLine
              line={newest(
                said.line,
                verbs.line,
                app.trouble,
                hostLine && hostLine.at >= since ? hostLine : null
              )}
              className="basis-full"
            />
          </>
        }
        // The one prominent action (A9), at once; the pick itself opens its reason and rating, or
        // Unpick, and stays plain.
        primary={
          selected || !verbs.served('pick-this') ? (
            <Button
              type="button"
              kind={selected ? 'normal' : 'primary'}
              onClick={() => setSelectOpen(true)}
            >
              {selected ? (
                <>
                  <Check aria-hidden className="size-4" strokeWidth={1.5} />
                  Picked
                </>
              ) : (
                VERB_LABELS['pick-this']
              )}
            </Button>
          ) : (
            <Button
              type="button"
              kind="primary"
              disabled={Boolean(waiting)}
              onClick={() => void verbs.run('pick-this', verbTarget)}
            >
              {VERB_LABELS['pick-this']}
            </Button>
          )
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
                  <Button type="button" disabled={shooting} onClick={() => void takeScreenshots()}>
                    {shooting
                      ? 'Taking screenshots'
                      : taken.length
                        ? 'Take them again'
                        : 'Take screenshots'}
                  </Button>
                  <HelpTip label="About screenshots">
                    One at each viewport and variant the environment names, kept in this repo. They
                    are taken when a run finishes and again when the files change; the frame shows
                    the first when the app is not answering.
                  </HelpTip>
                  <OutputLine line={shotSaid.line} />
                </span>
              )
            }}
          />
        }
      >
        <PreviewFrame
          mode={showImages ? 'snapshot' : environment.mode}
          items={[
            {
              key,
              label: iteration.name,
              src,
              images: (viewport, variant) =>
                images[snapshotImageName(viewport, variant || null, environment.variants)] ?? null,
              snapshot: snapshot
                ? { status: snapshot.status, message: snapshot.message }
                : undefined,
              fallbackSrc: shot,
              // In its page, beside Alone, for an adopted component's iteration (B5).
              inPageSrc: inPageSrc(project.local, state.devUrl, key),
              making: run?.status === 'started',
              exists: true
            }
          ]}
          pick
          viewports={environment.viewports}
          variants={environment.variants}
          kicker={kicker}
          app={app.status}
          devUrl={state.devUrl}
          progress={app.lastLine}
          reload={environment.reload}
          changedKeys={changes.keys}
          changeSeq={changes.seq}
          openHref={(_key, variant) => previewAddress(src, variant)}
          onStartApp={
            environment.start.command && environment.start.approved && state.terminal.builtin
              ? () => void startApp()
              : undefined
          }
          timeoutMs={environment.timeouts.preview * 1000}
          onRender={environment.snapshot?.approved ? () => void renderAgain() : undefined}
          rendering={snapshot?.status === 'rendering'}
          onOpenDevice={environment.device?.approved ? () => void openOnDevice() : undefined}
        >
          {mode !== 'snapshot' && environment.snapshot ? (
            <HelpTag text="Show the live page, or the images the repo renders for final review">
              <span className="inline-flex">
                <Segmented
                  label="What the frame shows"
                  options={[
                    { value: 'live', label: 'Live' },
                    { value: 'snapshots', label: 'Snapshots' }
                  ]}
                  value={finalReview ? 'snapshots' : 'live'}
                  onChange={value => setFinalReview(value === 'snapshots')}
                />
              </span>
            </HelpTag>
          ) : null}
          {/* What In its page covers on this stack, where the recipe says (decision 44). */}
          {inPageNote(project.local, key) ? (
            <HelpTip label="About In its page">{inPageNote(project.local, key)}</HelpTip>
          ) : null}
        </PreviewFrame>
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
      <RefineSheet
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
