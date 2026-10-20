// Every recipe the studio has, and the one a repo gets when nothing says which: Next.js, the
// only stack the studio knew before environments existed (decision 20 of the frameworks plan).
import { next } from './next/index.js';
import type { Recipe } from './types.js';

export const RECIPES: readonly Recipe[] = [next];

export const fallbackRecipe: Recipe = next;

export function recipeFor(id: string | null | undefined): Recipe | null {
  return RECIPES.find(recipe => recipe.id === id) ?? null;
}
