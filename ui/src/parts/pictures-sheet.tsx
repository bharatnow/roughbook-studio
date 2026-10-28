import { Button, Sheet, SheetFooter } from '@roughbook/ui';
import { useState } from 'react';
import { post } from '../api';
import { useStudio } from '../data';

/**
 * The project's pictures question, asked once in the local UI while nobody has answered it
 * (decision 25 of ROUGHBOOK-APPLE-PLAN.md). Yes and No save the answer for the project; Ask me
 * later, the close button and Esc only close it for this session. Nothing goes up before a yes.
 */
export function PicturesSheet({ open, onLater }: { open: boolean; onLater: () => void }) {
  const { refreshState, say } = useStudio();
  const [pending, setPending] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function answer(on: boolean) {
    setPending(on);
    setProblem(null);
    try {
      await post('/api/pictures/answer', { on });
      await refreshState();
      say({
        tone: 'info',
        text: on
          ? "This project's pictures go up to Roughbook. Turn them off with roughbook pictures off."
          : "This project's pictures stay on this machine. Turn them on with roughbook pictures on."
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onLater}
      title="Upload this project's pictures?"
      footer={
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
        {problem ? (
          <p role="alert" className="text-danger">
            {problem}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
