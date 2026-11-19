#!/usr/bin/env node
// Stands in for `claude` in e2e tests: answers `--version`; otherwise records its working directory and
// arguments, then runs a plain shell so the terminal tests can type into it. CommonJS with built-ins
// only, so on Windows the same file builds into a real .exe (e2e/globalSetup.ts). It stands in for
// `opencode` and `codex` too: run through e2e/fake-opencode.cjs or e2e/fake-codex.cjs, or on Windows as the
// copies named fake-opencode.exe and fake-codex.exe.
'use strict';
const { execFileSync, spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { request } = require('node:http');
const { basename, dirname, join } = require('node:path');

const args = process.argv.slice(2);
const logDir = process.env.FAKE_CLAUDE_LOG_DIR;
/** This run's own file in the log folder, `<pid>.<ext>`. */
const own = (ext) => join(logDir, `${process.pid}.${ext}`);
const isOpencode = process.env.FAKE_AGENT === 'opencode' || basename(process.execPath).startsWith('fake-opencode');
const isCodex = process.env.FAKE_AGENT === 'codex' || basename(process.execPath).startsWith('fake-codex');

// Mainframe's start check, not a launch: nothing is recorded. FAKE_CLAUDE_VERSION sets the answer, and
// FAKE_CLAUDE_VERSION_DELAY_MS holds it back, as a slow real claude does, so the window is up before the projects open.
const versionCheck = args[0] === '--version';
// Codex's `debug prompt-input`, the New task box's CLAUDE.md check: not a launch either, so nothing is recorded.
const promptInput = isCodex && args[0] === 'debug' && args[1] === 'prompt-input';
// Codex's `mcp list --json`, which the sync asks before each run: not a launch, so nothing is recorded.
const mcpList = isCodex && args[0] === 'mcp' && args[1] === 'list';
// Codex's `debug models`, the New task box's model list: not a launch, so nothing is recorded; an empty catalog.
const modelList = isCodex && args[0] === 'debug' && args[1] === 'models';
const recorded = !versionCheck && !promptInput && !mcpList && !modelList;

// As OpenCode or Codex, a launch also records the environment Mainframe sets for it in <pid>.env, written first:
// the tests wait on <pid>.argv. That is every OPENCODE_ variable, and PWD, where `run` and `api` take their folder from;
// for Codex, the MAINFRAME_MCP_TOKEN its manager reads.
if (logDir && recorded && (isOpencode || isCodex)) {
  const kept = (key) => (isCodex ? key === 'MAINFRAME_MCP_TOKEN' : key.startsWith('OPENCODE_') || key === 'PWD');
  const env = Object.entries(process.env).filter(([key]) => kept(key));
  writeFileSync(own('env'), JSON.stringify(Object.fromEntries(env)));
}
if (recorded) addWorktree();
if (logDir && recorded) writeFileSync(own('argv'), [process.cwd(), ...args].map((arg) => `${arg}\0`).join(''));

if (versionCheck && isOpencode) {
  process.stdout.write(`opencode v${process.env.FAKE_OPENCODE_VERSION ?? '2.2.7'}\n`);
} else if (versionCheck && isCodex) {
  process.stdout.write(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? '0.169.0'}\n`);
} else if (promptInput) {
  promptInputItems();
} else if (modelList) {
  process.stdout.write('{"models":[]}');
} else if (mcpList) {
  // What the test wrote in codex-mcp-list.json, else no server.
  const file = logDir && join(logDir, 'codex-mcp-list.json');
  process.stdout.write(file && existsSync(file) ? readFileSync(file) : '[]');
} else if (versionCheck) {
  const answer = () => process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? '2.1.999'} (Claude Code)\n`);
  setTimeout(answer, Number(process.env.FAKE_CLAUDE_VERSION_DELAY_MS ?? 0));
} else if (process.env.FAKE_CLAUDE_BRIDGE === '1') {
  // bridge.e2e.ts: some output and a status over OSC 7501, then a clean exit a moment later.
  process.stdout.write('bridge-ok\x1b]7501;state=working\x1b\\');
  setTimeout(() => {}, 300);
} else if (args[0] === '-p' || (isOpencode && args[0] === 'run') || (isCodex && args[0] === 'exec')) {
  sync();
} else if (isOpencode && args[0] === '--standalone' && args[1] === 'api') {
  api(args[2]);
} else if (isOpencode && args[0] === '--standalone' && args[1] === 'session') {
  // `session delete` after a sync run: nothing to do.
} else if (process.env.FAKE_CLAUDE_RAW === '1') {
  raw();
} else if (process.env.FAKE_CLAUDE_IMAGES === '1') {
  askStatusSupport(labelImages);
} else if (isCodex && process.env.FAKE_CODEX_SESSION_ID) {
  callMainframe(process.env.FAKE_CODEX_SESSION_ID, session);
} else {
  session();
}

/**
 * As Codex's manager does once its chat begins: one `list_sessions` call to Mainframe's server from the `-c` settings,
 * with the token from the environment, naming the chat in `_meta` as Codex does. Records the answer's status in
 * <pid>.called, then goes `on`. A launch with no such server goes on at once.
 */
function callMainframe(sessionId, on) {
  const prefix = 'mcp_servers.mainframe.url=';
  const setting = args.find((arg) => arg.startsWith(prefix));
  if (!setting) return on();
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_sessions', arguments: {}, _meta: { sessionId } } });
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${process.env.MAINFRAME_MCP_TOKEN}`,
  };
  const req = request(JSON.parse(setting.slice(prefix.length)), { method: 'POST', headers }, (res) => {
    res.resume();
    res.on('end', () => {
      writeFileSync(own('called'), String(res.statusCode));
      on();
    });
  });
  // No server to answer: the shell runs all the same, and no call is recorded.
  req.on('error', () => on());
  req.end(body);
}

/**
 * With `-w <slug>` or `--worktree <slug>`, makes the task's worktree as `claude -w` does, before anything else (the
 * tests wait on <pid>.argv): branch worktree-<slug> from origin/HEAD, else HEAD, in .claude/worktrees/<slug>. A
 * branch that is there is checked out again; a folder that is there is left alone. Outside a repo it does nothing.
 */
function addWorktree() {
  const at = args.findIndex((arg) => arg === '-w' || arg === '--worktree');
  const slug = at >= 0 ? args[at + 1] : undefined;
  if (!slug) return;
  const folder = join('.claude', 'worktrees', slug);
  if (existsSync(folder)) return;
  const git = (...gitArgs) => execFileSync('git', gitArgs, { stdio: 'pipe' });
  try {
    const branch = `worktree-${slug}`;
    let branchExists = true;
    try {
      git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    } catch {
      branchExists = false;
    }
    if (branchExists) {
      git('worktree', 'add', folder, branch);
      return;
    }
    let base = 'origin/HEAD';
    try {
      git('rev-parse', '--verify', '--quiet', base);
    } catch {
      base = 'HEAD';
    }
    git('worktree', 'add', '--no-track', '-b', branch, folder, base);
  } catch {
    // Not a repo, or git refused: the session runs without a worktree, as before.
  }
}

/**
 * `codex debug prompt-input`: prints codex-prompt-input.json from the log folder when the test wrote one, else only
 * the environment context, which loads no AGENTS.md instructions.
 */
function promptInputItems() {
  const file = logDir && join(logDir, 'codex-prompt-input.json');
  const environment = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n</environment_context>' }] }];
  process.stdout.write(file && existsSync(file) ? readFileSync(file) : JSON.stringify(environment));
}

/**
 * Reads the terminal in raw mode, as Claude Code does, and shows each resize it sees and each chunk
 * it reads, a line each: `resized: <cols>x<rows>` and `read: <the chunk as JSON>`.
 */
function raw() {
  process.stdin.setRawMode(true);
  process.stdin.on('data', (chunk) => process.stdout.write(`read: ${JSON.stringify(chunk.toString())}\r\n`));
  process.stdout.on('resize', () => process.stdout.write(`resized: ${process.stdout.columns}x${process.stdout.rows}\r\n`));
  process.stdout.write('$ ');
}

/**
 * Takes a pasted image as Claude Code does: asks for bracketed paste, and for each existing `.png` or `.jpg` path in a
 * bracketed paste prints `[Image #N]`, counting from 1 and never reusing a number. Escaped paths (quoted on Windows) are
 * read back as escapePath wrote them. Says it is idle over OSC 7501, and prints `$ `, as the tests wait for a prompt.
 * Backspace takes the last image off the prompt: the screen is drawn again without its label. Enter sends the prompt:
 * a turn (working, then done) whose output scrolls the labels off the screen.
 */
function labelImages() {
  let count = 0;
  let input = '';
  const prompt = [];
  const status = (state) => process.stdout.write(`\x1b]7501;state=${state}\x1b\\`);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (chunk === '\x7f') {
      prompt.pop();
      process.stdout.write(`\x1b[2J\x1b[H${prompt.map((n) => `[Image #${n}]\r\n`).join('')}$ `);
      return;
    }
    if (chunk === '\r') {
      status('working');
      prompt.length = 0;
      process.stdout.write(`${Array.from({ length: 100 }, (_, i) => `output ${i}\r\n`).join('')}$ `);
      status('done');
      return;
    }
    input += chunk;
    for (let m; (m = /\x1b\[200~([\s\S]*?)\x1b\[201~/.exec(input)); input = input.slice(m.index + m[0].length)) {
      const words = process.platform === 'win32' ? m[1].match(/"[^"]*"|\S+/g) : m[1].match(/(?:\\.|[^\s\\])+/g);
      for (const word of words ?? []) {
        const path = process.platform === 'win32' ? word.replace(/^"|"$/g, '') : word.replace(/\\(.)/g, '$1');
        if (/\.(png|jpg)$/i.test(path) && existsSync(path)) {
          prompt.push(++count);
          process.stdout.write(`[Image #${count}]\r\n`);
        }
      }
    }
  });
  // askStatusSupport paused it.
  process.stdin.resume();
  status('idle');
  process.stdout.write('\x1b[?2004h$ ');
}

/**
 * `opencode api <op>`: prints opencode-<op>.json from the log folder when the test wrote one. Otherwise `agent.list`
 * and `model.list` print a default in OpenCode's shape, each with a secret in it, as a user's lists can have.
 */
function api(op) {
  const file = join(logDir, `opencode-${op}.json`);
  if (existsSync(file)) {
    process.stdout.write(readFileSync(file));
    return;
  }
  const price = (input, output) => ({ input, output, cache: { read: 0, write: 0 } });
  const model = (id, name, cost, more = {}) => ({
    id, modelID: id, providerID: 'prov', name, capabilities: {}, variants: [], time: { released: 1 },
    status: 'active', enabled: true, limit: { context: 1, output: 1 }, cost, ...more,
  });
  const data = {
    'agent.list': [
      { id: 'build', mode: 'primary', hidden: false, request: { headers: { Authorization: 'Bearer fake-agent-secret' } } },
      { id: 'plan', mode: 'primary', hidden: false },
      { id: 'general', mode: 'subagent', hidden: false },
    ],
    'model.list': [
      model('cheap', 'Cheap model', [price(0.11, 0.55)], { settings: { apiKey: 'sk-fake-secret' } }),
      model('dear', 'Dear model', [price(2.4, 12)]),
      model('unknown', 'Unknown model', []),
    ],
  }[op];
  process.stdout.write(JSON.stringify({ location: { directory: process.env.PWD }, data: data ?? [] }));
}

/**
 * A sync is a `claude -p`, `opencode run` or `codex exec` run: it records the prompt it reads on stdin, and prints what the
 * test put in sync-reply.json as its answer, JSON events for OpenCode and Codex (nothing without one, which Mainframe reads as a failed run). While
 * sync-hold is in the folder, it waits instead of replying, and records that it waits in <pid>.holding.
 * Mainframe stops a run with SIGTERM: it is recorded in <pid>.sigterm, after the run has printed its
 * reply as it went, like a run that answers just as it is stopped. It ends by an empty event loop, never
 * process.exit(), so what it printed reaches the pipe in full.
 */
function sync() {
  const replyFile = join(logDir, 'sync-reply.json');
  const holdFile = join(logDir, 'sync-hold');
  const reply = () => {
    if (existsSync(replyFile)) process.stdout.write(readFileSync(replyFile));
  };
  const prompt = [];
  process.stdin.on('data', (chunk) => prompt.push(chunk));
  process.stdin.on('end', () => {
    writeFileSync(own('stdin'), Buffer.concat(prompt));
    let wait;
    process.once('SIGTERM', () => {
      clearTimeout(wait);
      reply();
      writeFileSync(own('sigterm'), '');
      process.exitCode = 143;
    });
    let holding = false;
    const hold = () => {
      if (existsSync(holdFile)) {
        if (!holding) writeFileSync(own('holding'), '');
        holding = true;
        wait = setTimeout(hold, 50);
      } else reply();
    };
    hold();
  });
}

/**
 * What Mainframe's SessionStart hook does once Claude Code has begun the conversation: it writes
 * session-start.json beside the --settings file, naming the conversation, how it began and its transcript.
 * Reopen resumes the id it holds; the manager only if the chat was saved, when it began or was cleared.
 * This one saves the chat at once, as if a message had been sent, under projects/ beside the other logs,
 * never in ~/.claude. Then it asks for OSC 7501 as Claude Code does (askStatusSupport) and runs the shell, which
 * has the terminal to itself: past the answer this process reads no stdin, so every key typed reaches the shell.
 */
function session() {
  let settings = '';
  let id = '';
  let source = '';
  // A flag counts only with a value after it.
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--settings') settings = args[i + 1];
    else if (args[i] === '--session-id') [id, source] = [args[i + 1], 'startup'];
    else if (args[i] === '--resume') [id, source] = [args[i + 1], 'resume'];
  }
  if (settings && id && logDir) {
    const transcript = join(logDir, 'projects', '-fake-project', `${id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, '');
    const started = { session_id: id, source, transcript_path: transcript };
    writeFileSync(join(dirname(settings), 'session-start.json'), JSON.stringify(started));
  }
  // Set before the question, so a hang-up while it waits is held too.
  // With FAKE_CLAUDE_HANGUP_DELAY_MS, a hang-up ends this process only that long after, as a real claude may
  // take to save its chat, and it records its end in <pid>.ended. A second hang-up, which the system sends once
  // Mainframe has gone, ends it at once, with no record.
  const hangupDelay = process.env.FAKE_CLAUDE_HANGUP_DELAY_MS;
  if (hangupDelay) {
    process.once('SIGHUP', () =>
      setTimeout(() => {
        writeFileSync(own('ended'), '');
        process.kill(process.pid, 'SIGHUP');
      }, Number(hangupDelay)),
    );
  }
  askStatusSupport(runShell);
}

/**
 * Asks whether the terminal takes OSC 7501, as Claude Code and OpenCode do at start, and reads the answer in raw mode
 * before the shell has the terminal. Mainframe answers a Claude session early, from when its screen turns bracketed paste
 * on, until it asks: bash 5 turns that on at its prompt, and would take each early answer as typing.
 */
function askStatusSupport(then) {
  if (!process.stdin.isTTY) return then();
  let input = '';
  // Reading stops before raw mode goes: on Windows a mode change while reading starts a console read of its own, which
  // would compete with the shell's. The shell starts once the stop has taken.
  const done = () => {
    clearTimeout(giveUp);
    process.stdin.off('data', onData);
    process.stdin.pause();
    process.stdin.setRawMode(false);
    setImmediate(then);
  };
  const onData = (chunk) => {
    input += chunk;
    if (/\x1b\]7501;\?[^\x1b]*\x1b\\/.test(input)) done();
  };
  // Mainframe answers at once; the wait is long, so a slow machine's answer still reaches this process, not the shell.
  const giveUp = setTimeout(done, 10_000);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onData);
  process.stdout.write('\x1b]7501;?\x1b\\');
}

function runShell() {
  // On Windows, Git Bash by its full path (e2e/globalSetup.ts finds it and names it here): a `bash` on the PATH there can be WSL's.
  const shell = process.env.FAKE_CLAUDE_SHELL || '/bin/bash';
  const child = spawn(shell, ['--noprofile', '--norc'], { stdio: 'inherit' });
  // Ends as the shell did. A hang-up from Mainframe ends this process, and the system then hangs up the
  // shell, which holds the terminal's foreground; on Windows node-pty's kill ends every process on the console.
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code;
  });
}
