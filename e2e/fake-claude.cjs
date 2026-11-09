#!/usr/bin/env node
// Stands in for `claude` in e2e tests: records its working directory and arguments, then runs a plain
// shell so the terminal tests can type into it. CommonJS with built-ins only, so on Windows the same
// file builds into a real .exe (e2e/globalSetup.ts).
'use strict';
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const args = process.argv.slice(2);
const logDir = process.env.FAKE_CLAUDE_LOG_DIR;
/** This run's own file in the log folder, `<pid>.<ext>`. */
const own = (ext) => join(logDir, `${process.pid}.${ext}`);

if (logDir) writeFileSync(own('argv'), [process.cwd(), ...args].map((arg) => `${arg}\0`).join(''));

if (process.env.FAKE_CLAUDE_BRIDGE === '1') {
  // bridge.e2e.ts: some output and a status over OSC 7501, then a clean exit a moment later.
  process.stdout.write('bridge-ok\x1b]7501;state=working\x1b\\');
  setTimeout(() => {}, 300);
} else if (args[0] === '-p') {
  sync();
} else if (process.env.FAKE_CLAUDE_RAW === '1') {
  raw();
} else {
  session();
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
 * A sync is a `claude -p` run: it records the prompt it reads on stdin, and prints what the test put in
 * sync-reply.json as its answer (nothing without one, which Mainframe reads as a failed run). While
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
 * never in ~/.claude. Then it runs the shell, which has the terminal to itself: this process never reads
 * stdin, so every key typed reaches the shell.
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
  // Git Bash on Windows by its full path: a `bash` on the PATH there can be WSL's.
  const shell =
    process.env.FAKE_CLAUDE_SHELL ||
    (process.platform === 'win32' ? join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : '/bin/bash');
  const child = spawn(shell, ['--noprofile', '--norc'], { stdio: 'inherit' });
  // Ends as the shell did. A hang-up from Mainframe ends this process, and the system then hangs up the
  // shell, which holds the terminal's foreground; on Windows node-pty's kill ends every process on the console.
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code;
  });
}
