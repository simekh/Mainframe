import { execFile, spawn } from 'node:child_process';
import { basename, win32 } from 'node:path';
import type { TodoListRef } from '../../shared/types';
import type { SyncWords } from '../agents/agent';

/** A sync run is stopped after this long. */
export const SYNC_TIMEOUT_MS = 5 * 60_000;

/** After this long a running sync says it is still going and may use a lot of tokens. */
export const LONG_SYNC_MS = 2 * 60_000;

/** The outcome a stopped sync's callers get: what `runSync` rejects with for a run that was cancelled. */
export const SYNC_STOPPED = 'The sync was stopped';

/** The first sync finds the connector; later ones read the list (the one the owner picked, if there was a choice). */
export type SyncStep = { kind: 'discover' } | { kind: 'read'; list: TodoListRef | null };

const intro = (w: SyncWords) =>
  `Mainframe, the app that runs this project's ${w.sessions}, shows the owner's to-do list for this project in its Todo panel.`;

const discover = (w: SyncWords) => [
  intro(w),
  `This run only finds where that list is: don't call any tool.`,
  `Look at the tools your connectors (MCP servers) give you, and find the connector that holds the owner's to-do list: a task tracker such as Trello, Linear, Jira or GitHub Issues, or the one ${w.instructions.first} names. Answer kind "tools" with that connector's name as the owner would know it, and the full names ${w.toolNames} of the tools a run needs to find the to-do list and read its cards: only tools that read, such as list, get or search. Never name a tool that creates, changes, moves or deletes anything.`,
  `If no connector holds a to-do list, answer kind "none" with a message that tells the owner so.`,
];

const readFindList = (w: SyncWords) =>
  `Find the list that holds the work still to do: the one ${w.instructions.first} names, or else the one named like To do, Todo or Backlog. If exactly one list is clearly it, read it. If several could be, don't read any cards: answer kind "lists" with each candidate's name, the board or project it belongs to, and its URL.`;

/** `instructions` names the repo's instructions as this point of the prompt does: in full where it mentions them first. */
const readAnswer = (instructions: string) => [
  `Answer kind "cards" with the source (the service's name, such as Trello; the board or project; the list; the list's URL) and every card in the list's order. Copy each card's title, description and checklist items word for word, and give its id (the service's own id for the card, exactly as its tools return it, so that it stays the same on every sync), its short number as the service shows it (such as #128), its labels and its URL. Mark a card forOwner when ${instructions} says cards like it are for the owner rather than for an agent, and urgent when it says cards like it come first; otherwise leave both false.`,
  `If you can't read the list, or any of it, answer kind "none" with a message that tells the owner why: answer kind "cards" only with every card the list holds, and with no cards only when it holds none.`,
];

/** What the run is asked, on stdin, in the words of the agent that runs it. */
export function syncPrompt(step: SyncStep, words: SyncWords): string {
  if (step.kind === 'discover') return discover(words).join('\n\n');
  const { list } = step;
  // Quoted as JSON: they come from an earlier answer, from the tracker, and text in them stays inside the quotes.
  const q = JSON.stringify;
  const which = list
    ? `Read the list ${q(list.name)}${list.board ? ` on ${q(list.board)}` : ''}${list.url ? ` (${q(list.url)})` : ''}.`
    : readFindList(words);
  return [
    intro(words),
    `Read that list with your connector's tools and answer with its cards. Only read: never create, change, move or delete anything.`,
    which,
    ...readAnswer(list ? words.instructions.first : words.instructions.again),
  ].join('\n\n');
}

/**
 * Ends `pid` and every process it started: on Windows `child.kill` ends only the program itself, and a sync's
 * connectors (MCP servers) are its children. Errors are ignored, since the tree may already be gone.
 */
function taskkillTree(pid: number): void {
  const taskkill = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  execFile(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}

/**
 * Runs `argv` (never through a shell) with `input` on stdin. It resolves with stdout whenever there is any, whatever
 * the exit code, since a headless run can print its answer when it fails too. It settles once; `cancel` and the time
 * limit stop the program: with SIGTERM, and on Windows (`platform`) by `killTree`, which ends its whole process tree.
 * A stopped run that had printed something rejects with an Error that carries it as `stdout`.
 */
export function runSync(o: {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  timeoutMs: number;
  platform?: NodeJS.Platform;
  killTree?: (pid: number) => void;
}): { done: Promise<string>; cancel(): void } {
  const { platform = process.platform, killTree = taskkillTree } = o;
  let cancel!: () => void;
  const done = new Promise<string>((resolve, reject) => {
    const child = spawn(o.argv[0], o.argv.slice(1), { cwd: o.cwd, env: o.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    // A run that never started (no pid) is left alone: ending it throws on Windows, and signals the caller's own
    // process group on a POSIX system. So is one that has exited, which can still be unsettled while a connector holds
    // its stdout open: Windows may have given its pid to another process by now. A failure to end a run is logged: the
    // stop has been answered by then.
    const endChild = () => {
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (platform === 'win32') killTree(child.pid);
        else child.kill('SIGTERM');
      } catch (err) {
        console.warn(`[todo] could not end the sync run of ${o.cwd}`, err);
      }
    };
    const stop = (message: string) =>
      settle(() => {
        reject(Object.assign(new Error(message), stdout !== '' && { stdout }));
        endChild();
      });
    const timer = setTimeout(
      () => stop(`The sync took longer than ${Math.round(o.timeoutMs / 60_000)} minutes and was stopped`),
      o.timeoutMs,
    );
    cancel = () => stop(SYNC_STOPPED);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => settle(() => reject(new Error(`Could not run ${o.argv[0]}: ${err.message}`))));
    child.on('close', (code) =>
      settle(() => {
        if (stdout !== '') return resolve(stdout);
        const lastLine = stderr
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .at(-1);
        reject(new Error(lastLine ?? `${basename(o.argv[0])} exited with code ${code}`));
      }),
    );
    // A run that exits before it has read its prompt breaks the pipe; its exit already says why.
    child.stdin.on('error', () => {});
    child.stdin.end(o.input);
  });
  return { done, cancel };
}
