// Every recipe the studio has, and the one a repo gets when nothing says which: Next.js, the
// only stack the studio knew before environments existed (decision 20 of the frameworks plan).
import { compose } from './compose/index.js';
import { expo } from './expo/index.js';
import { flutter } from './flutter/index.js';
import { laravel } from './laravel/index.js';
import { next } from './next/index.js';
import { nuxt } from './nuxt/index.js';
import { shopify } from './shopify/index.js';
import { swiftui } from './swiftui/index.js';
import type { Recipe } from './types.js';
import { vite } from './vite/index.js';
import { wordpress } from './wordpress/index.js';

/** In the launch order (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes"): the market's stacks, web first. */
export const RECIPES: readonly Recipe[] = [
  next,
  vite,
  wordpress,
  shopify,
  laravel,
  expo,
  flutter,
  nuxt,
  swiftui,
  compose
];

export const fallbackRecipe: Recipe = next;

export function recipeFor(id: string | null | undefined): Recipe | null {
  return RECIPES.find(recipe => recipe.id === id) ?? null;
}

/**
 * The recipe an environment was set up by: the fallback for one from before recipes were named,
 * none (null) when the setup run's agent did without one (`recipe: none`), so the core takes
 * what it needs from the environment alone.
 */
export function recipeOf(environment: { recipe: string | null }): Recipe | null {
  if (environment.recipe === null) return null;
  return recipeFor(environment.recipe) ?? fallbackRecipe;
}
