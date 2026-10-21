// The preview contract, as agents read it in rough/CONTRACT.md (written by `init` beside
// rough/AGENTS.md) and as `roughbook doctor` checks it. ROUGHBOOK-FRAMEWORKS-PLAN.md, "The preview
// contract".
import { OURS } from '../repo/plan.js';

/** The message a preview posts to its parent once the iteration rendered. */
export const READY_MESSAGE = '{ roughbook: "ready", id }';
/** The message a preview posts when the iteration is missing or failed. */
export const ERROR_MESSAGE = '{ roughbook: "error", id, message }';

export const ROUGH_CONTRACT = `# The preview contract

How this repo shows one iteration from rough/ while the app runs in development, whatever its
stack. \`roughbook doctor\` checks every point below; a setup that passes is one the studio can work
through. Written for the agent that sets a repo up or changes its preview setup.

1. **Development only.** Nothing from rough/ and nothing of the preview setup reaches production:
   a production build's output holds none of it, or the preview URL answers 404 when the app runs
   in production mode, or both. The environment's \`gate\` says which.
2. **One iteration per view.** Each key \`<page>/<component>/<iteration>\` can be shown on its own,
   inside the app's own layout, styles, fonts and providers, at every viewport the environment
   names. When the iteration holds the environment's fixture file (\`preview.json\`), the preview
   passes its contents to the iteration as its inputs. A layout or wrapper of the app's that decides
   what to show by path lets the preview's address through in development, so the route is shown
   and not the app's own view. The environment's variants reach the preview as query parameters
   on its address, the same in every stack: \`roughbook-scheme=dark\`, \`roughbook-dir=rtl\`,
   \`roughbook-lang=<tag>\`, \`roughbook-text=large\`, and \`roughbook-variant=<word>\` for a word
   of the setup's own. The preview applies them to the iteration's root the way the app switches
   its colour scheme, text direction and language; a preview that ignores them renders the
   default, and the studio's screenshots emulate the scheme and the locale besides.
3. **States.** A rendered iteration posts ${READY_MESSAGE} to the page's parent (the page itself
   when nothing frames it). An iteration that is missing or failed posts ${ERROR_MESSAGE}, with
   the reason in \`message\`; where the stack can, the response is also 404 for a missing key and
   500 for a failed render.
4. **Freshness.** A change to an iteration's files shows at its preview URL without restarting
   anything: the stack's own reload (\`reload: app\` in the environment), or a plain reload of
   the page, which the studio's frame does on a change when the environment says
   \`reload: studio\`.
5. **Loopback.** The preview answers requests addressed to this machine (localhost, 127.0.0.1,
   [::1]) and refuses or hides from any other address, so a dev server reachable on the network
   shows nothing from rough/.
6. **Listed.** Every file the preview setup adds or changes outside rough/ is listed in
   rough/environment.md, so it can be checked and removed.

In standalone mode (\`mode: standalone\`) the studio's own server is the preview, and meets points 2
to 5 itself: it serves an iteration's HTML entry as it is, or bundles a React one with esbuild,
inside a page that loads the site's stylesheets (\`stylesheets\`, as the site's pages link them) and
serves the site's folder (\`public\`) at its root. An iteration links its own files relative to its
folder (\`./photo.jpg\`) and the site's files from the root (\`/images/logo.svg\`), as the site's
pages do. An HTML iteration reads its fixture from \`window.roughbookFixture\`; a React one gets it as
its props. The setup writes nothing outside rough/ then; point 1 is about the site itself, which
must not publish or serve rough/.

${OURS}; it rewrites this file.
`;
