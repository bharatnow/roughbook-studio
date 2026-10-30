// The studio's privacy sheet (A4 of ROUGHBOOK-APPLE-PLAN.md, decision 26): what Roughbook keeps of
// work done in a studio, and what it does not, in plain sentences. Shown once per install, at
// `roughbook login` or the first `roughbook init`, and remembered beside the analytics answer.
// Showing it sends nothing.
import type { Io } from '../io.js';
import { readSettings, saveSettings } from './settings.js';

/** The sheet, line by line. The first line is its heading. */
export const PRIVACY_SHEET = [
  'What Roughbook keeps, and what it does not:',
  '  Kept: the brief and context you give a project, each iteration’s record (its name, direction and how its checks went), reviews and decisions, and the project’s pictures once someone says yes.',
  '  Words: what your team types for a run stays with the project until it is deleted, and you can delete your own. They are never shown to client reviewers, no model is trained on them, and they never feed a prompt on their own.',
  '  Not kept: your code, your file names or paths, or the code your agent writes from a prompt. A path you type is swapped for a stand-in before your words are sent. Your agent works on this machine, with your own account.',
  '  Learned: short sentences about your taste and each brand’s, from your picks and ratings. They are used only as context for your requests, no model is trained on them, and you can forget any one of them.'
] as const;

/**
 * Shows the sheet if this install has not shown it yet; true when it did. A link to the privacy
 * page follows it when the web's address is known.
 */
export async function showPrivacySheetOnce(
  io: Io,
  configDir: string,
  webUrl?: string
): Promise<boolean> {
  if ((await readSettings(configDir)).privacySheetShown) return false;
  for (const line of PRIVACY_SHEET) io.out(line);
  if (webUrl) io.out(`  More: ${webUrl.replace(/\/+$/, '')}/privacy`);
  await saveSettings(configDir, { privacySheetShown: true });
  return true;
}
