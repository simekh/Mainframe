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
 * three; any other path or method gets 404 and is ignored.
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
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    res.end(o.page(url.searchParams));
    finish(() => settle.resolve(url.searchParams));
  });

  /** Stops listening and the timer, then settles `params`. Later calls do nothing. */
  let done = false;
  const finish = (settleParams: () => void): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
    settleParams();
  };

  const port = await listenOnFirstFree(server, o.ports);
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
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    }
  }
  throw new PortsBusyError();
}
