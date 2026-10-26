import type { PromoteDrift, PromoteFinish } from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { get, promotePath } from '../api';

/** What the promote panel knows before the promote (B4): `GET /api/promote/:page/:component/:iteration`. */
export type PromotePlan = {
  /** The component's own file for a fork from the app, written in place; null for a new file. */
  defaultFile: string | null;
  drift: PromoteDrift | null;
  /** Why the iteration cannot be written back as it is, in words, or null. */
  problem: string | null;
  branchChoice: { defaultName?: string; unavailable?: string | null };
  /** A promote of it is open, waiting for its Finish. */
  open: boolean;
  /** What the last finish found, wherever it was finished (roughbook done, finish_run). */
  finish: PromoteFinish | null;
};

/** The plan of the iteration the drawer promotes, read when it opens; null while it loads. */
export function usePromotePlan(
  target: { page: string; component: string; iteration: string } | null
): PromotePlan | null {
  const [plan, setPlan] = useState<{ key: string; plan: PromotePlan } | null>(null);
  const key = target ? `${target.page}/${target.component}/${target.iteration}` : null;
  useEffect(() => {
    if (!target || !key) return;
    let current = true;
    get<PromotePlan>(promotePath(target.page, target.component, target.iteration))
      .then(found => {
        if (current) setPlan({ key, plan: found });
      })
      .catch(() => {
        // The panel works without it: a new file, no branch choice.
      });
    return () => {
      current = false;
    };
    // The target is read again only when its key changes.
  }, [key]);
  return plan && plan.key === key ? plan.plan : null;
}
