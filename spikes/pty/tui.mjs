// A stand-in for an agent's full-screen terminal UI (Claude Code and Codex both draw one): it
// needs a TTY on both ends, raw keyboard input, the alternate screen, colour and resize events.
// It reports each of them on one line the spike can wait for.
const out = process.stdout;
const say = line => out.write(`${line}\r\n`);

if (!process.stdin.isTTY || !out.isTTY) {
  say(`NOTTY stdin=${Boolean(process.stdin.isTTY)} stdout=${Boolean(out.isTTY)}`);
  process.exit(2);
}

out.write('\x1b[?1049h\x1b[H\x1b[2J');
say(`\x1b[1;35mRoughbook pty spike\x1b[0m on ${process.platform} with Node ${process.version}`);
say(`READY ${out.columns}x${out.rows}`);
out.on('resize', () => say(`RESIZE ${out.columns}x${out.rows}`));

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', chunk => {
  for (const byte of chunk) {
    if (byte === 0x71) {
      out.write('\x1b[?1049l');
      say('BYE');
      process.exit(7);
    }
    say(`KEY ${byte.toString(16).padStart(2, '0')}`);
  }
});
