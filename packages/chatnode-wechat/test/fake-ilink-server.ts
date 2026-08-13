/**
 * Fake iLink server for CI tests — replays recorded/scripted iLink behavior
 * with no WeChat account. Full inbound→session→outbound loop runs against it.
 *
 * Endpoints implemented: getupdates (long-poll), sendmessage, sendtyping,
 * getconfig, get_bot_qrcode, get_qrcode_status, and the CDN download (serving
 * AES-128-ECB-encrypted bytes so the media pipeline is exercised end-to-end).
 *
 * @module @dsh-cowork/chatnode-wechat/test/fake-ilink-server
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCipheriv } from 'node:crypto'
import { pkcs7Pad } from '../src/gateway/media.ts'
import type { InboundMessage } from '../src/gateway/types.ts'

/** Scripted behaviors a test can toggle. */
export interface ScriptedBehavior {
  /** Respond with this `ret` code on getupdates (overrides queue). */
  getUpdatesRet?: number
  /** Respond with this `errcode` on getupdates. */
  getUpdatesErrcode?: number
  /** errmsg for the scripted getupdates error. */
  getUpdatesErrmsg?: string
  /** Respond HTTP 403 to getupdates (exclusive-lock symptom). */
  http403?: boolean
  /** First N sendmessage calls fail with ret=-14 (session expired). */
  sendExpiredCount?: number
  /** sendmessage responses use this ret (rate limit etc.). */
  sendRet?: number
  /** QR status sequence for get_qrcode_status (defaults to wait→scaned→confirmed). */
  qrStatusSequence?: string[]
  /** Login redirect host to emit before `confirmed`. */
  qrRedirectHost?: string
}

export interface SentMessage {
  to: string
  text: string
  contextToken?: string
  clientId: string
  headers: Record<string, string>
}

export interface SentTyping {
  toUserId: string
  status: number
}

export interface FakeIlinkServer {
  url: string
  /** Outbound messages recorded by sendmessage, in order. */
  sent: SentMessage[]
  typing: SentTyping[]
  /** Count of getupdates calls received. */
  getUpdatesCalls: number
  /** Queue of inbound messages to deliver on the next getupdates calls. */
  queue: InboundMessage[]
  /** Queue of encrypted media blobs served by the CDN endpoint. */
  media: Map<string, { key: Uint8Array; plaintext: Uint8Array }>
  /** Push more inbound messages at any time. */
  enqueue(message: InboundMessage): void
  /** Reset recorded state. */
  reset(): void
  /** Scripted behaviors (mutate freely between calls). */
  behavior: ScriptedBehavior
  close(): Promise<void>
}

const MEDIA_AES_KEY = Buffer.from('0123456789abcdef', 'ascii')

/** Encrypt media for the fake CDN with the well-known test key. */
export function encryptMedia(plaintext: Uint8Array, key: Uint8Array = MEDIA_AES_KEY): Uint8Array {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([Buffer.from(cipher.update(pkcs7Pad(plaintext))), Buffer.from(cipher.final())])
}

/** The well-known AES key the fake CDN media is encrypted with. */
export function mediaKey(): Uint8Array {
  return MEDIA_AES_KEY
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function fixturesPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
}

/** Load one NDJSON fixture file (one JSON message per line) into a queue. */
export function loadFixtureLines(name: string): InboundMessage[] {
  const path = join(fixturesPath(), name)
  const raw = readFileSync(path, 'utf8')
  return raw.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as InboundMessage)
}

/** Start a fake iLink server on an ephemeral port. */
export async function startFakeIlinkServer(opts?: {
  behavior?: ScriptedBehavior
  queue?: InboundMessage[]
}): Promise<FakeIlinkServer> {
  const behavior: ScriptedBehavior = opts?.behavior ?? {}
  const queue: InboundMessage[] = [...(opts?.queue ?? [])]
  const sent: SentMessage[] = []
  const typing: SentTyping[] = []
  const media = new Map<string, { key: Uint8Array; plaintext: Uint8Array }>()
  let getUpdatesCalls = 0
  let syncBufCounter = 0
  let qrStatusIndex = 0
  let sendExpiredDelivered = 0

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (req.method === 'POST' && path.endsWith('/getupdates')) {
      getUpdatesCalls += 1
      if (behavior.http403) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('forbidden')
        return
      }
      if (behavior.getUpdatesRet !== undefined || behavior.getUpdatesErrcode !== undefined) {
        json(res, 200, {
          ret: behavior.getUpdatesRet ?? 0,
          errcode: behavior.getUpdatesErrcode ?? 0,
          errmsg: behavior.getUpdatesErrmsg ?? '',
          get_updates_buf: `buf-${++syncBufCounter}`,
          msgs: [],
        })
        return
      }
      await readBody(req)
      syncBufCounter += 1
      const batch = queue.splice(0, queue.length)
      json(res, 200, {
        ret: 0,
        errcode: 0,
        get_updates_buf: `buf-${syncBufCounter}`,
        longpolling_timeout_ms: 100,
        msgs: batch,
      })
      return
    }

    if (req.method === 'POST' && path.endsWith('/sendmessage')) {
      const body = JSON.parse(await readBody(req)) as {
        msg?: {
          to_user_id?: string
          text?: string
          context_token?: string
          client_id?: string
          item_list?: Array<{ type?: number; text_item?: { text?: string } }>
        }
      }
      const msg = body.msg ?? {}
      const text = (msg.item_list ?? [])
        .filter((item) => item.type === 1)
        .map((item) => item.text_item?.text ?? '')
        .join('')
      sent.push({
        to: msg.to_user_id ?? '',
        text,
        contextToken: msg.context_token,
        clientId: msg.client_id ?? '',
        headers: {
          authorization: String(req.headers.authorization ?? ''),
          'iLink-App-Id': String(req.headers['ilink-app-id'] ?? ''),
        },
      })
      if (sendExpiredDelivered < (behavior.sendExpiredCount ?? 0)) {
        sendExpiredDelivered += 1
        json(res, 200, { ret: -14, errcode: -14, errmsg: 'session expired' })
        return
      }
      if (behavior.sendRet !== undefined && behavior.sendRet !== 0) {
        json(res, 200, { ret: behavior.sendRet, errcode: behavior.sendRet, errmsg: 'freq limit' })
        return
      }
      json(res, 200, { ret: 0, errcode: 0 })
      return
    }

    if (req.method === 'POST' && path.endsWith('/sendtyping')) {
      const body = JSON.parse(await readBody(req)) as { ilink_user_id?: string; status?: number }
      typing.push({ toUserId: body.ilink_user_id ?? '', status: body.status ?? 0 })
      json(res, 200, { ret: 0, errcode: 0 })
      return
    }

    if (req.method === 'POST' && path.endsWith('/getconfig')) {
      await readBody(req)
      json(res, 200, { ret: 0, errcode: 0, typing_ticket: 'ticket-fake-1' })
      return
    }

    if (req.method === 'GET' && path.endsWith('/get_bot_qrcode')) {
      json(res, 200, {
        qrcode: 'hex-qr-token-1234',
        qrcode_img_content: 'https://weixin.qq.com/qr/hex-qr-token-1234',
      })
      return
    }

    if (req.method === 'GET' && path.endsWith('/get_qrcode_status')) {
      const sequence = behavior.qrStatusSequence ?? ['wait', 'scaned', 'confirmed']
      const status = sequence[Math.min(qrStatusIndex, sequence.length - 1)] ?? 'confirmed'
      qrStatusIndex += 1
      if (status === 'confirmed') {
        json(res, 200, {
          status: 'confirmed',
          ilink_bot_id: 'wxid_bot_fake',
          bot_token: 'fake-bot-token',
          baseurl: serverUrl(server),
          ilink_user_id: 'wxid_bot_fake',
        })
      } else if (status === 'scaned_but_redirect') {
        json(res, 200, { status: 'scaned_but_redirect', redirect_host: behavior.qrRedirectHost })
      } else {
        json(res, 200, { status })
      }
      return
    }

    if (req.method === 'GET' && path.endsWith('/download')) {
      const query = url.searchParams.get('encrypted_query_param') ?? ''
      const entry = media.get(query)
      if (!entry) {
        res.writeHead(404)
        res.end('no media')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.from(encryptMedia(entry.plaintext, entry.key)))
      return
    }

    json(res, 404, { error: `no route ${req.method} ${path}` })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fake server failed to bind')
  const url = `http://127.0.0.1:${address.port}`

  return {
    url,
    sent,
    typing,
    get getUpdatesCalls() {
      return getUpdatesCalls
    },
    queue,
    media,
    enqueue(message: InboundMessage) {
      this.queue.push(message)
    },
    reset() {
      sent.length = 0
      typing.length = 0
      queue.length = 0
      media.clear()
      getUpdatesCalls = 0
      syncBufCounter = 0
      qrStatusIndex = 0
      sendExpiredDelivered = 0
    },
    behavior,
    close() {
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

function serverUrl(server: Server): string {
  const address = server.address()
  return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
}
