import { httpUrl, MAX_HTTP_URL_LENGTH } from '../../../shared/httpUrl';

/** The two colours the styler adds, as `#rrggbb`. */
export interface TermStyleColors {
  /** Bold text that would draw in the default foreground. */
  bold: string;
  /** Text of an OSC 8 link to a web page (one `httpUrl` accepts, so one a Cmd+click opens). */
  link: string;
}

// xterm.js's parser states (src/common/parser/Constants.ts). Its DCS passthrough, DCS ignore and
// APC string states move alike, so they share STRING here.
const GROUND = 0;
const ESCAPE = 1;
const ESCAPE_INTERMEDIATE = 2;
const CSI_ENTRY = 3;
const CSI_PARAM = 4;
const CSI_INTERMEDIATE = 5;
const CSI_IGNORE = 6;
const SOS_PM_STRING = 7;
const OSC_STRING = 8;
const DCS_ENTRY = 9;
const DCS_PARAM = 10;
const DCS_INTERMEDIATE = 11;
const STRING = 12;

/** How xterm's parser classes every character from U+00A0 up. */
const NON_ASCII = 0xa0;

// xterm.js's limits (common/parser/Params.ts, common/parser/Constants.ts).
const MAX_PARAMS = 32;
const MAX_SUB_PARAMS = 32;
const MAX_PARAM_VALUE = 0x7fffffff;
const OSC_PAYLOAD_LIMIT = 10_000_000;

const OSC_ID = 0;
const OSC_PAYLOAD = 1;
const OSC_ABORT = 2;

const NO_LINK = 0;
const WEB_LINK = 1;
const OTHER_LINK = 2;

/** The attributes ESC 7, CSI s and ?1049h save, as far as the styler follows them. */
interface Saved {
  bold: boolean;
  fg: string | null;
  shown: string | null;
  hasExtended: boolean;
}
const NOTHING_SAVED: Saved = { bold: false, fg: null, shown: null, hasExtended: false };

/** CSI parameters with sub-parameters, kept as xterm.js keeps them, limits included. */
class Params {
  readonly values = new Int32Array(MAX_PARAMS);
  readonly subStart = new Uint8Array(MAX_PARAMS);
  readonly subEnd = new Uint8Array(MAX_PARAMS);
  readonly subs = new Int32Array(MAX_SUB_PARAMS);
  length = 0;
  private subLength = 0;
  private rejectDigits = false;
  private rejectSubDigits = false;
  private digitIsSub = false;

  /** Empty, with the one zero parameter xterm's parser starts every sequence with. */
  clear(): void {
    this.length = 0;
    this.subLength = 0;
    this.rejectDigits = false;
    this.rejectSubDigits = false;
    this.digitIsSub = false;
    this.addParam(0);
  }

  /** One parameter byte: a digit, `;` or `:`. */
  put(code: number): void {
    if (code === 0x3b) this.addParam(0);
    else if (code === 0x3a) this.addSubParam(-1);
    else this.addDigit(code - 0x30);
  }

  hasSubs(i: number): boolean {
    return this.subEnd[i] > this.subStart[i];
  }

  private addParam(value: number): void {
    this.digitIsSub = false;
    if (this.length >= MAX_PARAMS) {
      this.rejectDigits = true;
      return;
    }
    this.subStart[this.length] = this.subEnd[this.length] = this.subLength;
    this.values[this.length++] = value;
  }

  private addSubParam(value: number): void {
    this.digitIsSub = true;
    if (!this.length) return;
    if (this.rejectDigits || this.subLength >= MAX_SUB_PARAMS) {
      this.rejectSubDigits = true;
      return;
    }
    this.subs[this.subLength++] = value;
    this.subEnd[this.length - 1]++;
  }

  private addDigit(digit: number): void {
    const sub = this.digitIsSub;
    const count = sub ? this.subLength : this.length;
    if (this.rejectDigits || !count || (sub && this.rejectSubDigits)) return;
    const store = sub ? this.subs : this.values;
    const current = store[count - 1];
    store[count - 1] = current === -1 ? digit : Math.min(current * 10 + digit, MAX_PARAM_VALUE);
  }
}

function truecolor(hex: string): string {
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!rgb) throw new Error(`not a #rrggbb colour: ${hex}`);
  return `38;2;${parseInt(rgb[1], 16)};${parseInt(rgb[2], 16)};${parseInt(rgb[3], 16)}`;
}

const sgrBytes = (params: string) => Uint8Array.from(`\x1b[${params}m`, (c) => c.charCodeAt(0));

/** JavaScript's whitespace, which xterm trims from an OSC 8's params. */
const isSpace = (cp: number) => cp === 0x20 || (cp >= NON_ASCII && /\s/.test(String.fromCodePoint(cp)));

/**
 * Bold text and web links in the owner's iTerm2 colours (spec §7.1). xterm.js has no bold colour,
 * so the PTY's output passes through one of these, one per terminal, on its way to `term.write`.
 * Where bold text would draw in the default foreground it adds `colors.bold`, and over the text of
 * an OSC 8 link to a web page `colors.link`, as truecolor SGRs; an explicit foreground wins over
 * the bold colour, and the link colour over both. xterm already draws its own dashed underline
 * under OSC 8 text, so the styler adds no underline. Where the bold or the link ends it gives back
 * what the program had set.
 *
 * It only ever inserts whole SGR sequences, at points where xterm's parser is between characters and
 * sequences, just after the sequence that called for them: every byte it is given comes out, in
 * order, and output with no bold and no links comes out as the same array. To find those points it
 * reads the bytes as xterm.js 6.1 does (its UTF-8 decoding, its VT500 parser states, its SGR, OSC 8,
 * cursor save and restore per screen, and resets), so it keeps track of the attributes xterm has.
 * A sequence cut at a chunk's end is followed into the next chunk; its bytes are not held back.
 */
export function createTermStyler(colors: TermStyleColors): (chunk: Uint8Array) => Uint8Array {
  const BOLD = truecolor(colors.bold);
  const LINK = truecolor(colors.link);
  const sgrCache = new Map<string, Uint8Array>();
  const sgr = (params: string) => {
    let seq = sgrCache.get(params);
    if (!seq) sgrCache.set(params, (seq = sgrBytes(params)));
    return seq;
  };

  // UTF-8 decoding: continuation bytes still to come, the code point so far, its smallest legal value.
  let pending = 0;
  let codePoint = 0;
  let minCodePoint = 0;

  // The parser.
  let state = GROUND;
  let collect = 0;
  const params = new Params();
  params.clear();
  let oscPhase = OSC_ID;
  let oscId = -1;
  let oscLength = 0;
  let linkSeparated = false;
  let linkParamsBlank = true;
  let linkUri = '';

  // The attributes, as the program set them: bold, and its foreground as an SGR (null: the default).
  let bold = false;
  let fg: string | null = null;
  // The OSC 8 link open, and what decides whether cells carry it: xterm's HAS_EXTENDED flag, which
  // an open link or an underline style sets, and which a restore can take away.
  let link = NO_LINK;
  let linkOnAlternate = false;
  let underlineStyle = 0;
  let hasExtended = false;
  // The colour the styler set that xterm's foreground still holds (null: the program's own).
  let shown: string | null = null;
  // Something changed that may call for a colour.
  let dirty = false;
  let alternate = false;
  const saved: [Saved, Saved] = [NOTHING_SAVED, NOTHING_SAVED];

  const updateExtended = () => {
    hasExtended = link !== NO_LINK || underlineStyle !== 0;
  };

  // --- Attributes ------------------------------------------------------------------------------

  const save = () => {
    saved[alternate ? 1 : 0] = { bold, fg, shown, hasExtended };
  };

  // xterm restores the foreground and background words as saved: the bold, the colour it had then
  // (the styler's own included) and HAS_EXTENDED. The link and the underline style stay as they are.
  const restore = () => {
    ({ bold, fg, shown, hasExtended } = saved[alternate ? 1 : 0]);
  };

  const resetAttributes = () => {
    bold = false;
    fg = null;
    shown = null;
    link = NO_LINK;
    underlineStyle = 0;
    hasExtended = false;
  };

  const setUnderline = (style: number) => {
    underlineStyle = style === -1 || style > 5 ? 1 : style;
    updateExtended();
  };

  /** xterm's _extractColor: reads the colour that starts at `pos`; returns how many parameters it took. */
  const extractColor = (pos: number): number => {
    const accu = [0, 0, -1, 0, 0, 0];
    let cSpace = 0;
    let advance = 0;
    do {
      accu[advance + cSpace] = params.values[pos + advance];
      if (params.hasSubs(pos + advance)) {
        const start = params.subStart[pos + advance];
        const count = params.subEnd[pos + advance] - start;
        let i = 0;
        do {
          if (accu[1] === 5) cSpace = 1;
          accu[advance + i + 1 + cSpace] = params.subs[start + i];
        } while (++i < count && i + advance + 1 + cSpace < accu.length);
        break;
      }
      if ((accu[1] === 5 && advance + cSpace >= 2) || (accu[1] === 2 && advance + cSpace >= 5)) break;
      if (accu[1]) cSpace = 1;
    } while (++advance + pos < params.length && advance + cSpace < accu.length);
    for (let i = 2; i < accu.length; i++) if (accu[i] === -1) accu[i] = 0;
    if (accu[0] === 38) {
      if (accu[1] === 2) fg = `38;2;${accu[3] & 0xff};${accu[4] & 0xff};${accu[5] & 0xff}`;
      else if (accu[1] === 5) fg = `38;5;${accu[3] & 0xff}`;
      if (accu[1] === 2 || accu[1] === 5) shown = null;
    }
    return advance;
  };

  /** xterm's charAttributes, for the bold, the foreground and the underline style. */
  const selectGraphicRendition = () => {
    for (let i = 0; i < params.length; i++) {
      const p = params.values[i];
      if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) {
        fg = String(p);
        shown = null;
      } else if (p === 0) {
        bold = false;
        fg = null;
        shown = null;
        underlineStyle = 0;
        updateExtended();
      } else if (p === 1) bold = true;
      else if (p === 4) setUnderline(params.hasSubs(i) ? params.subs[params.subStart[i]] : 1);
      else if (p === 21) setUnderline(2);
      else if (p === 22 || p === 221) bold = false;
      else if (p === 24) setUnderline(0);
      else if (p === 39) {
        fg = null;
        shown = null;
      } else if (p === 59) updateExtended();
      else if (p === 38 || p === 48 || p === 58) i += extractColor(i);
    }
  };

  // Coming back to the normal screen, xterm clears the alternate one and the link records that
  // lived on it: a link opened there is still open, and still underlined, but no longer opens.
  const toNormalScreen = () => {
    if (alternate && linkOnAlternate && link === WEB_LINK) link = OTHER_LINK;
    alternate = false;
  };

  const privateModes = (set: boolean) => {
    for (let i = 0; i < params.length; i++) {
      const mode = params.values[i];
      if (mode === 1048) {
        if (set) save();
        else restore();
      } else if (mode === 1049) {
        if (set) {
          save();
          alternate = true;
        } else {
          toNormalScreen();
          restore();
        }
      } else if (mode === 47 || mode === 1047) {
        if (set) alternate = true;
        else toNormalScreen();
      }
    }
  };

  const csiDispatch = (final: number) => {
    if (collect === 0 && final === 0x6d) selectGraphicRendition();
    else if (collect === 0 && final === 0x73) save(); // CSI s
    else if (collect === 0 && final === 0x75) restore(); // CSI u; with a prefix it is the kitty keyboard's
    else if (collect === 0x3f && (final === 0x68 || final === 0x6c)) privateModes(final === 0x68);
    else if (collect === 0x21 && final === 0x70) {
      // DECSTR, CSI ! p: the attributes and this screen's saved ones back to the defaults.
      resetAttributes();
      saved[alternate ? 1 : 0] = NOTHING_SAVED;
    } else return;
    dirty = true;
  };

  const escDispatch = (final: number) => {
    if (collect !== 0) return;
    if (final === 0x37) save(); // ESC 7
    else if (final === 0x38) restore(); // ESC 8
    else if (final === 0x63) {
      // RIS, ESC c: everything back to the start, both screens' saved attributes too.
      resetAttributes();
      alternate = false;
      saved[0] = saved[1] = NOTHING_SAVED;
    } else return;
    dirty = true;
  };

  // --- OSC 8 -----------------------------------------------------------------------------------

  const oscStart = () => {
    oscPhase = OSC_ID;
    oscId = -1;
    oscLength = 0;
    linkSeparated = false;
    linkParamsBlank = true;
    linkUri = '';
  };

  /** One character of an OSC: its number, then, for an OSC 8 only, its params and URI. */
  const oscPut = (cp: number) => {
    if (oscPhase === OSC_ABORT) return;
    if (oscPhase === OSC_ID) {
      if (cp === 0x3b) oscPhase = OSC_PAYLOAD;
      else if (cp < 0x30 || cp > 0x39) oscPhase = OSC_ABORT;
      else oscId = (oscId === -1 ? 0 : oscId) * 10 + cp - 0x30;
      return;
    }
    if (oscId !== 8) return;
    oscLength += cp > 0xffff ? 2 : 1;
    if (!linkSeparated) {
      if (cp === 0x3b) linkSeparated = true;
      else if (linkParamsBlank && !isSpace(cp)) linkParamsBlank = false;
    } else if (linkUri.length <= MAX_HTTP_URL_LENGTH) {
      // Longer than httpUrl takes is enough to know it is not a web page.
      linkUri += String.fromCodePoint(cp);
    }
  };

  /** xterm's setHyperlink, on an OSC 8 that ended well. */
  const oscEnd = () => {
    if (oscPhase !== OSC_PAYLOAD || oscId !== 8 || oscLength > OSC_PAYLOAD_LIMIT || !linkSeparated) return;
    if (linkUri) {
      link = httpUrl(linkUri) ? WEB_LINK : OTHER_LINK;
      linkOnAlternate = alternate;
    } else if (linkParamsBlank) link = NO_LINK;
    else return;
    updateExtended();
    dirty = true;
  };

  // --- Parser ----------------------------------------------------------------------------------

  const clear = () => {
    params.clear();
    collect = 0;
  };

  /** One character, as xterm's VT500 transition table moves on it: `code` is its class, `cp` itself. */
  const feed = (code: number, cp: number) => {
    // From any state.
    if (code === 0x1b) {
      if (state === OSC_STRING) oscEnd();
      clear();
      state = ESCAPE;
      return;
    }
    if (code === 0x18 || code === 0x1a) {
      state = GROUND; // CAN and SUB cancel, an OSC with them
      return;
    }
    if (code >= 0x80 && code < NON_ASCII) {
      if (code === 0x9c) {
        if (state === OSC_STRING) oscEnd();
        state = GROUND;
      } else if (code === 0x9d) {
        oscStart();
        state = OSC_STRING;
      } else if (code === 0x9b) {
        clear();
        state = CSI_ENTRY;
      } else if (code === 0x90) {
        clear();
        state = DCS_ENTRY;
      } else if (code === 0x98 || code === 0x9e) state = SOS_PM_STRING;
      else if (code === 0x9f) state = STRING;
      else state = GROUND;
      return;
    }
    // C0 controls other than those, DEL and non-ASCII characters keep each state unless it says otherwise.
    const control = code < 0x20 || code === 0x7f;
    switch (state) {
      case GROUND:
        return;
      case ESCAPE:
        if (control) return;
        if (code >= 0x20 && code <= 0x2f) {
          collect = code;
          state = ESCAPE_INTERMEDIATE;
        } else if (code === 0x5b) {
          clear();
          state = CSI_ENTRY;
        } else if (code === 0x5d) {
          oscStart();
          state = OSC_STRING;
        } else if (code === 0x50) {
          clear();
          state = DCS_ENTRY;
        } else if (code === 0x58 || code === 0x5e) state = SOS_PM_STRING;
        else if (code === 0x5f) state = STRING;
        else {
          if (code !== NON_ASCII) escDispatch(code);
          state = GROUND;
        }
        return;
      case ESCAPE_INTERMEDIATE:
        // Any final byte here has an intermediate, so none of them is one the styler follows.
        if (!control && !(code >= 0x20 && code <= 0x2f)) state = GROUND;
        return;
      case CSI_ENTRY:
      case CSI_PARAM:
        if (control) return;
        if (code >= 0x30 && code <= 0x3b) {
          params.put(code);
          state = CSI_PARAM;
        } else if (code >= 0x3c && code <= 0x3f) {
          // A prefix only first.
          if (state === CSI_ENTRY) {
            collect = code;
            state = CSI_PARAM;
          } else state = CSI_IGNORE;
        } else if (code >= 0x20 && code <= 0x2f) {
          collect = (collect << 8) | code;
          state = CSI_INTERMEDIATE;
        } else {
          if (code !== NON_ASCII) csiDispatch(code);
          state = GROUND;
        }
        return;
      case CSI_INTERMEDIATE:
        if (control) return;
        if (code >= 0x20 && code <= 0x2f) collect = (collect << 8) | code;
        else if (code >= 0x30 && code <= 0x3f) state = CSI_IGNORE;
        else {
          if (code !== NON_ASCII) csiDispatch(code);
          state = GROUND;
        }
        return;
      case CSI_IGNORE:
        if (code >= 0x40 && code <= 0x7e) state = GROUND;
        return;
      case SOS_PM_STRING:
        if (code === NON_ASCII) state = GROUND;
        return;
      case OSC_STRING:
        if (code === 0x07) {
          oscEnd();
          state = GROUND;
        } else if (code >= 0x20) oscPut(cp);
        return;
      case DCS_ENTRY:
      case DCS_PARAM:
      case DCS_INTERMEDIATE:
        if (control) return;
        if (code === NON_ASCII) state = GROUND;
        else if (code >= 0x40) state = STRING;
        else if (code <= 0x2f) state = DCS_INTERMEDIATE;
        else if (state === DCS_INTERMEDIATE || (state === DCS_PARAM && code >= 0x3c)) state = STRING;
        else state = DCS_PARAM;
        return;
      default:
        return; // STRING: only ESC, CAN, SUB and C1 controls end it
    }
  };

  /** The colour xterm's foreground should hold now; null for the program's own. */
  const wanted = () => (link === WEB_LINK && hasExtended ? LINK : bold && fg === null ? BOLD : null);

  return (chunk) => {
    let pieces: Uint8Array[] | undefined;
    let from = 0;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      // Text and C0 controls leave the ground state as it is.
      if (state === GROUND && pending === 0 && byte < 0x80 && byte !== 0x1b) continue;

      // xterm's UTF-8 decoding: a broken sequence is dropped and the byte that broke it starts
      // afresh; overlong forms, surrogates, U+FEFF and code points past U+10FFFF are dropped.
      let cp: number;
      if (pending > 0 && (byte & 0xc0) === 0x80) {
        codePoint = (codePoint << 6) | (byte & 0x3f);
        if (--pending > 0) continue;
        cp = codePoint;
        if (cp < minCodePoint || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfeff || cp > 0x10ffff) continue;
      } else {
        pending = 0;
        if (byte < 0x80) cp = byte;
        else {
          if ((byte & 0xe0) === 0xc0) {
            pending = 1;
            codePoint = byte & 0x1f;
            minCodePoint = 0x80;
          } else if ((byte & 0xf0) === 0xe0) {
            pending = 2;
            codePoint = byte & 0x0f;
            minCodePoint = 0x800;
          } else if ((byte & 0xf8) === 0xf0) {
            pending = 3;
            codePoint = byte & 0x07;
            minCodePoint = 0x10000;
          }
          continue; // a lead byte waits for the rest; a lone continuation byte, or F8–FF, xterm skips
        }
      }

      feed(cp < NON_ASCII ? cp : NON_ASCII, cp);

      if (dirty && state === GROUND) {
        dirty = false;
        const want = wanted();
        if (want !== shown) {
          (pieces ??= []).push(chunk.subarray(from, i + 1), sgr(want ?? fg ?? '39'));
          from = i + 1;
          shown = want;
        }
      }
    }
    if (!pieces) return chunk;
    pieces.push(chunk.subarray(from));
    const out = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
    let at = 0;
    for (const piece of pieces) {
      out.set(piece, at);
      at += piece.length;
    }
    return out;
  };
}
