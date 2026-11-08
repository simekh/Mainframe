import { spawn } from 'node:child_process';
import type { TodoListRef } from '../../shared/types';
import { SYNC_ANSWER, SYNC_ANSWER_JSON, type SyncAnswer } from './todoSchema';

/** A sync run is stopped after this long. */
export const SYNC_TIMEOUT_MS = 5 * 60_000;

/** The outcome a stopped sync's callers get: what `runClaude` rejects with for a run that was cancelled. */
export const SYNC_STOPPED = 'The sync was stopped';

/** The first sync finds the connector; later ones read the list (the one the owner picked, if there was a choice). */
export type SyncStep = { kind: 'discover' } | { kind: 'read'; list: TodoListRef | null };

/** A connector's tool: the only kind of tool the owner may confirm for a sync. */
export const isMcpToolName = (name: string): boolean => /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(name);

/** The background run: no built-in tools, no questions, one structured answer. */
export function syncArgv(claudeBin: string, settingsPath: string): string[] {
  return [
    claudeBin,
    '-p',
    '--model',
    'haiku',
    '--no-session-persistence',
    '--tools',
    '',
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--settings',
    settingsPath,
    '--output-format',
    'json',
    '--json-schema',
    SYNC_ANSWER_JSON,
    '--max-budget-usd',
    '1',
  ];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The run's `--settings`, as JSON text. A PreToolUse hook blocks every tool but the answer's own and the confirmed
 * ones (it exits 2 before any allow rule is read, so it also blocks what the owner's own settings allow), and those
 * are allowed here because `dontAsk` would deny them. `--settings` outranks the owner's and the project's settings, so
 * `disableAllHooks` is set to false: with it true there, the guard would never run.
 */
export function syncSettings(allowTools: string[]): string {
  const letThrough = ['StructuredOutput', ...allowTools.map(escapeRegExp)].join('|');
  return JSON.stringify({
    ...(allowTools.length > 0 ? { permissions: { allow: allowTools } } : {}),
    disableAllHooks: false,
    hooks: {
      PreToolUse: [
        {
          matcher: `^(?!(${letThrough})$)`,
          hooks: [
            {
              type: 'command',
              command: `echo "Mainframe's sync may only read the to-do list." >&2; exit 2`,
              timeout: 10,
            },
          ],
        },
      ],
    },
  });
}

const INTRO = `Mainframe, the app that runs this project's Claude Code sessions, shows the owner's to-do list for this project in its Todo panel.`;

const DISCOVER = [
  INTRO,
  `This run only finds where that list is: don't call any tool.`,
  `Look at the tools your connectors (MCP servers) give you, and find the connector that holds the owner's to-do list: a task tracker such as Trello, Linear, Jira or GitHub Issues, or the one this repo's CLAUDE.md names. Answer kind "tools" with that connector's name as the owner would know it, and the full names (mcp__…) of the tools a run needs to find the to-do list and read its cards: only tools that read, such as list, get or search. Never name a tool that creates, changes, moves or deletes anything.`,
  `If no connector holds a to-do list, answer kind "none" with a message that tells the owner so.`,
];

const READ_FIND_LIST = `Find the list that holds the work still to do: the one this repo's CLAUDE.md names, or else the one named like To do, Todo or Backlog. If exactly one list is clearly it, read it. If several could be, don't read any cards: answer kind "lists" with each candidate's name, the board or project it belongs to, and its URL.`;

const READ_ANSWER = [
  `Answer kind "cards" with the source (the service's name, such as Trello; the board or project; the list; the list's URL) and every card in the list's order. Copy each card's title, description and checklist items word for word, and give its id, its short number as the service shows it (such as #128), its labels and its URL. Mark a card forOwner when this repo's CLAUDE.md says cards like it are for the owner rather than for an agent, and urgent when it says cards like it come first; otherwise leave both false.`,
  `If you can't read the list, answer kind "none" with a message that tells the owner why.`,
];

/** What the run is asked, on stdin. */
export function syncPrompt(step: SyncStep): string {
  if (step.kind === 'discover') return DISCOVER.join('\n\n');
  const { list } = step;
  const which = list
    ? `Read the list "${list.name}"${list.board ? ` on "${list.board}"` : ''}${list.url ? ` (${list.url})` : ''}.`
    : READ_FIND_LIST;
  return [
    INTRO,
    `Read that list with your connector's tools and answer with its cards. Only read: never create, change, move or delete anything.`,
    which,
    ...READ_ANSWER,
  ].join('\n\n');
}

/** What a run printed, as its answer. Throws an Error whose message is for the panel. */
export function readSyncAnswer(stdout: string): SyncAnswer {
  let printed: unknown;
  try {
    printed = JSON.parse(stdout);
  } catch {
    printed = null;
  }
  if (typeof printed !== 'object' || printed === null) throw new Error("The sync run printed something Mainframe can't read");
  const { is_error, subtype, result, structured_output } = printed as Record<string, unknown>;
  const said = typeof result === 'string' && result !== '' ? result : undefined;
  if (is_error === true || subtype !== 'success') throw new Error(said ?? `The sync run stopped (${String(subtype)})`);
  if (structured_output === undefined || structured_output === null) throw new Error(said ?? 'The sync run gave no answer');
  const answer = SYNC_ANSWER.safeParse(structured_output);
  if (!answer.success) throw new Error("The sync run's answer didn't have the shape Mainframe asked for");
  return answer.data;
}

/**
 * Runs `argv` (never through a shell) with `input` on stdin. It resolves with stdout whenever there is any, whatever
 * the exit code, since `claude -p` prints its JSON when it fails too. It settles once; `cancel` and the time limit
 * stop the program with SIGTERM.
 */
export function runClaude(o: {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  timeoutMs: number;
}): { done: Promise<string>; cancel(): void } {
  let cancel!: () => void;
  const done = new Promise<string>((resolve, reject) => {
    const child = spawn(o.argv[0], o.argv.slice(1), { cwd: o.cwd, env: o.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const stop = (message: string) =>
      settle(() => {
        child.kill('SIGTERM');
        reject(new Error(message));
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
        reject(new Error(lastLine ?? `claude exited with code ${code}`));
      }),
    );
    // A run that exits before it has read its prompt breaks the pipe; its exit already says why.
    child.stdin.on('error', () => {});
    child.stdin.end(o.input);
  });
  return { done, cancel };
}
