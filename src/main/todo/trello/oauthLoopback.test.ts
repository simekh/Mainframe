import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { openLoopback, PortsBusyError, type Loopback } from './oauthLoopback';

const page = (p: URLSearchParams): string => `<p>${p.get('code')}</p>`;
const open: Loopback[] = [];
const holders: http.Server[] = [];

afterEach(async () => {
  for (const l of open.splice(0)) {
    l.params.catch(() => undefined);
    l.close();
  }
  await Promise.all(holders.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function hold(port = 0): Promise<number> {
  const s = http.createServer();
  holders.push(s);
  await new Promise<void>((r) => s.listen(port, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
}

const portOf = (l: Loopback): number => Number(new URL(l.redirectUri).port);

async function start(ports: number[], timeoutMs = 5000): Promise<Loopback> {
  const l = await openLoopback({ ports, timeoutMs, page });
  open.push(l);
  return l;
}

/** Listening on the port again proves the loopback released it. */
async function expectFree(port: number): Promise<void> {
  const s = http.createServer();
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((r) => s.close(r));
}

describe('openLoopback', () => {
  it('takes the next port when the first is taken', async () => {
    const busy = await hold();
    const l = await start([busy, 0]);
    expect(portOf(l)).not.toBe(busy);
    expect(l.redirectUri).toBe(`http://127.0.0.1:${portOf(l)}/callback`);
  });

  it('rejects with PortsBusyError when every port is taken', async () => {
    const a = await hold();
    const b = await hold();
    await expect(openLoopback({ ports: [a, b], timeoutMs: 1000, page })).rejects.toBeInstanceOf(PortsBusyError);
  });

  it('ignores /favicon.ico and resolves with the callback query', async () => {
    const l = await start([0]);
    const port = portOf(l);
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/favicon.ico`)).status).toBe(404);
    expect((await fetch(`${base}/callback`, { method: 'POST' })).status).toBe(404);
    const res = await fetch(`${base}/callback?code=abc&state=xyz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('<p>abc</p>');
    const params = await l.params;
    expect(params.get('code')).toBe('abc');
    expect(params.get('state')).toBe('xyz');
    await expectFree(port);
  });

  it('rejects after the timeout and frees the port', async () => {
    const l = await start([0], 50);
    await expect(l.params).rejects.toThrow('No answer from the browser in time');
    await expectFree(portOf(l));
  });

  it('close() before the callback rejects params and frees the port', async () => {
    const l = await start([0]);
    l.close();
    await expect(l.params).rejects.toThrow('The sign-in was cancelled');
    await expectFree(portOf(l));
  });
});
