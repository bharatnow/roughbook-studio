import { Button, Sheet, SheetFooter } from '@roughbook/ui';
import { privacyWords } from './sheets';

/**
 * What Roughbook keeps of work done in a studio, and what it does not, shown once per install in
 * the local UI (decision 26 of ROUGHBOOK-APPLE-PLAN.md). The words are the CLI's, from
 * /api/state; closing it in any way counts as seen.
 */
export function PrivacySheet({
  open,
  lines,
  webUrl,
  onClose
}: {
  open: boolean;
  lines: readonly string[];
  webUrl: string | null;
  onClose: () => void;
}) {
  const { title, items } = privacyWords(lines);
  const more = webUrl ? `${webUrl.replace(/\/+$/, '')}/privacy` : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <SheetFooter
          cancelLabel="Close"
          onCancel={onClose}
          action={
            <Button type="button" kind="primary" onClick={onClose}>
              Got it
            </Button>
          }
        />
      }
    >
      <dl className="space-y-4 text-body">
        {items.map(item => (
          <div key={item.label || item.text}>
            {item.label ? <dt className="text-section text-label">{item.label}</dt> : null}
            <dd className="mt-1 text-label-secondary">{item.text}</dd>
          </div>
        ))}
      </dl>
      {more ? (
        <p className="mt-4 text-body">
          <a
            href={more}
            target="_blank"
            rel="noreferrer"
            className="text-accent-text underline underline-offset-2"
          >
            Read the privacy page
          </a>
        </p>
      ) : null}
    </Sheet>
  );
}
