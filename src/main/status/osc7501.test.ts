import { describe, it, expect } from 'vitest';
import { Osc7501Scanner, parseReportPayload, OSC7501_SUPPORT_REPLY } from './osc7501';

const ST = '\x1b\\';
const BEL = '\x07';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const report = (state: string) => ({ type: 'report', report: { state, id: '' } });

describe('Osc7501Scanner', () => {
  it('finds a support query ended by ST or BEL', () => {
    expect(new Osc7501Scanner().feed(`a\x1b]7501;?${ST}b`)).toEqual([{ type: 'query' }]);
    expect(new Osc7501Scanner().feed(`\x1b]7501;?${BEL}`)).toEqual([{ type: 'query' }]);
  });

  it('joins a sequence split across chunks, even inside the ST', () => {
    const s = new Osc7501Scanner();
    expect(s.feed('\x1b]75')).toEqual([]);
    expect(s.feed('01;state=work')).toEqual([]);
    expect(s.feed('ing\x1b')).toEqual([]);
    expect(s.feed('\\rest')).toEqual([report('working')]);
  });

  it('finds a support query split across chunks and followed by CSI c', () => {
    const s = new Osc7501Scanner();
    expect(s.feed('\x1b]7501')).toEqual([]);
    expect(s.feed(';?\x1b')).toEqual([]);
    expect(s.feed('\\\x1b[c')).toEqual([{ type: 'query' }]);
  });

  it('skips other OSC sequences, large OSC 52 payloads included', () => {
    expect(new Osc7501Scanner().feed(
      `\x1b]0;title${BEL}\x1b]52;c;${'A'.repeat(100_000)}${BEL}\x1b]7501;state=idle${ST}`,
    )).toEqual([report('idle')]);
  });

  it('accepts a 4096-byte sequence, drops a 4097-byte one, and finds the next', () => {
    const seq = (n: number) => `\x1b]7501;state=idle:x=${'A'.repeat(n)}${ST}`;
    expect(seq(4074)).toHaveLength(4096);
    expect(new Osc7501Scanner().feed(seq(4074))).toHaveLength(1);
    expect(new Osc7501Scanner().feed(seq(4075) + `\x1b]7501;state=done${ST}`)).toEqual([report('done')]);
  });

  it('abandons an OSC cut off by another escape sequence', () => {
    expect(new Osc7501Scanner().feed(`\x1b]7501;state=idle\x1b[31m\x1b]7501;state=done${ST}`))
      .toEqual([report('done')]);
  });
});

describe('parseReportPayload', () => {
  it('reads every field', () => {
    expect(parseReportPayload(
      `state=blocked:kind=question:id=claude/s1:app=claude:progress=40:title=${b64('Fix #124')}:msg=${b64('Needs an answer')}`,
    )).toEqual({ state: 'blocked', kind: 'question', id: 'claude/s1', app: 'claude', progress: 40, title: 'Fix #124', msg: 'Needs an answer' });
  });

  it('trims, skips malformed pairs, ignores unknown keys, last value wins', () => {
    expect(parseReportPayload(' state = idle : bogus : Upper=1 : future=x : state=done ')).toEqual({ state: 'done', id: '' });
  });

  it.each(['', 'kind=question', 'state=sleeping'])('rejects %j (no or unknown state)', (p) => {
    expect(parseReportPayload(p)).toBeNull();
  });

  it('keeps kind only with blocked, progress only with working/blocked and 0–100', () => {
    expect(parseReportPayload('state=done:kind=question:progress=10')).toEqual({ state: 'done', id: '' });
    expect(parseReportPayload('state=blocked:kind=telepathy')).toEqual({ state: 'blocked', id: '' });
    expect(parseReportPayload('state=working:progress=101')).toEqual({ state: 'working', id: '' });
  });

  it.each([
    `state=idle:id=${'a'.repeat(33)}`,
    'state=idle:id=a/b/c/d/e/f/g/h/i',
    `state=idle:id=${Array(5).fill('a'.repeat(32)).join('/')}`,
    'state=idle:id=a//b',
    `state=idle:app=${'a'.repeat(33)}`,
    `state=idle:msg=${b64('line\nbreak')}`,
    `state=idle:msg=${b64('x'.repeat(2049))}`,
    `state=idle:title=${b64('x'.repeat(193))}`,
    'state=idle:msg=abc',
  ])('drops the whole report for %s', (p) => {
    expect(parseReportPayload(p)).toBeNull();
  });

  it('reads clear with and without an id', () => {
    expect(parseReportPayload('state=clear')).toEqual({ state: 'clear', id: '' });
    expect(parseReportPayload('state=clear:id=us-east')).toEqual({ state: 'clear', id: 'us-east' });
  });
});

it('the support reply names every state and kind', () => {
  expect(OSC7501_SUPPORT_REPLY).toBe('\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\');
});

it('passes every finished OSC 7501 payload, raw, to onPayload', () => {
  const payloads: string[] = [];
  new Osc7501Scanner((p) => payloads.push(p)).feed(`\x1b]7501;?${ST}\x1b]7501;state=idle:future=x${BEL}\x1b]7501;bogus${ST}`);
  expect(payloads).toEqual(['?', 'state=idle:future=x', 'bogus']);
});
