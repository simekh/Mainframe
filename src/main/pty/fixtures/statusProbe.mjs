// Stands in for Claude Code at start-up, for statusPassthrough.pty.test.ts: asks whether the
// terminal takes OSC 7501, sends CSI c right after as Claude Code does, notes which answer comes
// back first, then prints two status reports and its findings.

const REPLY = '\x1b]7501;?:';
const DA1_ANSWER = /\x1b\[\?[\d;]*c/;
const WAIT_MS = 3000;

let input = '';
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.resume();

process.stdout.write('\x1b]7501;?\x1b\\');
process.stdout.write('\x1b[c');

const started = Date.now();
await new Promise((resolve) => {
  const poll = setInterval(() => {
    if ((input.includes(REPLY) && DA1_ANSWER.test(input)) || Date.now() - started >= WAIT_MS) {
      clearInterval(poll);
      resolve();
    }
  }, 10);
});

const replyAt = input.indexOf(REPLY);
const da1At = input.search(DA1_ANSWER);
const sawReply = replyAt !== -1;
const sawDa1 = da1At !== -1;
const replyFirst = sawReply && sawDa1 && replyAt < da1At;

process.stdout.write('\x1b]7501;state=working\x1b\\');
process.stdout.write('\x1b]7501;state=blocked:kind=question\x1b\\');
// The wait lets the terminal layer pass everything on before the process ends.
process.stdout.write(`PROBE ${JSON.stringify({ sawReply, sawDa1, replyFirst })}\r\n`, () => {
  setTimeout(() => process.exit(0), 300);
});
