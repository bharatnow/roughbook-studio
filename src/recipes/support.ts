import support from './support.json' with { type: 'json' };

// The support tiers (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Support tiers, for launch"): every recipe in
// the launch order with how far it is proven, as support.json has it. The web carries the file
// byte for byte for its FAQ, install page and setup guides, so what the site promises is what the
// studio says here. A recipe is passing once the conformance suite passes on the systems named;
// unverified is written and tested without a real run. Every other stack is the verified tier.

export type SupportSystem = 'windows' | 'macos' | 'linux';

export type RecipeSupport = {
  id: string;
  name: string;
  status: 'passing' | 'unverified';
  systems: SupportSystem[];
  /** Why an unverified recipe is not proven yet; null for a passing one. */
  reason: string | null;
  modes: ('live' | 'snapshot' | 'standalone')[];
  /** Whether the stack's own tools need Node.js, so the npm install fits as well as the binary. */
  node: boolean;
  /** The programs its commands and scaffold run, as doctor's step 0 looks for them. */
  needs: string[];
  /** Programs only some of its commands need (a device for final-review snapshots). */
  optional: string[];
  /** The command that starts the app for previews, or null for a stack with snapshots only. */
  start: string | null;
  scaffold: string;
};

export const SUPPORT = support as {
  description: string;
  recipes: RecipeSupport[];
  hints: Record<string, string>;
};

export function supportFor(id: string): RecipeSupport | null {
  return SUPPORT.recipes.find(item => item.id === id) ?? null;
}

/** A recipe's tier in a few words, for `new` and `init`: nothing for a passing one. */
export function supportNote(id: string): string | null {
  const item = supportFor(id);
  if (!item || item.status === 'passing') return null;
  return `not yet proven: ${item.reason!.replace(/\.$/, '')}; roughbook doctor decides on your repo`;
}
