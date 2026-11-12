import { request } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { startMcpServer } from './mcpServer';

type Started = Awaited<ReturnType<typeof startMcpServer>>;
const running: Started[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

const start = async (register: Parameters<typeof startMcpServer>[0] = () => {}) => {
  const server = await startMcpServer(register);
  running.push(server);
  return server;
};

const LIST_TOOLS = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

/** A POST of a JSON-RPC request, as an MCP client sends it; `headers` are added to what it always sends. */
function post(url: string, headers: Record<string, string>, body = LIST_TOOLS): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      // A fresh connection each time, as a pooled one would still be held by the server.
      { method: 'POST', agent: false, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

it('listens on 127.0.0.1 at a random port, under /mcp, with a token made for this run', async () => {
  const a = await start();
  const b = await start();
  expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/mcp$/);
  expect(a.url).not.toBe(b.url);
  expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  expect(a.token).not.toBe(b.token);
});

it('answers 401 to a request without the token, or with another one', async () => {
  const { url, token } = await start();
  const sameLength = '0'.repeat(token.length);
  for (const headers of [{}, bearer('wrong'), bearer(sameLength), bearer(`${token}0`), { authorization: token }, { authorization: `Basic ${token}` }]) {
    expect((await post(url, headers)).status).toBe(401);
  }
});

it('lists the tools that register added, for a request with the token', async () => {
  const { url, token } = await start((server) => {
    server.registerTool('ping', { description: 'Answers pong', inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
  });
  const response = await post(url, bearer(token));
  expect(response.status).toBe(200);
  expect(response.body).toContain('"name":"ping"');
  expect(response.body).toContain('Answers pong');
});

it('refuses a request whose Host or Origin is not the machine itself, even with the token', async () => {
  const { url, token } = await start();
  expect((await post(url, { ...bearer(token), host: 'evil.example' })).status).toBe(403);
  expect((await post(url, { ...bearer(token), origin: 'http://evil.example' })).status).toBe(403);
  expect((await post(url, { ...bearer(token), host: 'localhost' })).status).toBe(200);
});

it('answers 404 under any other path', async () => {
  const { url, token } = await start();
  expect((await post(url.replace('/mcp', '/other'), bearer(token))).status).toBe(404);
});

it('close frees the port', async () => {
  const { url, token, close } = await start();
  expect((await post(url, bearer(token))).status).toBe(200);

  await close();

  await expect(post(url, bearer(token))).rejects.toMatchObject({ code: 'ECONNREFUSED' });
});
