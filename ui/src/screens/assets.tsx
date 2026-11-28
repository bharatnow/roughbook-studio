import { Button, HelpTip, TextInput } from '@roughbook/ui';
import { useCallback, useEffect, useState } from 'react';
import { Failure } from '../api';
import { infoLine, lineOf } from '../output';
import { useChrome } from '../parts/chrome';
import { Missing } from '../parts/missing';
import { OutputLine } from '../parts/output-line';
import { ASSETS_HREF } from '../router';
import {
  FETCH_LINE,
  MAX_LICENCE,
  NOTHING_WAITING,
  answersWithoutRows,
  assetFacts,
  assetName,
  confirmAsset,
  declineAsset,
  licenceText,
  loadWebAssets,
  removeAsset,
  removeQuestion,
  type Answer,
  type RowAnswer,
  type WebAsset,
  type WebAssets
} from '../web-assets';

type Loaded = { assets: WebAssets } | { problem: string } | null;

type Section = NonNullable<RowAnswer['section']>;

const answerLine = (answer: Answer | undefined) =>
  answer ? lineOf(answer.ok ? 'info' : 'error', answer.message) : null;

/**
 * Files from the web for this project (after T5 of ROUGHBOOK-STUDIO-PARITY-PLAN.md): a run's
 * proposals first, each with Confirm and Decline, then the confirmed files, each with Remove.
 * Confirm sends the id and the licence typed here; the backend fetches the file, never this machine.
 */
export function AssetsScreen() {
  const { setCrumbs } = useChrome();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [answers, setAnswers] = useState<Record<string, RowAnswer>>({});

  useEffect(() => {
    setCrumbs([{ href: `#${ASSETS_HREF}`, label: 'Assets' }]);
    return () => setCrumbs([]);
  }, [setCrumbs]);

  const reload = useCallback(async () => {
    try {
      setLoaded({ assets: await loadWebAssets() });
    } catch (error) {
      setLoaded({
        problem: error instanceof Failure ? error.message : 'Could not read the project’s files.'
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const answered = useCallback(
    async (asset: WebAsset, answer: Answer, section: Section = 'waiting') => {
      setAnswers(current => ({
        ...current,
        [asset.id]: { ...answer, sourceUrl: asset.sourceUrl, section }
      }));
      await reload();
    },
    [reload]
  );

  if (!loaded) return <Missing>Reading the project’s files…</Missing>;
  if ('problem' in loaded) {
    return (
      <p role="alert" className="text-body text-danger">
        {loaded.problem}
      </p>
    );
  }
  return <AssetLists assets={loaded.assets} answers={answers} onAnswer={answered} />;
}

/**
 * The two lists, drawn from props so a test can render them: the proposals with each row's answer,
 * the answers whose rows are gone, and the confirmed files.
 */
export function AssetLists({
  assets,
  answers,
  onAnswer
}: {
  assets: WebAssets;
  answers: Record<string, RowAnswer>;
  onAnswer: (asset: WebAsset, answer: Answer, section?: Section) => Promise<void>;
}) {
  const { pending, confirmed } = assets;
  const gone = answersWithoutRows(answers, assets);
  const removed = answersWithoutRows(answers, assets, 'project');
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="assets-waiting" className="flex min-w-0 flex-col gap-3">
        <h2 id="assets-waiting" className="flex items-center gap-1 text-pane text-label">
          Waiting for you
          <HelpTip label="About confirming a file">{FETCH_LINE}</HelpTip>
        </h2>
        {gone.map(answer => (
          <OutputLine
            key={answer.sourceUrl}
            className="break-words"
            line={lineOf(answer.ok ? 'info' : 'error', `${answer.sourceUrl}: ${answer.message}`)}
          />
        ))}
        {pending.length ? (
          <ul className="flex min-w-0 flex-col gap-3">
            {pending.map(asset => (
              <Proposal
                key={asset.id}
                asset={asset}
                answer={answers[asset.id]}
                onAnswer={answer => onAnswer(asset, answer)}
              />
            ))}
          </ul>
        ) : (
          <OutputLine line={infoLine(NOTHING_WAITING)} />
        )}
      </section>
      {confirmed.length || removed.length ? (
        <section aria-labelledby="assets-confirmed" className="flex min-w-0 flex-col gap-3">
          <h2 id="assets-confirmed" className="text-pane text-label">
            In the project
          </h2>
          {removed.map(answer => (
            <OutputLine
              key={answer.sourceUrl}
              className="break-words"
              line={lineOf(answer.ok ? 'info' : 'error', answer.message)}
            />
          ))}
          {confirmed.length ? (
            <ul className="flex min-w-0 flex-col gap-3">
              {confirmed.map(asset => (
                <ConfirmedFile
                  key={asset.id}
                  asset={asset}
                  answer={answers[asset.id]}
                  onAnswer={answer => onAnswer(asset, answer, 'project')}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * One confirmed file, with Remove. Remove asks in place first (there is no Undo); the answer or
 * the refusal is said beside the row. `asking` starts it on the question, so a test can draw it.
 */
export function ConfirmedFile({
  asset,
  answer,
  onAnswer,
  asking: askingAtFirst = false
}: {
  asset: WebAsset;
  answer: Answer | undefined;
  onAnswer: (answer: Answer) => Promise<void>;
  asking?: boolean;
}) {
  const [asking, setAsking] = useState(askingAtFirst);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await onAnswer(await removeAsset(asset));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-control border border-separator p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0 text-body font-medium break-words text-label">
          {assetName(asset)}
        </span>
        {asking ? null : (
          <Button type="button" kind="destructive" tier="compact" onClick={() => setAsking(true)}>
            Remove
          </Button>
        )}
      </div>
      <AssetDetails asset={asset} />
      {asking ? (
        <div
          role="group"
          aria-label={`Remove ${assetName(asset)}`}
          className="flex min-w-0 flex-col gap-2"
        >
          <p className="text-body break-words text-label">{removeQuestion(asset)}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              kind="destructive"
              tier="compact"
              disabled={busy}
              pending={busy}
              pendingLabel="Removing…"
              onClick={() => void remove()}
            >
              Remove
            </Button>
            <Button
              type="button"
              kind="cancel"
              tier="compact"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <OutputLine line={answerLine(answer)} />
    </li>
  );
}

/** Where it came from, its licence, and its type and size when known. */
function AssetDetails({ asset }: { asset: WebAsset }) {
  const facts = assetFacts(asset);
  return (
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-body text-label">
      <dt className="text-label-secondary">From</dt>
      <dd className="min-w-0 font-mono text-xs break-all">{asset.sourceUrl}</dd>
      {asset.reason ? (
        <>
          <dt className="text-label-secondary">Why</dt>
          <dd className="min-w-0 break-words">{asset.reason}</dd>
        </>
      ) : null}
      <dt className="text-label-secondary">Licence</dt>
      <dd className="min-w-0 break-words">{licenceText(asset)}</dd>
      {facts ? (
        <>
          <dt className="text-label-secondary">File</dt>
          <dd className="min-w-0 break-words">{facts}</dd>
        </>
      ) : null}
    </dl>
  );
}

/** One proposal: its details, a licence to name instead, and Confirm or Decline. */
function Proposal({
  asset,
  answer,
  onAnswer
}: {
  asset: WebAsset;
  answer: Answer | undefined;
  onAnswer: (answer: Answer) => Promise<void>;
}) {
  const [licence, setLicence] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null);
  const fieldId = `licence-${asset.id}`;

  const run = async (which: 'confirm' | 'decline') => {
    setBusy(which);
    try {
      await onAnswer(
        which === 'confirm' ? await confirmAsset(asset, licence) : await declineAsset(asset)
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-control border border-separator p-3">
      <AssetDetails asset={asset} />
      <form
        className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={event => {
          event.preventDefault();
          void run('confirm');
        }}
      >
        <label
          htmlFor={fieldId}
          className="flex min-w-0 flex-1 flex-col gap-1 text-body text-label"
        >
          Licence, if it is another
          <TextInput
            id={fieldId}
            name="licence"
            value={licence}
            onChange={event => setLicence(event.target.value)}
            maxLength={MAX_LICENCE}
            placeholder={asset.licence || 'CC0, OFL-1.1…'}
            autoComplete="off"
            className="min-w-0"
          />
        </label>
        <div className="flex gap-2">
          <Button
            type="submit"
            tier="compact"
            disabled={busy !== null}
            pending={busy === 'confirm'}
            pendingLabel="Confirming…"
          >
            Confirm
          </Button>
          <Button
            type="button"
            tier="compact"
            disabled={busy !== null}
            pending={busy === 'decline'}
            pendingLabel="Declining…"
            onClick={() => void run('decline')}
          >
            Decline
          </Button>
        </div>
      </form>
      <OutputLine line={answerLine(answer)} />
    </li>
  );
}
