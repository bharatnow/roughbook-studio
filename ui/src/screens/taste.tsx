import { LearnedSentences } from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { Failure } from '../api';
import { useStudio } from '../data';
import { LEARNED_REFUSED_LINE, learnedRefused, loadLearned, type Learned } from '../memory-api';
import { useChrome } from '../parts/chrome';
import { Missing } from '../parts/missing';
import { TASTE_HREF } from '../router';

type Loaded = { learned: Learned } | { refused: true } | { problem: string } | null;

/**
 * What Roughbook learned about you and this brand (A10 step 3 of ROUGHBOOK-APPLE-PLAN.md), as the
 * web's /studio/taste shows it: each sentence beside the choices behind it, with Forget, which the
 * UI host sends through the local server. The privacy line sits in each list's HelpTag.
 */
export function TasteScreen() {
  const { project } = useStudio();
  const { setCrumbs } = useChrome();
  const [loaded, setLoaded] = useState<Loaded>(null);

  useEffect(() => {
    setCrumbs([{ href: `#${TASTE_HREF}`, label: 'Your taste' }]);
    return () => setCrumbs([]);
  }, [setCrumbs]);

  useEffect(() => {
    let live = true;
    loadLearned().then(
      learned => live && setLoaded({ learned }),
      (error: unknown) =>
        live &&
        setLoaded(
          learnedRefused(error)
            ? { refused: true }
            : {
                problem:
                  error instanceof Failure
                    ? error.message
                    : 'Could not read what Roughbook learned.'
              }
        )
    );
    return () => {
      live = false;
    };
  }, []);

  if (!loaded) return <Missing>Reading what Roughbook learned…</Missing>;
  if ('refused' in loaded) return <Missing>{LEARNED_REFUSED_LINE}</Missing>;
  if ('problem' in loaded) {
    return (
      <p role="alert" className="text-body text-danger">
        {loaded.problem}
      </p>
    );
  }
  const brand = project?.tree.name || loaded.learned.project;
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <LearnedSentences
        title="You"
        sentences={loaded.learned.you}
        empty="Nothing learned about you yet. Your picks and ratings teach it, across projects."
      />
      <LearnedSentences
        title="This brand"
        sentences={loaded.learned.brand}
        empty={`Nothing learned about ${brand} yet. The team’s picks and ratings here teach it.`}
      />
    </div>
  );
}
