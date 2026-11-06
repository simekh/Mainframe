import headless from '@xterm/headless';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { httpUrl } from '../../../shared/httpUrl';
import { createTermStyler } from './termStyle';

const COLORS = { bold: '#addb67', link: '#82aaff' };
const BOLD = '\x1b[38;2;173;219;103m';
const LINK = '\x1b[38;2;130;170;255m';
const DEFAULT_FG = '\x1b[39m';
const WEB = 'https://example.com/a';
const link = (uri: string, params = '') => `\x1b]8;${params};${uri}\x1b\\`;
const END_LINK = '\x1b]8;;\x1b\\';

const bytes = (text: string) => new TextEncoder().encode(text);

/** What one styler makes of the chunks, in order, as one stream of bytes. */
function styleChunks(chunks: Array<string | Uint8Array>): Buffer {
  const style = createTermStyler(COLORS);
  return Buffer.concat(chunks.map((chunk) => style(typeof chunk === 'string' ? bytes(chunk) : chunk)));
}
const styled = (...chunks: Array<string | Uint8Array>) => styleChunks(chunks).toString('utf8');

/** A small seeded random source (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(next: () => number, items: readonly T[]): T => items[Math.floor(next() * items.length)];

/** The bytes cut into pieces of random length, at any byte, inside characters and sequences too. */
function cut(data: Uint8Array, next: () => number, longest: number): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let at = 0; at < data.length; ) {
    const length = 1 + Math.floor(next() * longest);
    pieces.push(data.subarray(at, at + length));
    at += length;
  }
  return pieces;
}

// What Claude Code and a shell print, without bold and without links: text in several scripts,
// colours in every form, the dim, italic, underline and inverse styles and their resets, cursor
// moves and erases, the alternate screen, synchronized output, the kitty keyboard, cursor save and
// restore, titles, status reports, clipboard copies, DCS and charset designations.
const TEXT = [
  'Reading src/main.ts', ' ', '╭──────────╮', '│ > ', '╰──────────╯', '✻ Thinking…', '⏺ ', '  ⎿  Done',
  '🍎', '👩‍💻', '中文字', 'wörld', 'ś', '…', '€', '\r\n', '\n', '\r', '\t', '\b', '\x07',
];
const PLAIN_SEQUENCES = [
  '\x1b[2m', '\x1b[3m', '\x1b[4m', '\x1b[7m', '\x1b[9m', '\x1b[21m', '\x1b[22m', '\x1b[23m', '\x1b[24m', '\x1b[27m',
  '\x1b[0m', '\x1b[m', '\x1b[39m', '\x1b[49m', '\x1b[31m', '\x1b[90m', '\x1b[97m', '\x1b[38;5;174m',
  '\x1b[38;2;215;119;87m', '\x1b[38:2::215:119:87m', '\x1b[38:5:211m', '\x1b[48;5;236m', '\x1b[48;2;1;2;3m',
  '\x1b[4:3m', '\x1b[58;5;1m', '\x1b[58:2::9:9:9m', '\x1b[59m', '\x1b[2;3;4m', '\x1b[2K', '\x1b[1A', '\x1b[G',
  '\x1b[3G', '\x1b[H', '\x1b[2;5H', '\x1b[J', '\x1b[K', '\x1b[5X', '\x1b[2@', '\x1b[L', '\x1b[M', '\x1b[3P',
  '\x1b[?25l', '\x1b[?25h', '\x1b[?2026h', '\x1b[?2026l', '\x1b[?2004h', '\x1b[?2004l', '\x1b[?1004h',
  '\x1b[?1000h', '\x1b[?1006h', '\x1b[?1000l', '\x1b[>1u', '\x1b[<u', '\x1b[=1;1u', '\x1b[>4;2m', '\x1b[>4m',
  '\x1b[?1049h', '\x1b[?1049l', '\x1b7', '\x1b8', '\x1b[s', '\x1b[u', '\x1b]0;✳ Claude Code\x07',
  '\x1b]2;title\x1b\\', '\x1b]7501;state=working\x1b\\', '\x1b]7501;state=blocked:kind=question\x07',
  '\x1b]52;c;aGk=\x07', '\x1bP$qm\x1b\\', '\x1b_apc\x1b\\', '\x1b(B', '\x1b(0', '\x1b)0', '\x1b=', '\x1b>', '\x1bM',
];

/** At least `size` bytes of mixed output with no bold and no links. */
function mixedOutput(seed: number, size: number): Uint8Array {
  const next = random(seed);
  let text = '';
  while (Buffer.byteLength(text) < size) text += next() < 0.55 ? pick(next, TEXT) : pick(next, PLAIN_SEQUENCES);
  return bytes(text);
}

// What the styler acts on, and the odd forms of it that xterm reads in its own way: bold turned on
// and off in each form, colours whose arguments hold a 1, links to web pages and to other places,
// in ESC \, BEL and 8-bit endings, links cut short by another sequence, cancelled sequences, the
// three screen switches with and without their cursor save, saves and restores, and both resets.
const STYLE_SEQUENCES = [
  '\x1b[1m', '\x1b[1m', '\x1b[1;31m', '\x1b[31;1m', '\x1b[1:2m', '\x1b[22m', '\x1b[221m', '\x1b[0;1m', '\x1b[1;0m',
  '\x1b[;1m', '\x1b[1;38;5;1m', '\x1b[38;0;1m', '\x1b[38;5m', '\x1b[38;2;1m', '\x1b[48;5;1;1m', '\x1b[38;3;1;1;1;1;1m',
  link(WEB), link(WEB), link('http://example.com/b', 'id=x'), link('https://exämple.com/ü'), link('file:///etc/passwd'),
  link('mailto:me@example.com'), END_LINK, END_LINK, '\x1b]8;;https://example.com/bel\x07', '\x1b]8;;\x07',
  '\x1b]8;id=x;\x1b\\', '\x1b]8\x07', '\x1b]08;;https://example.com/zero\x07', '\x1b]8;;https://example.com/cut\x1b[33m',
  '\u009b1m', '\u009b22m', '\u009d8;;https://c1.example.com\u009c', '\u009d8;;\u009c', '\x1b[1\x18m',
  '\x1b]8;;https://example.com/cancel\x1a', '\x1bc', '\x1b[!p', '\x1b[?47h', '\x1b[?47l', '\x1b[?1047h',
  '\x1b[?1047l', '\x1b[?1048h', '\x1b[?1048l', '\x1b[?1049;25h', '\x1b[?25;1049l', '\x1b[4m', '\x1b[24m', '\x1b[0m',
];

/** Mixed output with bold text and links in it. */
function styledOutput(seed: number, tokens: number): Uint8Array {
  const next = random(seed);
  let text = '';
  for (let i = 0; i < tokens; i++) {
    const roll = next();
    text += roll < 0.45 ? pick(next, TEXT) : roll < 0.7 ? pick(next, PLAIN_SEQUENCES) : pick(next, STYLE_SEQUENCES);
  }
  return bytes(text);
}

// A short stretch with something of everything: split at every byte, it must still give the
// same output.
const VARIED = bytes(
  `\x1b[1mr\x1bca\x1b[1mbold 中\x1b[39mé\x1b[22m${link(WEB)}lïnk\x1b[31m${END_LINK}\x1b[1;38:2::1:2:3m🍎\x1b[0m` +
    `\x1b]8;id=1;https://example.com/b\x07x\x1b]8;;\x07\x1b7\x1b[1m\x1b8y\u009b1mz\x1b[?1049h\x1b[22m\x1b[?1049l` +
    `\x1b]8;;https://example.com/c\x1b[33mq\x1b[0;1mw`,
);

describe('createTermStyler', () => {
  it('passes output without bold or links through as the very same bytes', () => {
    const style = createTermStyler(COLORS);
    const chunk = bytes('plain text, wörld 🍎 … 中文\r\n\t\x07\b\x1b[31mred\x1b[0m');
    expect(style(chunk)).toBe(chunk);
  });

  it('passes 50 KB of mixed output with no bold and no links through byte for byte, whole or in pieces', () => {
    const output = mixedOutput(1, 50 * 1024);
    expect(output.length).toBeGreaterThanOrEqual(50 * 1024);
    expect(createTermStyler(COLORS)(output)).toBe(output);
    const style = createTermStyler(COLORS);
    for (const piece of cut(output, random(2), 300)) expect(style(piece)).toBe(piece);
  });

  it('throws on a colour that is not #rrggbb', () => {
    expect(() => createTermStyler({ bold: 'addb67', link: '#82aaff' })).toThrow();
    expect(() => createTermStyler({ bold: '#addb67', link: 'blue' })).toThrow();
  });

  describe('bold', () => {
    it('draws bold text in the bold colour and ends the colour where the bold ends', () => {
      expect(styled('\x1b[1mX\x1b[22mY')).toBe(`\x1b[1m${BOLD}X\x1b[22m${DEFAULT_FG}Y`);
      // SGR 221 is kitty's "not bold", which xterm follows.
      expect(styled('\x1b[1mX\x1b[221mY')).toBe(`\x1b[1m${BOLD}X\x1b[221m${DEFAULT_FG}Y`);
    });

    it.each([
      ['a basic colour', '\x1b[1;31mX'],
      ['a colour given first', '\x1b[31;1mX'],
      ['a bright colour', '\x1b[1;91mX'],
      ['a 256-colour', '\x1b[1;38;5;196mX'],
      ['a truecolour', '\x1b[1;38;2;1;2;3mX'],
      ['a truecolour in colon form', '\x1b[1;38:2::1:2:3mX'],
      ['a 256-colour in colon form', '\x1b[1;38:5:196mX'],
      ['a colour set before the bold', '\x1b[31m\x1b[1mX\x1b[22mY'],
    ])('leaves bold text in %s alone', (_name, input) => {
      expect(styled(input)).toBe(input);
    });

    it('colours bold text again when its foreground goes back to the default', () => {
      expect(styled('\x1b[1m\x1b[39mX')).toBe(`\x1b[1m${BOLD}\x1b[39m${BOLD}X`);
      expect(styled('\x1b[31;1mA\x1b[39mB')).toBe(`\x1b[31;1mA\x1b[39m${BOLD}B`);
    });

    it('takes SGR 0 as a reset of everything', () => {
      expect(styled('\x1b[1mA\x1b[0mB')).toBe(`\x1b[1m${BOLD}A\x1b[0mB`);
      expect(styled('\x1b[1mA\x1b[mB')).toBe(`\x1b[1m${BOLD}A\x1b[mB`);
      expect(styled('\x1b[1;0mA')).toBe('\x1b[1;0mA');
      expect(styled('\x1b[31m\x1b[0;1mA')).toBe(`\x1b[31m\x1b[0;1m${BOLD}A`);
    });

    it('passes colon sub-parameters through untouched and reads only their main parameter', () => {
      expect(styled('\x1b[1m\x1b[38:2::255:0:0mX\x1b[4:3mY\x1b[39mZ')).toBe(
        `\x1b[1m${BOLD}\x1b[38:2::255:0:0mX\x1b[4:3mY\x1b[39m${BOLD}Z`,
      );
      // To xterm, 1:2 is bold all the same.
      expect(styled('\x1b[1:2mX')).toBe(`\x1b[1:2m${BOLD}X`);
    });

    it.each(['\x1b[48;5;1mX', '\x1b[48;2;1;1;1mX', '\x1b[58;5;1mX', '\x1b[38;5;1mX', '\x1b[38;2;1;1;1mX', '\x1b[48:5:1mX'])(
      'does not take the 1 in the colour %j for bold',
      (input) => {
        expect(styled(input)).toBe(input);
      },
    );

    it('reads only the SGR: a private or intermediate m is something else', () => {
      expect(styled('\x1b[>1mX')).toBe('\x1b[>1mX');
      expect(styled('\x1b[1 mX')).toBe('\x1b[1 mX');
    });

    it('gives the same output when an SGR is cut between two chunks', () => {
      const input = '\x1b[1;38:2::1:2:3mA\x1b[39mB\x1b[22mC';
      const whole = styled(input);
      for (let i = 1; i < input.length; i++) expect(styled(input.slice(0, i), input.slice(i))).toBe(whole);
    });
  });

  describe('OSC 8 links', () => {
    it('draws a web link in the link colour and gives back what was there before', () => {
      expect(styled(`A${link(WEB)}L${END_LINK}B`)).toBe(`A${link(WEB)}${LINK}L${END_LINK}${DEFAULT_FG}B`);
      expect(styled(`\x1b[31mA${link(WEB)}L${END_LINK}B`)).toBe(`\x1b[31mA${link(WEB)}${LINK}L${END_LINK}\x1b[31mB`);
      expect(styled(`\x1b[1mA${link(WEB)}L${END_LINK}B`)).toBe(
        `\x1b[1m${BOLD}A${link(WEB)}${LINK}L${END_LINK}${BOLD}B`,
      );
      expect(styled(`\x1b[38;5;196m${link(WEB)}L${END_LINK}`)).toBe(
        `\x1b[38;5;196m${link(WEB)}${LINK}L${END_LINK}\x1b[38;5;196m`,
      );
      expect(styled(`\x1b[38:2::1:2:3m${link(WEB)}L${END_LINK}`)).toBe(
        `\x1b[38:2::1:2:3m${link(WEB)}${LINK}L${END_LINK}\x1b[38;2;1;2;3m`,
      );
    });

    it('reads links that end in BEL, carry an id, or point at a web page with any characters', () => {
      expect(styled(`\x1b]8;;${WEB}\x07L\x1b]8;;\x07B`)).toBe(`\x1b]8;;${WEB}\x07${LINK}L\x1b]8;;\x07${DEFAULT_FG}B`);
      expect(styled(`${link(WEB, 'id=x:foo=bar')}L`)).toBe(`${link(WEB, 'id=x:foo=bar')}${LINK}L`);
      expect(styled(`${link('https://exämple.com/ü')}L`)).toBe(`${link('https://exämple.com/ü')}${LINK}L`);
    });

    it('keeps the link colour over a colour or a reset inside the link, as xterm keeps the link', () => {
      expect(styled(`${link(WEB)}\x1b[32mL${END_LINK}B`)).toBe(
        `${link(WEB)}${LINK}\x1b[32m${LINK}L${END_LINK}\x1b[32mB`,
      );
      expect(styled(`${link(WEB)}A\x1b[0mB${END_LINK}C`)).toBe(
        `${link(WEB)}${LINK}A\x1b[0m${LINK}B${END_LINK}${DEFAULT_FG}C`,
      );
    });

    it.each([
      'file:///etc/passwd',
      'mailto:me@example.com',
      'javascript:alert(1)',
      'ftp://example.com/x',
      'not a url',
      `https://example.com/${'x'.repeat(9000)}`,
    ])('leaves a link to %s alone: it does not open, so it must not look as if it did', (uri) => {
      const input = `A${link(uri)}L${END_LINK}B`;
      expect(styled(input)).toBe(input);
    });

    it('gives back the colour when a web link gives way to another kind of link', () => {
      expect(styled(`${link(WEB)}A${link('file:///x')}B${END_LINK}`)).toBe(
        `${link(WEB)}${LINK}A${link('file:///x')}${DEFAULT_FG}B${END_LINK}`,
      );
    });

    it('ignores the OSC 8 forms xterm ignores', () => {
      // An end with params: xterm leaves the link open.
      expect(styled(`${link(WEB)}A\x1b]8;id=1;\x1b\\B${END_LINK}C`)).toBe(
        `${link(WEB)}${LINK}A\x1b]8;id=1;\x1b\\B${END_LINK}${DEFAULT_FG}C`,
      );
      // No separator at all.
      expect(styled('\x1b]8\x07A\x1b]8;\x07B')).toBe('\x1b]8\x07A\x1b]8;\x07B');
    });

    it('colours a link ended by the next sequence after that sequence, never between ESC and its follower', () => {
      expect(styled(`\x1b]8;;${WEB}\x1b[31mL`)).toBe(`\x1b]8;;${WEB}\x1b[31m${LINK}L`);
    });

    it('drops a sequence that CAN or SUB cancels, as xterm does', () => {
      expect(styled('\x1b[1\x18mX')).toBe('\x1b[1\x18mX');
      expect(styled(`\x1b]8;;${WEB}\x1aL`)).toBe(`\x1b]8;;${WEB}\x1aL`);
    });

    it('passes a large OSC 52 copy through as the same bytes', () => {
      const chunk = bytes(`\x1b]52;c;${'QUJD'.repeat(256 * 1024)}\x07`);
      expect(createTermStyler(COLORS)(chunk)).toBe(chunk);
    });
  });

  describe('screens, saves and resets', () => {
    it('passes the alternate screen switch through untouched', () => {
      const style = createTermStyler(COLORS);
      for (const input of ['\x1b[?1049h', 'text', '\x1b[?1049l', '\x1b[?47h\x1b[?47l\x1b[?1047h\x1b[?1047l']) {
        const chunk = bytes(input);
        expect(style(chunk)).toBe(chunk);
      }
      // Leaving the screen restores the attributes saved on the way in: not bold, so nothing to add.
      expect(styled('\x1b[?1049h\x1b[1mX\x1b[?1049lY')).toBe(`\x1b[?1049h\x1b[1m${BOLD}X\x1b[?1049lY`);
      // Bold on the way in: xterm restores the bold and its colour itself.
      expect(styled('\x1b[1mA\x1b[?1049h\x1b[22mB\x1b[?1049lC')).toBe(
        `\x1b[1m${BOLD}A\x1b[?1049h\x1b[22m${DEFAULT_FG}B\x1b[?1049lC`,
      );
    });

    it('follows ESC 7 and ESC 8, which save and restore the bold and the colour xterm had', () => {
      // Saved plain: the restore brings back plain text, so the bold colour must not come back.
      expect(styled('\x1b7\x1b[1mX\x1b8Y\x1b[39mZ')).toBe(`\x1b7\x1b[1m${BOLD}X\x1b8Y\x1b[39mZ`);
      // Saved bold: xterm restores the bold colour with it.
      expect(styled('\x1b[1m\x1b7\x1b[22mX\x1b8Y\x1b[39mZ')).toBe(
        `\x1b[1m${BOLD}\x1b7\x1b[22m${DEFAULT_FG}X\x1b8Y\x1b[39m${BOLD}Z`,
      );
    });

    it('takes CSI s and CSI u as save and restore, but not the kitty keyboard CSI > 1 u', () => {
      expect(styled('\x1b[s\x1b[1mX\x1b[uY\x1b[39mZ')).toBe(`\x1b[s\x1b[1m${BOLD}X\x1b[uY\x1b[39mZ`);
      expect(styled('\x1b[s\x1b[1mX\x1b[>1uY\x1b[<uZ')).toBe(`\x1b[s\x1b[1m${BOLD}X\x1b[>1uY\x1b[<uZ`);
    });

    it('after a restore re-asserts its own colour, so no stale link colour stays behind', () => {
      // Saved in a web link, restored after it: xterm brings the link colour back, the styler takes it away.
      expect(styled(`${link(WEB)}\x1b7${END_LINK}\x1b8X`)).toBe(
        `${link(WEB)}${LINK}\x1b7${END_LINK}${DEFAULT_FG}\x1b8${DEFAULT_FG}X`,
      );
      // Saved outside a link, restored in a web link: the restore takes the link colour away, the styler puts it back.
      expect(styled(`\x1b7${link(WEB)}\x1b8X`)).toBe(`\x1b7${link(WEB)}${LINK}\x1b8${LINK}X`);
    });

    it('keeps the saved attributes of the normal and the alternate screen apart, as xterm does', () => {
      // The ESC 7 on the alternate screen doesn't overwrite what ?1049h saved on the normal one.
      expect(styled('\x1b[?1049h\x1b[1m\x1b7\x1b[22m\x1b[?1049l\x1b[39mX')).toBe(
        `\x1b[?1049h\x1b[1m${BOLD}\x1b7\x1b[22m${DEFAULT_FG}\x1b[?1049l\x1b[39mX`,
      );
    });

    it('takes RIS (ESC c) as a full reset: attributes, link and saved attributes', () => {
      expect(styled('\x1b[1mA\x1bcB\x1b[1mC')).toBe(`\x1b[1m${BOLD}A\x1bcB\x1b[1m${BOLD}C`);
      expect(styled(`${link(WEB)}A\x1bcB`)).toBe(`${link(WEB)}${LINK}A\x1bcB`);
      expect(styled('\x1b[1m\x1b7\x1bc\x1b8\x1b[39mX')).toBe(`\x1b[1m${BOLD}\x1b7\x1bc\x1b8\x1b[39mX`);
    });

    it('takes DECSTR (CSI ! p) as a reset of the attributes and the link', () => {
      expect(styled(`\x1b[1m${link(WEB)}A\x1b[!pB\x1b[1mC`)).toBe(
        `\x1b[1m${BOLD}${link(WEB)}${LINK}A\x1b[!pB\x1b[1m${BOLD}C`,
      );
    });
  });

  describe('bytes', () => {
    it('reads 8-bit C1 controls as xterm does, and never a UTF-8 continuation byte as one', () => {
      expect(styled('\u009b1mX')).toBe(`\u009b1m${BOLD}X`);
      // ś is C5 9B: its 9B is not a CSI.
      expect(styled('ś1mX')).toBe('ś1mX');
    });

    it('finds a sequence after broken UTF-8, as xterm does', () => {
      const input = Buffer.from([0xe2, 0x82, 0x1b, 0x5b, 0x31, 0x6d, 0x58]); // a cut-off € then ESC [1m X
      expect(styleChunks([input])).toEqual(Buffer.concat([input.subarray(0, 6), bytes(BOLD), input.subarray(6)]));
    });

    it('gives the same bytes however the output is cut, at every byte', () => {
      const whole = styleChunks([VARIED]);
      expect(whole.toString()).toContain(BOLD);
      expect(whole.toString()).toContain(LINK);
      for (let i = 0; i <= VARIED.length; i++) {
        expect(styleChunks([VARIED.subarray(0, i), VARIED.subarray(i)])).toEqual(whole);
      }
      for (let seed = 1; seed <= 20; seed++) expect(styleChunks(cut(VARIED, random(seed), 4))).toEqual(whole);
    });
  });
});

// --- As xterm draws it ------------------------------------------------------------------------
// The headless build shares xterm's parser and buffer, so it shows what the renderer's xterm makes
// of the output: the styled output must give the very same screens, cell for cell, with only the
// colour of bold text and of web links changed.

const COLS = 30;
/** xterm's flag for a cell's extended attributes, which carry its link (BgFlags.HAS_EXTENDED). */
const HAS_EXTENDED = 0x10000000;

// xterm's API doesn't say which link a cell belongs to, nor whether its underline has a colour of
// its own or follows the foreground; its cells and link service do. Its input handler restores the
// cursor.
interface CellInternals {
  hasExtendedAttrs(): number;
  extended: { urlId: number; underlineColor: number };
}
interface TerminalInternals {
  _core: {
    _oscLinkService: { getLinkData(id: number): { uri: string } | undefined };
    _inputHandler: { restoreCursor(...args: unknown[]): boolean; _curAttrData: { bg: number; extended: { urlId: number } } };
  };
}

const titles = new WeakMap<headless.Terminal, string[]>();

/**
 * The chunks written one by one, as TerminalView writes them, each parsed on its own. The scrollback
 * holds all of it, so every line is compared.
 *
 * xterm's cursor restore brings back the saved flag that carries an open link to the cells: saved
 * outside the link, the text after the restore is no longer the link's, while the styler still
 * colours it. With `linkSurvivesRestore` the restore leaves an open link on the cells, which shows
 * where the styler colours a link.
 */
async function render(chunks: Uint8Array[], linkSurvivesRestore = false): Promise<headless.Terminal> {
  const term = new headless.Terminal({ cols: COLS, rows: 8, scrollback: 5000, allowProposedApi: true });
  const seen: string[] = [];
  titles.set(term, seen);
  term.onTitleChange((title) => seen.push(title));
  if (linkSurvivesRestore) {
    const handler = (term as unknown as TerminalInternals)._core._inputHandler;
    const restoreCursor = handler.restoreCursor.bind(handler);
    handler.restoreCursor = (...args) => {
      const done = restoreCursor(...args);
      if (handler._curAttrData.extended.urlId) handler._curAttrData.bg |= HAS_EXTENDED;
      return done;
    };
  }
  for (const chunk of chunks) term.write(chunk);
  await new Promise<void>((resolve) => term.write('', resolve));
  return term;
}

type Cell = headless.IBufferCell;

function linkOf(term: headless.Terminal, cell: Cell): string | null {
  const internals = cell as unknown as CellInternals;
  if (!internals.hasExtendedAttrs() || !internals.extended.urlId) return null;
  return (term as unknown as TerminalInternals)._core._oscLinkService.getLinkData(internals.extended.urlId)?.uri ?? '?';
}

const fgOf = (cell: Cell) =>
  cell.isFgRGB() ? `#${cell.getFgColor().toString(16).padStart(6, '0')}` : cell.isFgDefault() ? 'default' : `palette ${cell.getFgColor()}`;

function underlineColorOf(cell: Cell): string {
  const internals = cell as unknown as CellInternals;
  const own = internals.hasExtendedAttrs() && (internals.extended.underlineColor & 0x3000000) !== 0;
  return own ? `${cell.getUnderlineColorMode()}:${cell.getUnderlineColor()}` : 'fg';
}

function look(term: headless.Terminal, cell: Cell) {
  return {
    chars: cell.getChars(),
    width: cell.getWidth(),
    fg: fgOf(cell),
    bg: `${cell.getBgColorMode()}:${cell.getBgColor()}`,
    flags: [cell.isBold(), cell.isItalic(), cell.isDim(), cell.isUnderline(), cell.isBlink(), cell.isInverse(), cell.isInvisible(), cell.isStrikethrough(), cell.isOverline()].map(Boolean),
    underline: `${cell.getUnderlineStyle()}:${underlineColorOf(cell)}`,
    link: linkOf(term, cell),
  };
}

/**
 * Every way the styled screens differ from the original's beyond the two colours; empty if none.
 * `linked`, the original rendered with `linkSurvivesRestore`, says where the colours go; without it
 * the foreground isn't compared at all.
 */
function differences(
  original: headless.Terminal,
  styledTerm: headless.Terminal,
  linked: headless.Terminal | null,
): { diffs: string[]; recoloured: Set<string> } {
  const diffs: string[] = [];
  const recoloured = new Set<string>();
  for (const name of ['normal', 'alternate'] as const) {
    const a = original.buffer[name];
    const b = styledTerm.buffer[name];
    if (a.length !== b.length) diffs.push(`${name}: ${a.length} lines, styled ${b.length}`);
    for (let y = 0; y < Math.min(a.length, b.length); y++) {
      const lineA = a.getLine(y)!;
      const lineB = b.getLine(y)!;
      if (lineA.isWrapped !== lineB.isWrapped) diffs.push(`${name} ${y}: wrapped ${lineA.isWrapped}, styled ${lineB.isWrapped}`);
      for (let x = 0; x < COLS; x++) {
        const cellA = lineA.getCell(x)!;
        const want = look(original, cellA);
        const got = look(styledTerm, lineB.getCell(x)!);
        if (!linked) {
          want.fg = got.fg;
        } else {
          const uri = linkOf(linked, linked.buffer[name].getLine(y)!.getCell(x)!);
          if (uri !== null && httpUrl(uri)) want.fg = COLORS.link;
          else if (cellA.isBold() && cellA.isFgDefault()) want.fg = COLORS.bold;
          if (want.fg !== fgOf(cellA)) recoloured.add(want.fg);
          // xterm forgets a link once every line it was printed on has left the buffer, while the
          // link stays open (a line that scrolls off the alternate screen is gone at once); the
          // styler can't see that, so it may still colour such a link.
          if (uri === '?' && got.fg === COLORS.link) want.fg = COLORS.link;
        }
        if (JSON.stringify(got) !== JSON.stringify(want)) diffs.push(`${name} ${y},${x}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    }
  }
  const where = (t: headless.Terminal) =>
    `${t.buffer.active.type} ${t.buffer.active.cursorX},${t.buffer.active.cursorY} ${JSON.stringify(t.modes)} ${JSON.stringify(titles.get(t))}`;
  if (where(original) !== where(styledTerm)) diffs.push(`cursor, modes and titles: ${where(original)}, styled ${where(styledTerm)}`);
  return { diffs, recoloured };
}

/** The input cut into pieces of up to `longest` bytes, rendered as it is and styled. */
async function compare(input: Uint8Array, seed: number, { longest = 64, colours = true } = {}) {
  const chunks = cut(input, random(seed), longest);
  const style = createTermStyler(COLORS);
  const original = await render(chunks);
  const styledTerm = await render(chunks.map((chunk) => style(chunk)));
  const linked = colours ? await render(chunks, true) : null;
  const result = differences(original, styledTerm, linked);
  for (const term of [original, styledTerm, linked]) term?.dispose();
  return result;
}

// Pieces of sequences rather than whole ones, so the styler's parser meets every odd transition:
// lone ESCs, introducers, parameters and finals, C0 and C1 controls, CAN and SUB, DEL, non-ASCII
// characters and the string introducers, with a few whole sequences among them.
const FRAGMENTS = [
  '\x1b', '\x1b', '\x1b', '[', '[', ']', '8', ';', ';', ':', '1', '1', '2', '3', '5', '9', '0', '4', '7',
  'm', 'm', 'm', 'h', 'l', '?', 'c', 's', 'u', '!', 'p', '>', '<', '=', ' ', '"', '$', '(', 'B', 'P', '_', 'X', '^',
  '\x1bP', '\x1b_', '\x1bX', '\x1b^', '\x1b]0;', '\x07', '\\', '\n', '\r', '\t', '\b', '\x18', '\x1a', '\x7f', '\x00', '\x05',
  'é', '中', '🍎', '\u0085', '\u009b', '\u009c', '\u009d', '\u0090', '\u0098', '\u009f', '\u0099',
  'abc', 'https://e.com/x', 'file:///x', 'id=1', '\x1b[1m', '\x1b[22m', '\x1b[39m', '\x1b[0m', '\x1b]8;;',
  '\x1b]8;;https://e.com/\x07', '\x1b]8;;\x1b\\', '\x1b[?1049h', '\x1b[?1049l', '\x1b7', '\x1b8', '\x1b[38;2;1;2;3m',
  '\x1b[38:2::1:2:3m', '\x1b[38;5;1m', '\x1b[31m',
];

function soup(seed: number, fragments: number): Uint8Array {
  const next = random(seed);
  let text = '';
  for (let i = 0; i < fragments; i++) text += pick(next, FRAGMENTS);
  return bytes(text);
}

describe('as xterm draws it', () => {
  it('compares against the very xterm the app draws with', () => {
    const require = createRequire(import.meta.url);
    expect(require('@xterm/headless/package.json').version).toBe(require('@xterm/xterm/package.json').version);
  });

  const SOUP_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
  it.each(SOUP_SEEDS)('draws a soup of sequence fragments exactly as before, but for the foreground (seed %i)', async (seed) => {
    const input = soup(seed, 300);
    for (const longest of [16, 3]) {
      expect((await compare(input, seed, { longest, colours: false })).diffs.slice(0, 5)).toEqual([]);
    }
  });

  it('draws the varied stretch exactly as before, but for the colour of bold text and web links', async () => {
    const { diffs, recoloured } = await compare(VARIED, 1);
    expect(diffs).toEqual([]);
    expect(recoloured).toEqual(new Set([COLORS.bold, COLORS.link]));
  });

  it('draws 50 KB of mixed output without bold or links exactly as before', async () => {
    const { diffs, recoloured } = await compare(mixedOutput(3, 50 * 1024), 3);
    expect(diffs).toEqual([]);
    expect(recoloured.size).toBe(0);
  });

  const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
  const results = new Map<number, ReturnType<typeof compare>>();
  const compareSeed = (seed: number) => {
    if (!results.has(seed)) results.set(seed, compare(styledOutput(seed, 400), seed));
    return results.get(seed)!;
  };

  it.each(SEEDS)('draws mixed output with bold and links exactly as before, but for those colours (seed %i)', async (seed) => {
    expect((await compareSeed(seed)).diffs.slice(0, 5)).toEqual([]);
  });

  it('recolours both kinds somewhere in the mixed output, so the comparison above is not empty', async () => {
    const all = new Set<string>();
    for (const seed of SEEDS) for (const fg of (await compareSeed(seed)).recoloured) all.add(fg);
    expect(all).toEqual(new Set([COLORS.bold, COLORS.link]));
  });
});
