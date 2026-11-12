import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncPrompt, type SyncStep } from '../todo/syncRun';
import { SYNC_ANSWER, SYNC_ANSWER_JSON, type SyncAnswer } from '../todo/todoSchema';
import type { Instructions, SyncAdapter, SyncWords } from './agent';
import type { runOpencode } from './opencode';

export type Rule = { action: string; resource: '*'; effect: 'allow' | 'deny' | 'ask' };

const rule = (action: string, effect: Rule['effect']): Rule => ({ action, resource: '*', effect });

/**
 * Discover sees every tool by name but may call none: a `run` refuses every `ask` (it can't ask anyone), and the
 * built-in tools that act are denied by name too, in case one runs without asking. Read may call the confirmed tools
 * alone; a denied tool is not even offered.
 */
export function syncRules(step: SyncStep, tools: string[]): Rule[] {
  if (step.kind === 'discover') {
    return [rule('*', 'ask'), ...['execute', 'shell', 'write', 'edit', 'subagent', 'webfetch', 'opencode_*'].map((a) => rule(a, 'deny'))];
  }
  return [rule('*', 'deny'), ...tools.map((t) => rule(t, 'allow'))];
}

/** The run's OPENCODE_CONFIG_CONTENT. The rules sit under the run's agent as well, since an agent's own rules come last. */
export function syncConfig(step: SyncStep, tools: string[], instructionsFile: string | null): string {
  const permissions = syncRules(step, tools);
  return JSON.stringify({
    permissions,
    agents: { 'mainframe-sync': { mode: 'primary', steps: 12, permissions }, title: { disabled: true } },
    ...(instructionsFile && { instructions: [instructionsFile] }),
  });
}

/** The project's instructions file: the run has the project's config off, so it is handed by path. */
export function instructionsFileOf(projectDir: string): string | null {
  return ['AGENTS.md', 'CLAUDE.md'].map((f) => join(projectDir, f)).find((f) => existsSync(f)) ?? null;
}

/** A connector's tool, `<server>_<tool>`: OpenCode's own are unprefixed or `opencode_…`. */
export const isOpencodeToolName = (name: string): boolean => /^(?!opencode_)[A-Za-z0-9-]+_[A-Za-z0-9_-]+$/.test(name);

type Event = { type?: string; sessionID?: string; error?: { message?: string; type?: string }; part?: Record<string, unknown> };

function events(stdout: string): Event[] {
  return stdout.split('\n').flatMap((line) => {
    try {
      const e: unknown = JSON.parse(line);
      return typeof e === 'object' && e !== null ? [e as Event] : [];
    } catch {
      return [];
    }
  });
}

/**
 * The run's answer from its JSON events: the text of the message that stopped, checked against SYNC_ANSWER. A run
 * that failed, or that completed a tool outside `tools`, has no answer. Throws an Error whose message is for the panel.
 */
export function readOpencodeAnswer(stdout: string, tools: string[]): SyncAnswer {
  const all = events(stdout);
  const failed = all.find((e) => e.type === 'error');
  if (failed) throw new Error(`The sync run failed: ${failed.error?.message ?? failed.error?.type ?? 'unknown error'}`);
  for (const e of all) {
    const tool = e.part?.tool;
    const status = (e.part?.state as { status?: string } | undefined)?.status;
    if (e.type === 'tool_use' && status === 'completed' && !tools.includes(String(tool))) {
      throw new Error(`The sync used a tool that wasn't allowed: ${String(tool)}`);
    }
  }
  const stopped = all.findLast((e) => e.type === 'step_finish' && e.part?.reason === 'stop')?.part?.messageID;
  if (stopped === undefined) throw new Error('The sync run ended without an answer');
  const text = all
    .filter((e) => e.type === 'text' && e.part?.messageID === stopped)
    .map((e) => String(e.part?.text ?? ''))
    .join('')
    .trim();
  const unfenced = /^```[A-Za-z]*\n([\s\S]*)\n```$/.exec(text)?.[1] ?? text;
  let printed: unknown;
  try {
    printed = JSON.parse(unfenced);
  } catch {
    throw new Error("The sync run's answer wasn't JSON");
  }
  const answer = SYNC_ANSWER.safeParse(printed);
  if (!answer.success) throw new Error("The sync run's answer didn't have the shape Mainframe asked for");
  return answer.data;
}

/** The empty folder the run starts in, so that no project's config or instructions are read from where it runs. */
const runDirOf = (dir: string) => join(dir, 'opencode-run');

/** OpenCode's sync. `run` runs `session delete` after a run; tests hand it a fake. */
export function makeOpencodeSync({ run, instructions }: { run: typeof runOpencode; instructions: Instructions }): SyncAdapter {
  const words: SyncWords = {
    sessions: 'coding agent sessions',
    instructions,
    toolNames: '(as your tool list names them, such as tracker_get_card)',
    noConnector: "Mainframe looked in OpenCode's connectors: set your tracker up there, as an MCP server in OpenCode's config, then sync again.",
  };
  return {
    words,
    prepare: ({ bin, dir, projectDir, env, step, tools, setting }) => {
      if (!setting.syncModel) throw new Error('Pick a model for the sync first');
      const runDir = runDirOf(dir);
      mkdirSync(runDir, { recursive: true });
      return {
        // Never `--auto`: it says yes to every `ask`. `--standalone` keeps a running OpenCode service from taking
        // the run without these rules.
        argv: [bin, 'run', '--standalone', '--format', 'json', '--agent', 'mainframe-sync', '--title', 'sync', '--archived', '-m', setting.syncModel],
        cwd: runDir,
        env: {
          ...env,
          // `run` takes its folder from PWD before its own.
          PWD: runDir,
          OPENCODE_DISABLE_PROJECT_CONFIG: '1',
          OPENCODE_DISABLE_CLAUDE_CODE: '1',
          OPENCODE_CONFIG_CONTENT: syncConfig(step, tools, instructionsFileOf(projectDir)),
        },
      };
    },
    prompt: (step) =>
      `${syncPrompt(step, words)}\n\nAnswer with one JSON object and nothing else, with no code fence. It must match this JSON Schema: ${SYNC_ANSWER_JSON}`,
    readAnswer: readOpencodeAnswer,
    isToolName: isOpencodeToolName,
    // Every run is saved as a session; `--archived` keeps it out of the user's lists until it is gone.
    afterRun: ({ bin, dir, env, stdout }) => {
      const id = events(stdout).find((e) => typeof e.sessionID === 'string')?.sessionID;
      if (id === undefined) return;
      run([bin, '--standalone', 'session', 'delete', id], { cwd: runDirOf(dir), env }).catch(() => {});
    },
  };
}
