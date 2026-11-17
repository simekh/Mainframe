import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type Run = (argv: string[], o: { cwd: string; env: Record<string, string> }) => Promise<string>;

const MAX_OUTPUT = 16 * 1024 * 1024;
const AGENTS_MD_HEADING = '# AGENTS.md instructions for ';
const ENVIRONMENT_CONTEXT = '<environment_context>';

/** The texts of the user messages' `input_text` parts, skipping anything not in that shape. */
const userTexts = (items: unknown[]): string[] =>
  items.flatMap((item) => {
    const { type, role, content } = (item ?? {}) as { type?: unknown; role?: unknown; content?: unknown };
    if (type !== 'message' || role !== 'user' || !Array.isArray(content)) return [];
    return content.flatMap((part) => (part?.type === 'input_text' && typeof part.text === 'string' ? [part.text as string] : []));
  });

/** Runs codex with no shell and resolves with stdout. What it prints holds the project's instructions, so it is never logged. */
const runCodex: Run = async ([file, ...args], o) =>
  (await execFileAsync(file, args, { cwd: o.cwd, env: o.env, encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: MAX_OUTPUT })).stdout;

/**
 * True when the project has a CLAUDE.md but no AGENTS.md and Codex, asked offline what it would send, prints its
 * environment context but no AGENTS.md instructions: the user's Codex config doesn't list CLAUDE.md. Any doubt (Codex
 * failing, output without the environment context) is false: a wrong note is worse than none.
 */
export async function codexMissesClaudeMd(o: { bin: string; projectDir: string; env: Record<string, string>; run?: Run }): Promise<boolean> {
  const { bin, projectDir, env, run = runCodex } = o;
  if (!existsSync(join(projectDir, 'CLAUDE.md')) || existsSync(join(projectDir, 'AGENTS.md'))) return false;
  try {
    const items: unknown = JSON.parse(await run([bin, 'debug', 'prompt-input'], { cwd: projectDir, env }));
    if (!Array.isArray(items)) return false;
    const texts = userTexts(items);
    return texts.some((text) => text.startsWith(ENVIRONMENT_CONTEXT)) && !texts.some((text) => text.startsWith(AGENTS_MD_HEADING));
  } catch {
    return false;
  }
}

/** Codex's user config file: `$CODEX_HOME/config.toml`, else `.codex/config.toml` in the home folder. */
export function codexConfigFile(env: Record<string, string>, platform: NodeJS.Platform): string {
  const path = platform === 'win32' ? win32 : posix;
  const home = env.CODEX_HOME || path.join((platform === 'win32' ? env.USERPROFILE : env.HOME) ?? '', '.codex');
  return path.join(home, 'config.toml');
}
