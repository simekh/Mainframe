import type { ProgramKind, ProgramReport } from '../../shared/types';

// OSC 7501 program status: https://superlogical.com/rex/docs/build/program-status

export type Osc7501Event = { type: 'query' } | { type: 'report'; report: ProgramReport };

export const OSC7501_SUPPORT_REPLY =
  '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\';

const ESC = 0x1b;
const BEL = 0x07;
const CAN = 0x18;
const SUB = 0x1a;
const PREFIX = '7501;';
/** ESC ] 7501 ; */
const HEADER_BYTES = 2 + PREFIX.length;
const MAX_SEQUENCE_BYTES = 4096;

type State = 'ground' | 'esc' | 'oscPrefix' | 'osc7501' | 'oscOther' | 'oscEsc';

function utf8Bytes(code: number): number {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  // A surrogate pair is 4 bytes in UTF-8: count 2 for each half.
  if (code >= 0xd800 && code <= 0xdfff) return 2;
  return 3;
}

/** Streaming scanner for OSC 7501 sequences in PTY output; keeps its state across chunks. */
export class Osc7501Scanner {
  private state: State = 'ground';
  private prefix = '';
  private payload = '';
  private payloadBytes = 0;
  /** In `oscEsc`: whether the interrupted OSC was a 7501 one being collected. */
  private escIn7501 = false;

  /** @param onPayload sees every finished OSC 7501 payload as sent, before parsing (for logging). */
  constructor(private readonly onPayload?: (payload: string) => void) {}

  feed(chunk: string): Osc7501Event[] {
    const events: Osc7501Event[] = [];
    let i = 0;
    while (i < chunk.length) {
      if (this.state === 'ground') {
        const next = chunk.indexOf('\x1b', i);
        if (next === -1) break;
        this.state = 'esc';
        i = next + 1;
        continue;
      }
      this.step(chunk.charCodeAt(i), chunk[i], events);
      i++;
    }
    return events;
  }

  private step(code: number, ch: string, events: Osc7501Event[]): void {
    switch (this.state) {
      case 'esc':
        this.fromEsc(code);
        return;
      case 'oscPrefix':
        if (this.endsOrAbandons(code, false)) return;
        this.prefix += ch;
        if (this.prefix === PREFIX) {
          this.state = 'osc7501';
          this.payload = '';
          this.payloadBytes = 0;
        } else if (!PREFIX.startsWith(this.prefix)) {
          this.state = 'oscOther';
        }
        return;
      case 'osc7501':
        if (code === BEL) {
          this.finish(1, events);
          return;
        }
        if (this.endsOrAbandons(code, true)) return;
        this.payloadBytes += utf8Bytes(code);
        // Even the shortest terminator (BEL) would take the sequence over the limit.
        if (HEADER_BYTES + this.payloadBytes + 1 > MAX_SEQUENCE_BYTES) {
          this.payload = '';
          this.state = 'oscOther';
        } else {
          this.payload += ch;
        }
        return;
      case 'oscOther':
        this.endsOrAbandons(code, false);
        return;
      case 'oscEsc':
        if (code === 0x5c /* \ */) {
          if (this.escIn7501) this.finish(2, events);
          else this.state = 'ground';
          return;
        }
        // ESC followed by anything else abandons the OSC; the char starts a new sequence.
        this.payload = '';
        this.fromEsc(code);
        return;
    }
  }

  private fromEsc(code: number): void {
    if (code === 0x5d /* ] */) {
      this.state = 'oscPrefix';
      this.prefix = '';
    } else if (code !== ESC) {
      this.state = 'ground';
    }
  }

  /** Handles BEL, ESC, CAN and SUB inside an OSC; returns true when the char was one of them. */
  private endsOrAbandons(code: number, in7501: boolean): boolean {
    if (code === BEL || code === CAN || code === SUB) {
      this.payload = '';
      this.state = 'ground';
      return true;
    }
    if (code === ESC) {
      this.escIn7501 = in7501;
      this.state = 'oscEsc';
      return true;
    }
    return false;
  }

  private finish(terminatorBytes: number, events: Osc7501Event[]): void {
    const payload = this.payload;
    this.payload = '';
    this.state = 'ground';
    if (HEADER_BYTES + this.payloadBytes + terminatorBytes > MAX_SEQUENCE_BYTES) return;
    this.onPayload?.(payload);
    if (payload.trim() === '?') {
      events.push({ type: 'query' });
      return;
    }
    const report = parseReportPayload(payload);
    if (report) events.push({ type: 'report', report });
  }
}

const STATES = new Set(['idle', 'working', 'done', 'blocked', 'error', 'clear']);
const KINDS = new Set(['permission', 'question', 'auth']);
const KEY_RE = /^[a-z]+$/;
const VALUE_RE = /^[A-Za-z0-9_.,+/=-]*$/;
const SEGMENT_RE = /^[A-Za-z0-9_.+-]{1,32}$/;
const APP_RE = /^[A-Za-z0-9_.+-]{1,32}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_KEY = 16;
const MAX_ID_BYTES = 128;
const MAX_ID_LEVELS = 8;
const MAX_APP = 32;

/** Text field limits, in bytes: [encoded, decoded]. */
const TEXT_LIMITS = { title: [256, 192], msg: [2732, 2048] } as const;

class DropReport extends Error {}

function decodeText(value: string, [maxEncoded, maxDecoded]: readonly [number, number]): string {
  if (value.length > maxEncoded || value.length % 4 !== 0 || !BASE64_RE.test(value)) throw new DropReport();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxDecoded) throw new DropReport();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DropReport();
  }
  if (CONTROL_RE.test(text)) throw new DropReport();
  return text;
}

function validId(id: string): boolean {
  if (Buffer.byteLength(id) > MAX_ID_BYTES) return false;
  const segments = id.split('/');
  return segments.length <= MAX_ID_LEVELS && segments.every((s) => SEGMENT_RE.test(s));
}

/** Parses the text after `7501;` of a report. Returns null when the report must be dropped. */
export function parseReportPayload(payload: string): ProgramReport | null {
  const fields = new Map<string, string>();
  for (const pair of payload.split(':')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!KEY_RE.test(key) || !VALUE_RE.test(value)) continue;
    if (key.length > MAX_KEY) return null;
    fields.set(key, value);
  }

  const state = fields.get('state');
  if (state === undefined || !STATES.has(state)) return null;
  const report: ProgramReport = { state: state as ProgramReport['state'], id: '' };

  const id = fields.get('id');
  if (id !== undefined) {
    if (!validId(id)) return null;
    report.id = id;
  }

  const kind = fields.get('kind');
  if (state === 'blocked' && kind !== undefined && KINDS.has(kind)) report.kind = kind as ProgramKind;

  const progress = fields.get('progress');
  if ((state === 'working' || state === 'blocked') && progress !== undefined && /^\d+$/.test(progress)) {
    const n = Number(progress);
    if (n <= 100) report.progress = n;
  }

  const app = fields.get('app');
  if (app !== undefined) {
    if (app.length > MAX_APP) return null;
    if (APP_RE.test(app)) report.app = app;
  }

  try {
    for (const key of ['title', 'msg'] as const) {
      const value = fields.get(key);
      if (value !== undefined) report[key] = decodeText(value, TEXT_LIMITS[key]);
    }
  } catch (err) {
    if (err instanceof DropReport) return null;
    throw err;
  }
  return report;
}
