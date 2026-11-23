import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Every port offered for the sign-in redirect is in use. */
export class PortsBusyError extends Error {
  constructor() {
    super('Every port for the sign-in redirect is in use');
  }
}

export interface Loopback {
  redirectUri: string;
  params: Promise<URLSearchParams>;
  close(): void;
}

/**
 * Listens on 127.0.0.1 at the first free port of `ports` (0 = any, for e2e). `params` resolves with the first
 * /callback request's query and rejects after `timeoutMs` or on close(). The server is closed after any of the
 * three; any other path or method gets 404, a target it can't read 400, and is ignored.
 */
export async function openLoopback(o: {
  ports: number[];
  timeoutMs: number;
  page: (params: URLSearchParams) => string;
}): Promise<Loopback> {
  let settle!: { resolve: (p: URLSearchParams) => void; reject: (e: Error) => void };
  const params = new Promise<URLSearchParams>((resolve, reject) => (settle = { resolve, reject }));
  let timer: NodeJS.Timeout | undefined;

  const server = http.createServer((req, res) => {
    let url: URL;
    let body: string;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET' || url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      body = o.page(url.searchParams);
    } catch {
      // A target `new URL` can't read (`//`), or a page that throws: this request is no answer.
      if (!res.headersSent) res.writeHead(400).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    res.end(body);
    finish(() => settle.resolve(url.searchParams));
  });

  /** Stops listening and the timer, then settles `params`. Later calls do nothing. */
  let done = false;
  const finish = (settleParams: () => void): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    server.close(); // closes the idle keep-alive connections too
    settleParams();
  };

  const port = await listenOnFirstFree(server, o.ports);
  // An error once listening is logged: an unheard one would crash the app.
  server.on('error', (err) => console.warn('[trello] sign-in redirect server:', err.message));
  timer = setTimeout(() => finish(() => settle.reject(new Error('No answer from the browser in time'))), o.timeoutMs);
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    params,
    close: () => finish(() => settle.reject(new Error('The sign-in was cancelled'))),
  };
}

async function listenOnFirstFree(server: http.Server, ports: number[]): Promise<number> {
  for (const port of ports) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      return (server.address() as AddressInfo).port;
    } catch (e) {
      // EACCES: a port Windows keeps for itself, as busy as one in use.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
    }
  }
  throw new PortsBusyError();
}
