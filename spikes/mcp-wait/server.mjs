// Spec §11.6 spike: a stdio MCP server whose one tool resolves after the given number of seconds.
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'wait', version: '1.0.0' });

server.registerTool(
  'wait_seconds',
  {
    description: 'Waits the given number of seconds, then answers.',
    inputSchema: z.object({ seconds: z.number() }),
  },
  async ({ seconds }) => {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return { content: [{ type: 'text', text: `waited ${seconds}s` }] };
  },
);

await server.connect(new StdioServerTransport());
