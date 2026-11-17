// A fake OpenAI Responses API on localhost, so Codex can be tried in Mainframe
// without an account. A dev aid: nothing in src/ imports it and it is not shipped.
// Run: node scripts/fake-codex-model.mjs [port]
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.argv[2] ?? 18765)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Not a port: ${process.argv[2]}`)
  process.exit(1)
}

const codexHome = await mkdtemp(join(tmpdir(), 'mainframe-codex-home-'))
await writeFile(
  join(codexHome, 'config.toml'),
  `model = "fake-model"
model_provider = "fake"
[model_providers.fake]
name = "fake"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
`
)

let counter = 0
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

function answer(res) {
  const n = ++counter
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  res.write(sse('response.created', { response: { id: `resp_${n}` } }))
  res.write(
    sse('response.output_item.done', {
      item: {
        type: 'message',
        role: 'assistant',
        id: `msg_${n}`,
        content: [{ type: 'output_text', text: 'Done (fake model).' }]
      }
    })
  )
  res.end(
    sse('response.completed', {
      response: {
        id: `resp_${n}`,
        usage: {
          input_tokens: 1,
          input_tokens_details: null,
          output_tokens: 1,
          output_tokens_details: null,
          total_tokens: 2
        }
      }
    })
  )
}

const server = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0]
  if (req.method === 'GET' && path.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [] }))
    return
  }
  if (req.method === 'POST' && path === '/v1/responses') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      let hasTools = false
      try {
        const tools = JSON.parse(Buffer.concat(chunks).toString('utf8')).tools
        hasTools = Array.isArray(tools) && tools.length > 0
      } catch {
        // an unreadable body is treated as a side request
      }
      console.log(`${new Date().toISOString()} POST /v1/responses${hasTools ? '' : ' (side request)'}`)
      if (hasTools) setTimeout(() => answer(res), 2000)
      else answer(res)
    })
    return
  }
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} (not served)`)
  res.writeHead(404)
  res.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(
    `Fake Codex model on http://127.0.0.1:${port}. Start Mainframe with CODEX_HOME=${codexHome} npm start (quit your own Mainframe first, or add MAINFRAME_DATA_DIR=<another folder>). Codex will ask once whether to trust the project.`
  )
})
