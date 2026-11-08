import { getDefaults, lexer, type MarkedToken, type Token } from 'marked';

/**
 * A card's text as Markdown blocks, as a tracker shows it: GitHub's flavour, and a single newline breaks the line. The
 * lexer takes its options whole, not merged with the defaults, so they start from the library's own.
 */
export const cardTokens = (text: string): Token[] => lexer(text, { ...getDefaults(), gfm: true, breaks: true });

/** The text of inline tokens, which run together; `blockText` is that of blocks, which a reader takes in one at a time. */
const inlineText = (tokens: Token[]) => tokens.map(textOf).join('');
const blockText = (tokens: Token[]) => tokens.map(textOf).join(' ');

function textOf(token: Token): string {
  // Marked's own union of tokens: `Token` also admits an extension's, of which there are none.
  const t = token as MarkedToken;
  switch (t.type) {
    case 'blockquote':
    case 'list_item':
      return blockText(t.tokens);
    case 'list':
      return blockText(t.items);
    case 'table':
      return [...t.header, ...t.rows.flat()].map((cell) => inlineText(cell.tokens)).join(' ');
    case 'paragraph':
    case 'heading':
    case 'strong':
    case 'em':
    case 'del':
    case 'link':
    case 'image':
      return inlineText(t.tokens);
    case 'text':
      return t.tokens ? inlineText(t.tokens) : t.text;
    case 'code':
    case 'codespan':
    case 'escape':
    case 'html':
      return t.text;
    case 'br':
      return ' ';
    case 'checkbox':
    case 'def':
    case 'hr':
    case 'space':
      return '';
    default:
      return token.raw;
  }
}

/** A card's text with its Markdown marks gone: what a reader sees, its blocks and lines run together by single spaces. */
export const plainText = (text: string): string => blockText(cardTokens(text)).replace(/\s+/g, ' ').trim();

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The address of a link in a card, if it is one to follow: a web page or an email address, and nothing else. */
export function safeHref(href: string): string | null {
  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol) ? href : null;
  } catch {
    return null;
  }
}
