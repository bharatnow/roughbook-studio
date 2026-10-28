import { Button, Sheet, SheetFooter } from '@roughbook/ui';
import { useState } from 'react';
import { post } from '../api';
import { useStudio } from '../data';
import { errorLine, infoLine, type Line } from '../output';
import { OutputLine } from './output-line';

/**
 * The project's pictures question, asked once in the local UI while nobody has answered it
 * (decision 25 of ROUGHBOOK-APPLE-PLAN.md). Yes and No save the answer for the project, which the
 * sheet then says in its own words until Done; Ask me later, the close button and Esc only close
 * it for this session. Nothing goes up before a yes.
 */
export function PicturesSheet({ open, onLater }: { open: boolean; onLater: () => void }) {
  const { refreshState } = useStudio();
  const [pending, setPending] = useState<boolean | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const answered = line?.tone === 'info';

  async function answer(on: boolean) {
    setPending(on);
    setLine(null);
    try {
      await post('/api/pictures/answer', { on });
      setLine(
        infoLine(
          on
            ? "This project's pictures go up to Roughbook. Turn them off with roughbook pictures off."
            : "This project's pictures stay on this machine. Turn them on with roughbook pictures on."
        )
      );
    } catch (error) {
      setLine(errorLine(error));
    } finally {
      setPending(null);
    }
  }

  /** The answer is saved: the state read again closes the sheet. */
  function done() {
    setLine(null);
    void refreshState();
  }

  return (
    <Sheet
      open={open}
      onClose={answered ? done : onLater}
      title="Upload this project's pictures?"
      footer={
        answered ? (
          <div className="flex justify-end">
            <Button type="button" kind="primary" onClick={done}>
              Done
            </Button>
          </div>
        ) : (
          <SheetFooter
            cancelLabel="Ask me later"
            onCancel={onLater}
            action={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  pending={pending === false}
                  pendingLabel="Saving…"
                  disabled={pending !== null}
                  onClick={() => void answer(false)}
                >
                  No
                </Button>
                <Button
                  type="button"
                  kind="primary"
                  pending={pending === true}
                  pendingLabel="Saving…"
                  disabled={pending !== null}
                  onClick={() => void answer(true)}
                >
                  Yes, upload them
                </Button>
              </div>
            }
          />
        )
      }
    >
      <div className="space-y-3 text-sm text-label-secondary">
        <p>
          Roughbook can upload pictures of this project&apos;s studio iterations and adopted pages,
          so its team and client reviewers see them on the web.
        </p>
        <p>Only the pictures go: never your code, file names or paths.</p>
        <p>
          Until someone answers, pictures stay on this machine. You can change it later with{' '}
          <span className="font-mono text-label">roughbook pictures on</span> or{' '}
          <span className="font-mono text-label">off</span>.
        </p>
        <OutputLine line={line} />
      </div>
    </Sheet>
  );
}
