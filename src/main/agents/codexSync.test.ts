import { describe, expect, it } from 'vitest';
import { CODEX_SYNC_SCHEMA_JSON, codexNamespace, readCodexAnswer, strictJsonSchema } from './codexSync';

const jsonl = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n');
const message = (text: string) => ({ type: 'item.completed', item: { type: 'agent_message', text } });
const NONE = '{"kind":"none","message":"No tracker","connector":null,"readTools":null,"lists":null,"source":null,"cards":null}';

describe('strictJsonSchema', () => {
  it('requires every property, makes the optional ones nullable and closes the object', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] };
    expect(strictJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      required: ['a', 'b'],
      additionalProperties: false,
    });
  });

  it('makes an object inside items strict and leaves its input alone', () => {
    const schema = { type: 'array', items: { type: 'object', properties: { x: { type: 'number' } } } };
    const copy = structuredClone(schema);
    expect(strictJsonSchema(schema)).toEqual({
      type: 'array',
      items: { type: 'object', properties: { x: { anyOf: [{ type: 'number' }, { type: 'null' }] } }, required: ['x'], additionalProperties: false },
    });
    expect(schema).toEqual(copy);
  });
});

describe('CODEX_SYNC_SCHEMA_JSON', () => {
  it('is strict at every object, and message is a string or null', () => {
    const schema = JSON.parse(CODEX_SYNC_SCHEMA_JSON);
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      const n = node as Record<string, unknown>;
      if (n.properties) objects.push(n);
      Object.values(n).forEach(walk);
    };
    walk(schema);
    expect(objects.length).toBeGreaterThan(1);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect(o.required).toEqual(Object.keys(o.properties as object));
    }
    expect(schema.properties.message).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });
});

describe('codexNamespace', () => {
  it('turns every character outside letters, digits and underscore into an underscore', () => {
    expect(codexNamespace('my-trk')).toBe('my_trk');
    expect(codexNamespace('a_b9')).toBe('a_b9');
  });
});

describe('readCodexAnswer', () => {
  it('reads the agent message and drops the nulls', () => {
    const out = jsonl(
      { type: 'thread.started', thread_id: 't' },
      { type: 'item.completed', item: { type: 'error', message: 'Model metadata not found' } },
      message(NONE),
      { type: 'turn.completed' },
    );
    const answer = readCodexAnswer(out, []);
    expect(answer).toEqual({ kind: 'none', message: 'No tracker' });
    expect(answer).not.toHaveProperty('connector');
  });

  it('reads the last of two agent messages', () => {
    const out = jsonl(message('thinking aloud'), message(NONE));
    expect(readCodexAnswer(out, [])).toEqual({ kind: 'none', message: 'No tracker' });
  });

  it('skips lines that are not JSON', () => {
    expect(readCodexAnswer(`warning: something\n${jsonl(message(NONE))}`, [])).toEqual({ kind: 'none', message: 'No tracker' });
  });

  it('throws when the turn failed', () => {
    expect(() => readCodexAnswer(jsonl({ type: 'turn.failed', error: { message: 'rate limited' } }), [])).toThrow('The sync run failed: rate limited');
    expect(() => readCodexAnswer(jsonl({ type: 'error', message: 'boom' }), [])).toThrow('The sync run failed: boom');
  });

  it('throws when a tool outside the allowed ones completed', () => {
    const call = (status: string) => jsonl({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'my-trk', tool: 'create_card', status } }, message(NONE));
    const tools = ['mcp__my_trk__get_card'];
    expect(() => readCodexAnswer(call('completed'), tools)).toThrow("The sync used a tool that wasn't allowed: mcp__my_trk__create_card");
    expect(() => readCodexAnswer(call('failed'), tools)).not.toThrow();
  });

  it('allows a tool that was named', () => {
    const out = jsonl({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'my-trk', tool: 'get_card', status: 'completed' } }, message(NONE));
    expect(() => readCodexAnswer(out, ['mcp__my_trk__get_card'])).not.toThrow();
  });

  it('throws without an agent message', () => {
    expect(() => readCodexAnswer(jsonl({ type: 'turn.completed' }), [])).toThrow('The sync run ended without an answer');
  });

  it('throws when the answer is not JSON or has the wrong shape', () => {
    expect(() => readCodexAnswer(jsonl(message('not json')), [])).toThrow("The sync run's answer wasn't JSON");
    expect(() => readCodexAnswer(jsonl(message('{"kind":"bogus"}')), [])).toThrow("The sync run's answer didn't have the shape Mainframe asked for");
  });
});
