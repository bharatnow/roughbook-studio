import { Sheet } from '@roughbook/ui';
import type { Component } from '../types';

const term = 'text-section text-label-secondary';

/**
 * A component's brief, read-only, in a full-height sheet: it is edited on the web. A frame's Brief
 * on the canvas opens it.
 */
export function BriefSheet({
  component,
  webHref,
  onClose
}: {
  component: Component | null;
  webHref: string | null;
  onClose: () => void;
}) {
  const approved = component?.copy.versions.find(item => item.number === component.copy.approved);
  return (
    <Sheet
      open={component !== null}
      onClose={onClose}
      title={component ? `${component.name} brief` : 'Brief'}
      size="full"
    >
      {component ? (
        <div className="flex flex-col gap-4 text-body">
          <dl className="flex flex-col gap-3">
            {component.messages.primary ? (
              <div>
                <dt className={term}>Must say</dt>
                <dd className="mt-1 text-label">{component.messages.primary}</dd>
              </div>
            ) : null}
            {component.userQuestion ? (
              <div>
                <dt className={term}>The visitor asks</dt>
                <dd className="mt-1 text-label">{component.userQuestion}</dd>
              </div>
            ) : null}
            <div>
              <dt className={term}>
                {approved ? `Approved copy, version ${approved.number}` : 'Approved copy'}
              </dt>
              {approved ? (
                <>
                  <dd className="mt-1 font-display text-label">{approved.headline}</dd>
                  {approved.supporting.map(line => (
                    <dd key={line} className="text-label">
                      {line}
                    </dd>
                  ))}
                </>
              ) : (
                <dd className="mt-1 text-label">None yet: iterations use placeholder text.</dd>
              )}
            </div>
            {component.brief ? (
              <div>
                <dt className={term}>Brief</dt>
                <dd className="mt-1 whitespace-pre-line text-label">{component.brief}</dd>
              </div>
            ) : null}
          </dl>
          {webHref ? (
            <a
              href={webHref}
              target="_blank"
              rel="noreferrer"
              className="self-start text-accent-text hover:underline"
            >
              Edit on the web
            </a>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
