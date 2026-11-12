import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYNC_ANSWER, SYNC_ANSWER_JSON, type SyncAnswer } from '../todo/todoSchema';
import type { SyncAdapter, SyncRunSpec } from './agent';

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

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The run's `--settings`, as JSON text. A PreToolUse hook blocks every tool but the answer's own and the confirmed
 * ones (it exits 2 before any allow rule is read, so it also blocks what the owner's own settings allow), and those
 * are allowed here because `dontAsk` would deny them. `--settings` outranks the owner's and the project's settings, so
 * `disableAllHooks` is set to false: with it true there, the guard would never run. The guard is `nodeBin` run with no
 * shell; `onFailure: 'block'` stops the call when it can't start, since a guard that doesn't run lets every tool through.
 */
export function syncSettings(nodeBin: string, allowTools: string[]): string {
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
              command: nodeBin,
              // exitCode, not exit(): the message reaches the pipe in full before node ends.
              args: ['-e', 'process.stderr.write(process.argv[1]);process.exitCode=2', "Mainframe's sync may only read the to-do list."],
              timeout: 10,
              onFailure: 'block',
            },
          ],
        },
      ],
    },
  });
}

/** Writes the run's `--settings` into the project's Todo folder, with `tools` allowed, and returns the run. */
export function prepareClaudeSync(o: Parameters<SyncAdapter['prepare']>[0]): SyncRunSpec {
  const settingsPath = join(o.dir, 'sync-settings.json');
  try {
    mkdirSync(o.dir, { recursive: true });
    writeFileSync(settingsPath, syncSettings(o.nodeBin, o.tools));
  } catch (err) {
    throw new Error(`Could not write the sync's settings: ${(err as Error).message}`);
  }
  return { argv: syncArgv(o.bin, settingsPath), cwd: o.projectDir, env: o.env };
}

/**
 * What a run printed, as its answer. Throws an Error whose message is for the panel.
 *
 * An answer counts however the run ended: it can answer and then end oddly. Without one, the message says how the run
 * ended, then the CLI's own reasons (`errors`), else the run's last words (`result`), which alone would read as if
 * Mainframe said them. Claude Code can also take an answer back (after a model switch); the run then ends without one.
 */
export function readSyncAnswer(stdout: string): SyncAnswer {
  let printed: unknown;
  try {
    printed = JSON.parse(stdout);
  } catch {
    printed = null;
  }
  if (typeof printed !== 'object' || printed === null) throw new Error("The sync run printed something Mainframe can't read");
  const { is_error, subtype, num_turns, errors, result, structured_output } = printed as Record<string, unknown>;
  if (structured_output === undefined || structured_output === null) {
    const ended = is_error === true && subtype === 'success' ? 'error' : String(subtype);
    const how = typeof num_turns === 'number' ? `${ended}, ${num_turns} turns` : ended;
    const reasons = Array.isArray(errors) ? errors.filter((e) => typeof e === 'string' && e !== '').join('; ') : '';
    const said = reasons || (typeof result === 'string' ? result : '');
    const shown = said.length > 300 ? `${said.slice(0, 300)}…` : said;
    throw new Error(`The sync run ended without an answer (${how})${shown ? `: ${shown}` : ''}`);
  }
  const answer = SYNC_ANSWER.safeParse(structured_output);
  if (!answer.success) throw new Error("The sync run's answer didn't have the shape Mainframe asked for");
  return answer.data;
}
