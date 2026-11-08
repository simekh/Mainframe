import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SYNC_ANSWER_JSON } from './todoSchema';
import { isMcpToolName, readSyncAnswer, runClaude, syncArgv, syncPrompt, syncSettings } from './syncRun';

interface Settings {
  permissions?: { allow: string[] };
  hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string; timeout: number }[] }[] };
}

const hook = (settings: string) => (JSON.parse(settings) as Settings).hooks.PreToolUse[0];

it('syncArgv is the background run, with the schema and the settings file', () => {
  expect(syncArgv('/bin/claude', '/data/sync-settings.json')).toEqual([
    '/bin/claude',
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
    '/data/sync-settings.json',
    '--output-format',
    'json',
    '--json-schema',
    SYNC_ANSWER_JSON,
    '--max-budget-usd',
    '1',
  ]);
});

describe('syncSettings', () => {
  it('the hook blocks every tool but StructuredOutput and the allowed ones', () => {
    const settings = syncSettings(['mcp__tracker__get_list']);
    const blocks = new RegExp(hook(settings).matcher);
    for (const name of ['Bash', 'mcp__tracker__update_card', 'StructuredOutputX', 'xStructuredOutput']) {
      expect(blocks.test(name), name).toBe(true);
    }
    for (const name of ['StructuredOutput', 'mcp__tracker__get_list']) {
      expect(blocks.test(name), name).toBe(false);
    }
    expect((JSON.parse(settings) as Settings).permissions?.allow).toEqual(['mcp__tracker__get_list']);
  });

  it('escapes the allowed names, so a name cannot widen the matcher', () => {
    const blocks = new RegExp(hook(syncSettings(['mcp__a__b.c', 'mcp__a__(d|e)'])).matcher);
    expect(blocks.test('mcp__a__bxc')).toBe(true);
    expect(blocks.test('mcp__a__d')).toBe(true);
    expect(blocks.test('mcp__a__b.c')).toBe(false);
    expect(blocks.test('mcp__a__(d|e)')).toBe(false);
  });

  it('with nothing allowed, only StructuredOutput gets through and there are no allow rules', () => {
    const settings = syncSettings([]);
    const blocks = new RegExp(hook(settings).matcher);
    expect(blocks.test('StructuredOutput')).toBe(false);
    expect(blocks.test('mcp__tracker__get_list')).toBe(true);
    expect(blocks.test('Bash')).toBe(true);
    expect(JSON.parse(settings)).not.toHaveProperty('permissions');
  });

  it("switches hooks on, so the owner's or the repo's disableAllHooks can't turn the guard off", () => {
    for (const allow of [[], ['mcp__tracker__get_list']]) {
      expect(JSON.parse(syncSettings(allow))).toHaveProperty('disableAllHooks', false);
    }
  });

  it("the hook's command exits 2 and says why", () => {
    const { type, command } = hook(syncSettings([])).hooks[0];
    expect(type).toBe('command');
    let failure: { status: number; stderr: string } | undefined;
    try {
      execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      failure = err as { status: number; stderr: string };
    }
    expect(failure?.status).toBe(2);
    expect(failure?.stderr).toContain('may only read the to-do list');
  });
});

it('isMcpToolName takes connector tools only', () => {
  expect(isMcpToolName('mcp__claude_ai_Linear__list_issues')).toBe(true);
  expect(isMcpToolName('mcp__tracker__get_list')).toBe(true);
  for (const name of ['Bash', 'mcp__tracker', 'mcp__a__b c', 'mcp__a__b;rm']) {
    expect(isMcpToolName(name), name).toBe(false);
  }
});

describe('syncPrompt', () => {
  const intro =
    "Mainframe, the app that runs this project's Claude Code sessions, shows the owner's to-do list for this project in its Todo panel.";

  it('the read prompt names the picked list; without one it asks for candidates', () => {
    const picked = syncPrompt({ kind: 'read', list: { name: 'Doing', board: 'Sprint', url: 'https://tracker.example/l/1' } });
    expect(picked).toContain('Read the list "Doing" on "Sprint" (https://tracker.example/l/1).');
    expect(picked).not.toContain('several could be');

    expect(syncPrompt({ kind: 'read', list: { name: 'Doing', board: null, url: null } })).toContain('Read the list "Doing".');
    expect(syncPrompt({ kind: 'read', list: { name: 'Doing', board: null, url: 'https://tracker.example/l/1' } })).toContain(
      'Read the list "Doing" (https://tracker.example/l/1).',
    );

    const open = syncPrompt({ kind: 'read', list: null });
    expect(open).toContain('If several could be, don\'t read any cards: answer kind "lists"');
    expect(open).not.toContain('Read the list "');
  });

  it('both steps start with what Mainframe is and say to read only', () => {
    for (const step of [{ kind: 'discover' }, { kind: 'read', list: null }] as const) {
      expect(syncPrompt(step).startsWith(`${intro}\n\n`)).toBe(true);
    }
    expect(syncPrompt({ kind: 'read', list: null })).toContain('Only read: never create, change, move or delete anything.');
    expect(syncPrompt({ kind: 'read', list: null })).toContain('Answer kind "cards" with the source');
  });

  it('the discover prompt calls no tool and asks for read tools only', () => {
    const prompt = syncPrompt({ kind: 'discover' });
    expect(prompt).toContain("don't call any tool");
    expect(prompt).toContain('only tools that read, such as list, get or search');
    expect(prompt).toContain('Never name a tool that creates, changes, moves or deletes anything.');
    expect(prompt).toContain('answer kind "none" with a message that tells the owner so');
    expect(prompt).not.toContain('Answer kind "cards"');
  });
});

describe('readSyncAnswer', () => {
  const answered = { kind: 'none', message: 'No connector holds a to-do list.' };
  const result = (fields: object) => JSON.stringify({ type: 'result', is_error: false, subtype: 'success', ...fields });

  it('returns the structured output of a run that succeeded', () => {
    // The real CLI repeats the answer as text in `result`.
    expect(readSyncAnswer(result({ result: JSON.stringify(answered), structured_output: answered }))).toEqual(answered);
  });

  it.each([
    ['output that is not JSON', 'Loading…', "The sync run printed something Mainframe can't read"],
    ['JSON that is not an object', 'null', "The sync run printed something Mainframe can't read"],
    [
      'an error with a message',
      result({ is_error: true, result: 'Your credit balance is too low' }),
      'Your credit balance is too low',
    ],
    [
      'an error with an empty message',
      result({ is_error: true, subtype: 'error_during_execution', result: '' }),
      'The sync run stopped (error_during_execution)',
    ],
    [
      'a subtype other than success, with no message',
      result({ subtype: 'error_max_budget_usd' }),
      'The sync run stopped (error_max_budget_usd)',
    ],
    ['no structured output, with a message', result({ result: 'I could not do that' }), 'I could not do that'],
    ['no structured output, with no message', result({ result: '' }), 'The sync run gave no answer'],
    [
      'an answer of the wrong shape',
      result({ structured_output: { kind: 'cards', cards: 'none' } }),
      "The sync run's answer didn't have the shape Mainframe asked for",
    ],
  ])('throws for %s', (_what, stdout, message) => {
    expect(() => readSyncAnswer(stdout)).toThrow(new Error(message));
  });
});

describe('runClaude', () => {
  const folders: string[] = [];

  afterEach(() => {
    for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function folder(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mainframe-sync-')));
    folders.push(dir);
    return dir;
  }

  /** A program that is the script given, in a folder of its own. */
  function stub(script: string): string {
    const file = join(folder(), 'claude-stub');
    writeFileSync(file, `#!/bin/sh\n${script}\n`);
    chmodSync(file, 0o755);
    return file;
  }

  const options = (argv: string[], over: Partial<Parameters<typeof runClaude>[0]> = {}) => ({
    argv,
    cwd: folder(),
    env: { PATH: process.env.PATH },
    input: '',
    timeoutMs: 10_000,
    ...over,
  });

  it('passes the input on stdin, runs in cwd with env, and resolves with stdout', async () => {
    const cwd = folder();
    const program = stub('cat > got-input; pwd > got-cwd; printf %s "$SYNC_TEST" > got-env; printf \'{"ok":1}\'');
    const run = runClaude(options([program], { cwd, env: { PATH: process.env.PATH, SYNC_TEST: 'set' }, input: 'the prompt' }));
    await expect(run.done).resolves.toBe('{"ok":1}');
    expect(readFileSync(join(cwd, 'got-input'), 'utf8')).toBe('the prompt');
    expect(readFileSync(join(cwd, 'got-cwd'), 'utf8').trim()).toBe(cwd);
    expect(readFileSync(join(cwd, 'got-env'), 'utf8')).toBe('set');
  });

  it('hands the rest of argv to the program as it is, with no shell between', async () => {
    const program = stub('printf "%s|" "$@"');
    const run = runClaude(options([program, '-p', '', 'a b', '$HOME;echo x']));
    await expect(run.done).resolves.toBe('-p||a b|$HOME;echo x|');
  });

  it('resolves with stdout even when the run exits non-zero', async () => {
    const program = stub('printf \'{"is_error":true}\'; echo "boom" >&2; exit 1');
    await expect(runClaude(options([program])).done).resolves.toBe('{"is_error":true}');
  });

  it('rejects with the last line of stderr when the run prints nothing', async () => {
    const program = stub('echo "first" >&2; echo "Not logged in" >&2; echo >&2; exit 1');
    await expect(runClaude(options([program])).done).rejects.toThrow(new Error('Not logged in'));
  });

  it('rejects with the exit code when the run prints nothing at all', async () => {
    const program = stub('exit 3');
    await expect(runClaude(options([program])).done).rejects.toThrow(new Error('claude exited with code 3'));
  });

  it('stops a run that outlasts its time, and says so', async () => {
    const program = stub('exec sleep 5');
    const started = Date.now();
    await expect(runClaude(options([program], { timeoutMs: 200 })).done).rejects.toThrow(/took longer than \d+ minutes and was stopped/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('cancel stops the run and rejects', async () => {
    const program = stub('exec sleep 5');
    const run = runClaude(options([program]));
    run.cancel();
    await expect(run.done).rejects.toThrow(new Error('The sync was stopped'));
  });

  it('settles once: a cancel after the run finished changes nothing', async () => {
    const program = stub('printf done');
    const run = runClaude(options([program]));
    await expect(run.done).resolves.toBe('done');
    run.cancel();
    await expect(run.done).resolves.toBe('done');
  });

  it('a program that is missing rejects with why', async () => {
    const missing = join(folder(), 'no-such-claude');
    const failure = await runClaude(options([missing])).done.catch((err: Error) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(new RegExp(`^Could not run ${missing}: .*ENOENT`));
  });
});
