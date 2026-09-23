/**
 * A scripted OpenAI-compatible chat-completions server for end-to-end tests.
 * Unlike the official mock (one tool name per instance, one fixed success
 * text), the reply is chosen per request from the request itself, so one
 * server can answer the loop's requests, the session-title request, and the
 * skill router's request differently. SSE frames follow the official mock.
 * @module @boat/testing/scripted-model
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface ChatMessage {
  role: string
  content: unknown
  tool_calls?: unknown
}

export interface ChatRequest {
  model?: string
  messages: ChatMessage[]
  tools?: { function?: { name?: string } }[]
  [key: string]: unknown
}

/** Why a request was made, inferred from its system text. */
export type RequestPurpose = 'loop' | 'title' | 'router'

export interface RecordedRequest {
  purpose: RequestPurpose
  body: ChatRequest
  /** The last user-role message's text. */
  lastUser: string
  systemText: string
}

export type ScriptedReply =
  | { text: string }
  | { toolCall: { name: string; arguments: unknown; id?: string } }

export type Script = (request: RecordedRequest) => ScriptedReply

export interface ScriptedModel {
  /** Base URL without `/v1`; `/v1/chat/completions` is served. */
  baseURL: string
  requests: RecordedRequest[]
  loopRequests(): RecordedRequest[]
  close(): Promise<void>
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(block => (block as { text?: string }).text ?? '').join('')
  return ''
}

function classify(body: ChatRequest): RecordedRequest {
  const systemText = body.messages.filter(message => message.role === 'system').map(message => textOf(message.content)).join('\n')
  const users = body.messages.filter(message => message.role === 'user')
  const lastUser = textOf(users.at(-1)?.content)
  let purpose: RequestPurpose = 'loop'
  if (/concise title/iu.test(systemText)) purpose = 'title'
  else if (/skill 路由器/u.test(systemText)) purpose = 'router'
  return { purpose, body, lastUser, systemText }
}

async function readJson(request: IncomingMessage): Promise<ChatRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest
}

function sse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
}

function writeReply(response: ServerResponse, reply: ScriptedReply): void {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
  response.flushHeaders()
  if ('text' in reply) {
    for (const chunk of Array.from(reply.text)) {
      sse(response, { choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })
    }
    sse(response, { choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: Array.from(reply.text).length } })
  } else {
    const args = typeof reply.toolCall.arguments === 'string' ? reply.toolCall.arguments : JSON.stringify(reply.toolCall.arguments)
    const midpoint = Math.max(1, Math.floor(args.length / 2))
    sse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: reply.toolCall.id ?? 'scripted-call-1', type: 'function', function: { name: reply.toolCall.name, arguments: args.slice(0, midpoint) } }] }, finish_reason: null }] })
    sse(response, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(midpoint) } }] }, finish_reason: null }] })
    sse(response, { choices: [{ index: 0, delta: { content: '' }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })
  }
  sse(response, '[DONE]')
  response.end()
}

/**
 * Start the scripted model.
 * @param script - chooses the reply for each request.
 * @param options - optional exact bearer token.
 * @returns the listening server on an OS-assigned port.
 */
export async function startScriptedModel(script: Script, options: { apiKey?: string } = {}): Promise<ScriptedModel> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || !(request.url ?? '').endsWith('/chat/completions')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }
      if (options.apiKey !== undefined && request.headers.authorization !== `Bearer ${options.apiKey}`) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'unauthorized' } }))
        return
      }
      const recorded = classify(await readJson(request))
      requests.push(recorded)
      writeReply(response, script(recorded))
    })().catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('scripted model: no TCP address')
  return {
    baseURL: `http://127.0.0.1:${String(address.port)}`,
    requests,
    loopRequests: () => requests.filter(request => request.purpose === 'loop'),
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => { resolve() }) }),
  }
}

/** A script that answers the title request with a fixed title and everything else through `loop`. */
export function withTitle(loop: Script, title = 'scripted title'): Script {
  return (request) => (request.purpose === 'title' ? { text: title } : loop(request))
}
