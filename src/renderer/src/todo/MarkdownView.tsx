import type { MarkedToken, Token } from 'marked';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { httpUrl } from '../../../shared/httpUrl';
import { openLinkLogged } from '../openLink';
import { cardTokens } from './markdown';

const renderAll = (tokens: Token[]): JSX.Element => tokens.map(renderToken);

/** A link that opens in the owner's browser, as the ticket's own does; the window never goes there itself. */
function Link(props: { href: string; children: JSX.Element }) {
  return (
    <a
      href={props.href}
      onClick={(e) => {
        e.preventDefault();
        openLinkLogged(props.href, 'todo');
      }}
      onAuxClick={(e) => e.preventDefault()}
    >
      {props.children}
    </a>
  );
}

/**
 * One token as elements. Card text comes from anyone who can write on the board, and this renderer can reach
 * `window.mainframe`: so every piece of text is a text node and none is HTML, a link opens only where `httpUrl` allows
 * (the check main makes again before it opens one), and an image is never loaded.
 */
function renderToken(token: Token): JSX.Element {
  // Marked's own union of tokens, so the switch below is checked to cover each: `Token` also admits an extension's,
  // of which there are none.
  const t = token as MarkedToken;
  switch (t.type) {
    case 'heading':
      // Under the ticket's title, which is an h3: a card's own headings start one below it, and stay small.
      return <Dynamic component={`h${Math.min(6, t.depth + 2)}` as 'h3'}>{renderAll(t.tokens)}</Dynamic>;
    case 'paragraph':
      return <p>{renderAll(t.tokens)}</p>;
    case 'list': {
      const items = t.items.map(renderToken);
      return t.ordered ? <ol start={t.start === '' ? undefined : t.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'list_item':
      return <li class={t.task ? 'md-task' : undefined}>{renderAll(t.tokens)}</li>;
    case 'checkbox':
      return <input type="checkbox" checked={t.checked} disabled aria-label={t.checked ? 'Done' : 'Not done'} />;
    case 'code':
      return (
        <pre>
          <code>{t.text}</code>
        </pre>
      );
    case 'blockquote':
      return <blockquote>{renderAll(t.tokens)}</blockquote>;
    case 'hr':
      return <hr />;
    case 'table':
      return (
        <div class="md-table">
          <table>
            <thead>
              <tr>
                {t.header.map((cell) => (
                  <th style={{ 'text-align': cell.align ?? undefined }}>{renderAll(cell.tokens)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row) => (
                <tr>
                  {row.map((cell) => (
                    <td style={{ 'text-align': cell.align ?? undefined }}>{renderAll(cell.tokens)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'strong':
      return <strong>{renderAll(t.tokens)}</strong>;
    case 'em':
      return <em>{renderAll(t.tokens)}</em>;
    case 'del':
      return <del>{renderAll(t.tokens)}</del>;
    case 'codespan':
      return <code>{t.text}</code>;
    case 'br':
      return <br />;
    case 'link': {
      // A link only where the address is one to follow.
      const href = httpUrl(t.href);
      return href ? <Link href={href}>{renderAll(t.tokens)}</Link> : renderAll(t.tokens);
    }
    case 'image':
      // Never loaded, and no link of its own: its alt text stands for it, inside the link around it if there is one.
      return t.text;
    case 'html':
      // The text of the tag, as written: a block of it has a paragraph of its own.
      return t.block ? <p>{t.text}</p> : t.text;
    case 'text':
      return t.tokens ? renderAll(t.tokens) : t.text;
    case 'escape':
      return t.text;
    case 'space':
    case 'def':
      return null;
  }
}

/** A card's description, set as the Markdown it is written in. */
export default function Markdown(props: { text: string }) {
  return <div class="md">{renderAll(cardTokens(props.text))}</div>;
}
