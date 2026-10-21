// An HTML iteration, served as it is: its entry file's markup, a fragment or a whole document,
// inside the environment's HTML wrapper when it names one (the site's header and footer around
// it, with {{roughbook:iteration}} where the iteration goes). The page says ready once it loaded.
import fs from 'node:fs';
import path from 'node:path';
import { ITERATION_STAND_IN } from '../../standalone/page.js';
import type { StandaloneRenderer } from '../../standalone/types.js';

export const html: StandaloneRenderer = {
  id: 'html',
  async render({ repoRoot, environment, dir }) {
    let markup: string;
    try {
      markup = fs.readFileSync(path.join(dir, environment.entry), 'utf8');
    } catch (error) {
      return {
        ok: false,
        message: `${environment.entry} could not be read: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    const wrapper = environment.wrapper;
    if (wrapper) {
      if (!/\.html?$/i.test(wrapper)) {
        return {
          ok: false,
          message: `The wrapper ${wrapper} is not an HTML file; an HTML iteration is wrapped in an HTML file holding ${ITERATION_STAND_IN} where it goes.`
        };
      }
      let around: string;
      try {
        around = fs.readFileSync(path.join(repoRoot, ...wrapper.split('/')), 'utf8');
      } catch {
        return { ok: false, message: `The wrapper ${wrapper} is not in the repo.` };
      }
      if (!around.includes(ITERATION_STAND_IN)) {
        return {
          ok: false,
          message: `The wrapper ${wrapper} has no ${ITERATION_STAND_IN} where the iteration goes.`
        };
      }
      const inner = markup;
      markup = around.replace(ITERATION_STAND_IN, () => inner);
    }
    return { ok: true, markup, head: [], readyOn: 'load', files: {} };
  }
};
