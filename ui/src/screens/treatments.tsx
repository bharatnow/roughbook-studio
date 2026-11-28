import { MAX_TREATMENTS, TreatmentList } from '@roughbook/ui';
import { useEffect } from 'react';
import { useStudio } from '../data';
import { useChrome } from '../parts/chrome';
import { Missing } from '../parts/missing';
import { TREATMENTS_HREF } from '../router';
import { projectTreatments, treatmentsWebHref } from '../treatments';

/**
 * The project's treatments (T6 of ROUGHBOOK-STUDIO-PARITY-PLAN.md), read-only: @roughbook/ui's
 * TreatmentList with no project and no host actions, so it shows no Add, Change or Remove. They are
 * changed, and new ideas found, in the web's look tuner. The studio gets no signed preview
 * addresses, so each card says its preview is not ready rather than running anything here.
 */
export function TreatmentsScreen() {
  const { state, project, problem } = useStudio();
  const { setCrumbs } = useChrome();

  useEffect(() => {
    setCrumbs([{ href: `#${TREATMENTS_HREF}`, label: 'Treatments' }]);
    return () => setCrumbs([]);
  }, [setCrumbs]);

  if (!project) return <Missing>{problem ?? 'Reading the project…'}</Missing>;
  const treatments = projectTreatments(project.tree);
  const webHref = state
    ? treatmentsWebHref({ project: state.project.slug, webUrl: state.webUrl })
    : null;
  return (
    <section aria-label="Treatments" className="flex min-w-0 flex-col gap-2">
      <p className="text-body text-slate">
        How this look goes beyond its colours and type. Every run of the project uses them.
      </p>
      {webHref ? (
        <a
          href={webHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-6 items-center self-start text-accent-text hover:underline"
        >
          Edit on the web
        </a>
      ) : null}
      <TreatmentList treatments={treatments} previews={{}} max={MAX_TREATMENTS} />
    </section>
  );
}
