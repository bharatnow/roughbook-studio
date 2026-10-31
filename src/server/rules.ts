// The local UI's lasting rules (I3 of the chat audit): `POST /api/rules` with the rule the designer
// agreed to, its scope and the component's slugs. Nothing else goes. A rule stays on the server and
// goes into later runs, whose stand-ins number afresh, so a path cannot leave as a stand-in as a
// run's words do: a rule that names one is refused here, in words.
import type { SaveRuleBody, SaveRuleReply, StudioApi } from '../api/client.js';
import { redactLocalPaths } from '../runs/localPaths.js';
import { BadRequest } from './studio.js';
import { slug } from './understand.js';

/** The longest rule the backend keeps. */
const MAX_RULE = 300;

/** What the route needs from the studio: the client and the linked project. */
export type RulesSource = { api: StudioApi; link: { orgId: string; project: string } };

/** Reads the page's request as the backend's schema would, keeping nothing else. */
export function parseRule(body: Record<string, unknown>): SaveRuleBody {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new BadRequest('Write the rule first.');
  if (text.length > MAX_RULE) {
    throw new BadRequest(`A rule is ${MAX_RULE} characters at most.`);
  }
  if (redactLocalPaths([text]).paths.size) {
    throw new BadRequest(
      'A rule stays with the project, so it cannot name a path on this machine. Say it without the path.'
    );
  }
  if (body.scope === 'project') return { text, scope: 'project' };
  if (body.scope !== 'component') {
    throw new BadRequest('Say whether the rule is for this component or the project.');
  }
  const page = slug(body.page, 'page');
  const component = slug(body.component, 'component');
  if (!page || !component) throw new BadRequest('Select a component first.');
  return { text, scope: 'component', page, component };
}

/** Saves the rule; the backend's refusals, such as a full list, pass on as ApiErrors. */
export async function saveRule(
  source: RulesSource,
  body: Record<string, unknown>
): Promise<SaveRuleReply> {
  const { api, link } = source;
  return api.saveRule(link.orgId, link.project, parseRule(body));
}
