import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { NODE } from '../testing/lookups';
import { SYNC_ANSWER_JSON } from '../todo/todoSchema';
import { isMcpToolName, readSyncAnswer, syncArgv, syncSettings } from './claudeSync';

interface Settings {
  permissions?: { allow: string[] };
  hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string; args: string[]; timeout: number; onFailure?: string }[] }[] };
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
    const settings = syncSettings(NODE, ['mcp__tracker__get_list']);
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
    const blocks = new RegExp(hook(syncSettings(NODE, ['mcp__a__b.c', 'mcp__a__(d|e)'])).matcher);
    expect(blocks.test('mcp__a__bxc')).toBe(true);
    expect(blocks.test('mcp__a__d')).toBe(true);
    expect(blocks.test('mcp__a__b.c')).toBe(false);
    expect(blocks.test('mcp__a__(d|e)')).toBe(false);
  });

  it('with nothing allowed, only StructuredOutput gets through and there are no allow rules', () => {
    const settings = syncSettings(NODE, []);
    const blocks = new RegExp(hook(settings).matcher);
    expect(blocks.test('StructuredOutput')).toBe(false);
    expect(blocks.test('mcp__tracker__get_list')).toBe(true);
    expect(blocks.test('Bash')).toBe(true);
    expect(JSON.parse(settings)).not.toHaveProperty('permissions');
  });

  it("switches hooks on, so the owner's or the repo's disableAllHooks can't turn the guard off", () => {
    for (const allow of [[], ['mcp__tracker__get_list']]) {
      expect(JSON.parse(syncSettings(NODE, allow))).toHaveProperty('disableAllHooks', false);
    }
  });

  it("the hook's command exits 2 and says why", () => {
    const { type, command, args } = hook(syncSettings(process.execPath, [])).hooks[0];
    expect(type).toBe('command');
    let failure: { status: number; stderr: string } | undefined;
    try {
      execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      failure = err as { status: number; stderr: string };
    }
    expect(failure?.status).toBe(2);
    expect(failure?.stderr).toBe("Mainframe's sync may only read the to-do list.");
  });

  it("a guard that can't start blocks the call", () => {
    const { command, onFailure } = hook(syncSettings(NODE, [])).hooks[0];
    expect(onFailure).toBe('block');
    expect(command).toBe(NODE);
  });
});

it('isMcpToolName takes connector tools only', () => {
  expect(isMcpToolName('mcp__claude_ai_Linear__list_issues')).toBe(true);
  expect(isMcpToolName('mcp__tracker__get_list')).toBe(true);
  for (const name of ['Bash', 'mcp__tracker', 'mcp__a__b c', 'mcp__a__b;rm']) {
    expect(isMcpToolName(name), name).toBe(false);
  }
});

describe('readSyncAnswer', () => {
  const answered = { kind: 'none', message: 'No connector holds a to-do list.' };
  const result = (fields: object) => JSON.stringify({ type: 'result', is_error: false, subtype: 'success', ...fields });

  it('returns the structured output of a run that succeeded', () => {
    // The real CLI repeats the answer as text in `result`.
    expect(readSyncAnswer(result({ result: JSON.stringify(answered), structured_output: answered }))).toEqual(answered);
  });

  it.each([
    ['an error', { is_error: true }],
    ['a subtype other than success', { subtype: 'error_during_execution' }],
  ])('keeps a valid answer from a run that ended with %s', (_what, ending) => {
    // A run can answer and then end oddly, e.g. after a message that came in late; the answer still counts.
    expect(readSyncAnswer(result({ ...ending, structured_output: answered }))).toEqual(answered);
  });

  it.each([
    ['output that is not JSON', 'Loading…', "The sync run printed something Mainframe can't read"],
    ['JSON that is not an object', 'null', "The sync run printed something Mainframe can't read"],
    [
      // Claude Code can take back an answer (after a model switch) and end so; its reason is in `errors`, while
      // `result` holds the run's own last words.
      'an answer taken back, with the CLI’s reason',
      result({
        is_error: true,
        subtype: 'error_max_structured_output_retries',
        num_turns: 9,
        errors: ['The structured output was retracted'],
        result: 'The Todo read was already finished and submitted before this message arrived.',
      }),
      'The sync run ended without an answer (error_max_structured_output_retries, 9 turns): The structured output was retracted',
    ],
    [
      'an error with a message',
      result({ is_error: true, result: 'Your credit balance is too low' }),
      'The sync run ended without an answer (error): Your credit balance is too low',
    ],
    [
      'an error with an empty message',
      result({ is_error: true, subtype: 'error_during_execution', result: '', errors: [] }),
      'The sync run ended without an answer (error_during_execution)',
    ],
    [
      'a subtype other than success, with no message',
      result({ subtype: 'error_max_budget_usd', num_turns: 3 }),
      'The sync run ended without an answer (error_max_budget_usd, 3 turns)',
    ],
    [
      'no structured output, with a message',
      result({ result: 'I stopped here.', num_turns: 9 }),
      'The sync run ended without an answer (success, 9 turns): I stopped here.',
    ],
    ['no structured output, with no message', result({ result: '' }), 'The sync run ended without an answer (success)'],
    [
      'a message over 300 characters',
      result({ result: 'x'.repeat(301) }),
      `The sync run ended without an answer (success): ${'x'.repeat(300)}…`,
    ],
    [
      'an answer of the wrong shape',
      result({ structured_output: { kind: 'cards', cards: 'none' } }),
      "The sync run's answer didn't have the shape Mainframe asked for",
    ],
  ])('throws for %s', (_what, stdout, message) => {
    expect(() => readSyncAnswer(stdout)).toThrow(new Error(message));
  });
});
