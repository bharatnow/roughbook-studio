import { Drawer } from '@roughbook/ui';
import type { Component } from '../types';

const term = 'font-mono text-[11px] tracking-[0.08em] text-steel uppercase';

/** A component's brief, read-only: it is edited on the web. A frame's Brief on the canvas opens it. */
export function BriefDrawer({
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
    <Drawer
      open={component !== null}
      onClose={onClose}
      title={component ? `${component.name} brief` : 'Brief'}
    >
      {component ? (
        <div className="flex flex-col gap-4 text-sm">
          <dl className="flex flex-col gap-3">
            {component.messages.primary ? (
              <div>
                <dt className={term}>Must say</dt>
                <dd className="mt-1 text-graphite">{component.messages.primary}</dd>
              </div>
            ) : null}
            {component.userQuestion ? (
              <div>
                <dt className={term}>The visitor asks</dt>
                <dd className="mt-1 text-graphite">{component.userQuestion}</dd>
              </div>
            ) : null}
            <div>
              <dt className={term}>
                {approved ? `Approved copy, version ${approved.number}` : 'Approved copy'}
              </dt>
              {approved ? (
                <>
                  <dd className="mt-1 font-display text-graphite">{approved.headline}</dd>
                  {approved.supporting.map(line => (
                    <dd key={line} className="text-graphite">
                      {line}
                    </dd>
                  ))}
                </>
              ) : (
                <dd className="mt-1 text-graphite">None yet: iterations use placeholder text.</dd>
              )}
            </div>
            {component.brief ? (
              <div>
                <dt className={term}>Brief</dt>
                <dd className="mt-1 whitespace-pre-line text-graphite">{component.brief}</dd>
              </div>
            ) : null}
          </dl>
          {webHref ? (
            <a
              href={webHref}
              target="_blank"
              rel="noreferrer"
              className="self-start text-violet hover:underline"
            >
              Edit on the web
            </a>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
