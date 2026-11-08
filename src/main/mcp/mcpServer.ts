import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

const MCP_PATH = '/mcp';

/**
 * Serves MCP over Streamable HTTP on this machine only, for the manager session. Each request gets a
 * fresh server, which `register` fills with tools. A request needs the token, which is made anew each
 * call, as `Authorization: Bearer <token>`.
 */
export async function startMcpServer(
  register: (server: McpServer) => void,
): Promise<{ url: string; token: string; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'mainframe', version: '1.0.0' });
    register(server);
    return server;
  });
  const serveMcp = toNodeHandler(handler);
  // The handler checks no token, Host or Origin: these keep out other local processes and, by Host,
  // a web page whose domain has been pointed at 127.0.0.1 (DNS rebinding).
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const http = createServer((req, res) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.writeHead(401).end();
    } else if (validateHost(req, res) && validateOrigin(req, res)) {
      if (req.url?.split('?')[0] === MCP_PATH) void serveMcp(req, res);
      else res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });

  const { address, port } = http.address() as AddressInfo;
  return {
    url: `http://${address}:${port}${MCP_PATH}`,
    token,
    close: async () => {
      await handler.close();
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        // A client's open connection would keep the port until it hangs up.
        http.closeAllConnections();
      });
    },
  };
}

/** How long `claude` waits on one of this server's tools, in ms: past the sync run's 5 minutes, which `sync_todo` waits out. */
const TOOL_TIMEOUT_MS = 360_000;

/** The `--mcp-config` entry that has `claude` call this server, as `mainframe`. */
export const mcpConfigJson = (url: string, token: string): string =>
  JSON.stringify({ mcpServers: { mainframe: { type: 'http', url, headers: { Authorization: `Bearer ${token}` }, timeout: TOOL_TIMEOUT_MS } } });
