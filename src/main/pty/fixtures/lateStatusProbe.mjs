// Stands in for Claude Code resuming a long chat under load, for earlyStatus.pty.test.ts: its screen takes input
// (raw mode, bracketed paste on) and its OSC 7501 probe starts waiting for the reply, but the query itself gets out only
// after its first screens, past the wait. It counts a reply read during the wait, and reports status only then.

const WAIT_MS = 1000;
const QUERY_AFTER_MS = 1500;

let input = '';
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.resume();

process.stdout.write('\x1b[?2004h');
await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
const replied = input.includes('\x1b]7501;?');
await new Promise((resolve) => setTimeout(resolve, QUERY_AFTER_MS - WAIT_MS));
process.stdout.write('\x1b]7501;?\x1b\\\x1b[c');
if (replied) process.stdout.write('\x1b]7501;state=idle\x1b\\');
// The wait lets the terminal layer pass everything on before the process ends.
process.stdout.write(`PROBE ${JSON.stringify({ replied })}\r\n`, () => {
  setTimeout(() => process.exit(0), 300);
});
