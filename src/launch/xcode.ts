// Xcode's MCP bridge (Xcode 26.3 and later): `xcrun mcpbridge` speaks MCP over stdio and hands an
// outside agent Xcode's own tools. It answers only while Xcode is running with the project open
// and Settings > Intelligence > "Allow external agents to use Xcode tools" is on. Apple's
// "Giving external agents access to Xcode" registers it as `xcrun mcpbridge`.
import type { CommandResult } from '../agents/command.js';
import type { Executable } from './which.js';

/** The name the bridge is registered under, beside the studio's own server. */
export const XCODE_SERVER_NAME = 'xcode';

/** How an agent starts the bridge: xcrun finds it in the selected Xcode. */
export const XCODE_BRIDGE = { command: 'xcrun', args: ['mcpbridge'] };

/** The line printed wherever the bridge cannot be added. */
export const XCODE_BRIDGE_MISSING =
  "Xcode's MCP bridge needs Xcode 26.3 or later on a Mac, so it was not added.";

/** What an agent needs on the Mac before the bridge answers. */
export const XCODE_BRIDGE_NEEDS =
  'Xcode must be running with the project open, and Settings > Intelligence > "Allow external agents to use Xcode tools" turned on.';

type Run = (executable: Executable, args: string[], timeoutMs?: number) => Promise<CommandResult>;

/**
 * Where `xcrun --find mcpbridge` says the bridge is, or null: never off macOS, and not when
 * xcrun is missing, the selected Xcode is older than 26.3, or only the Command Line Tools are
 * selected. `run` is the studio's runCommand, replaced in tests.
 */
export async function findXcodeBridge(platform: NodeJS.Platform, run: Run): Promise<string | null> {
  if (platform !== 'darwin') return null;
  const xcrun: Executable = { command: 'xcrun', prefixArgs: [], source: 'PATH' };
  const found = await run(xcrun, ['--find', 'mcpbridge'], 10_000);
  const where = found.ok ? found.stdout.trim().split(/\r?\n/)[0]?.trim() : '';
  return where || null;
}
