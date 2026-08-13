/**
 * Gateway tests: iLink protocol behavior against the fake server — polling,
 * dedup, send retry/backoff, rate-limit circuit, exclusive-lock 403, session
 * expiry, QR login, and CDN media decryption. No WeChat account needed.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { WechatGateway } from '../src/gateway/index.ts'
import {
  startFakeIlinkServer,
  loadFixtureLines,
  encryptMedia,
  mediaKey,
  type FakeIlinkServer,
} from './fake-ilink-server.ts'
import {
  aes128EcbDecrypt,
  aes128EcbEncrypt,
  downloadMedia,
  parseAesKey,
  pkcs7Pad,
  pkcs7Unpad,
} from '../src/gateway/media.ts'
import type { InboundMessage } from '../src/gateway/types.ts'

const BASE_CONFIG = {
  token: 'test-token',
  accountId: 'wxid_bot_fake',
  longPollTimeoutMs: 1000,
  apiTimeoutMs: 2000,
  pollIdleDelayMs: 5,
  qrPollIntervalMs: 5,
  retryDelayMs: 10,
  backoffDelayMs: 20,
  maxConsecutiveFailures: 2,
  sessionExpiredPauseMs: 30,
  sendChunkRetries: 3,
  sendChunkRetryDelayMs: 5,
}

let server: FakeIlinkServer
let ctx: Context
let gateway: WechatGateway
let messages: InboundMessage[]
let statuses: string[]
let errors: Error[]
let fatals: Error[]

beforeEach(async () => {
  server = await startFakeIlinkServer()
  ctx = new Context()
  messages = []
  statuses = []
  errors = []
  fatals = []
  ctx.on('wechat/message', (m: InboundMessage) => messages.push(m))
  ctx.on('wechat/status', (s: string) => statuses.push(s))
  ctx.on('wechat/error', (e: Error) => errors.push(e))
  ctx.on('wechat/fatal', (e: Error) => fatals.push(e))
  await ctx.plugin(WechatGateway, { ...BASE_CONFIG, baseUrl: server.url, cdnBaseUrl: server.url })
  gateway = ctx.wechat
})

afterEach(async () => {
  await gateway.stop()
  await server.close()
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return
    await sleep(10)
  }
  assert.fail('condition not met within timeout')
}

test('poll loop delivers queued messages and reports connected', async () => {
  server.enqueue({
    from_user_id: 'wxid_user1',
    message_id: 'm1',
    item_list: [{ type: 1, text_item: { text: 'hello' } }],
  })
  await gateway.start()
  await waitFor(() => messages.length === 1)
  assert.equal(messages[0]!.from_user_id, 'wxid_user1')
  assert.equal(messages[0]!.item_list?.[0]?.text_item?.text, 'hello')
  assert.ok(statuses.includes('connected'))
  assert.ok(server.getUpdatesCalls >= 1)
})

test('poll loop drops messages from the bot itself', async () => {
  server.enqueue({
    from_user_id: 'wxid_bot_fake',
    message_id: 'm-self',
    item_list: [{ type: 1, text_item: { text: 'echo' } }],
  })
  await gateway.start()
  await sleep(100)
  assert.equal(messages.length, 0)
})

test('inbound message ids are deduplicated within the TTL', async () => {
  server.enqueue({
    from_user_id: 'wxid_user1',
    message_id: 'dup-1',
    item_list: [{ type: 1, text_item: { text: 'once' } }],
  })
  server.enqueue({
    from_user_id: 'wxid_user1',
    message_id: 'dup-1',
    item_list: [{ type: 1, text_item: { text: 'once' } }],
  })
  await gateway.start()
  await waitFor(() => server.getUpdatesCalls >= 2)
  await sleep(50)
  assert.equal(messages.length, 1)
})

test('fixtures replay: every fixture line becomes a gateway message', async () => {
  const fixtures = loadFixtureLines('inbound.ndjson')
  for (const message of fixtures) server.enqueue(message)
  await gateway.start()
  await waitFor(() => messages.length === fixtures.length, 5000)
  assert.equal(messages.length, fixtures.length)
  // context tokens captured per peer
  assert.equal(gateway.contextTokenFor('wxid_allow1'), 'ctx-token-1006')
})

test('sendText delivers with the latest context token', async () => {
  gateway.contextTokens.set('wxid_user1', 'ctx-latest')
  const result = await gateway.sendText('wxid_user1', 'hello back')
  assert.equal(result.success, true)
  assert.equal(server.sent.length, 1)
  assert.equal(server.sent[0]!.to, 'wxid_user1')
  assert.equal(server.sent[0]!.text, 'hello back')
  assert.equal(server.sent[0]!.contextToken, 'ctx-latest')
  assert.equal(server.sent[0]!.headers['iLink-App-Id'], 'bot')
  assert.ok(server.sent[0]!.headers.authorization.startsWith('Bearer test-token'))
})

test('sendText retries without context_token after session expiry (-14)', async () => {
  server.behavior.sendExpiredCount = 1
  gateway.setContextToken('wxid_user1', 'stale-token')
  const result = await gateway.sendText('wxid_user1', 'ping')
  assert.equal(result.success, true)
  assert.equal(server.sent.length, 2)
  assert.equal(server.sent[0]!.contextToken, 'stale-token')
  assert.equal(server.sent[1]!.contextToken, undefined)
  // the stale token was evicted from the store
  assert.equal(gateway.contextTokenFor('wxid_user1'), undefined)
})

test('sendText rate-limit circuit opens and rejects further sends', async () => {
  server.behavior.sendRet = -2
  const first = await gateway.sendText('wxid_user1', 'burst-1')
  assert.equal(first.success, false)
  assert.ok(first.error!.includes('rate limited'))
  const second = await gateway.sendText('wxid_user1', 'burst-2')
  assert.equal(second.success, false)
  assert.ok(second.error!.includes('cooldown'))
})

test('exclusive-lock 403 stops polling with a loud fatal error', async () => {
  server.behavior.http403 = true
  await gateway.start()
  await waitFor(() => fatals.length === 1, 5000)
  assert.equal(gateway.status, 'error')
  assert.ok(fatals[0]!.message.includes('403'))
  assert.ok(fatals[0]!.message.includes('another poller'))
  const callsAfterFatal = server.getUpdatesCalls
  await sleep(100)
  assert.equal(server.getUpdatesCalls, callsAfterFatal, 'polling must stop after the fatal error')
})

test('session expiry pauses the poll loop then resumes', async () => {
  server.behavior.getUpdatesErrcode = -14
  await gateway.start()
  await waitFor(() => statuses.includes('paused'), 5000)
  server.behavior.getUpdatesErrcode = undefined
  await waitFor(() => statuses[statuses.length - 1] === 'connected', 5000)
  await sleep(30)
  assert.equal(statuses[statuses.length - 1], 'connected')
})

test('repeated poll failures escalate to reconnecting', async () => {
  server.behavior.getUpdatesRet = 1
  server.behavior.getUpdatesErrmsg = 'boom'
  await gateway.start()
  await waitFor(() => statuses.includes('reconnecting'), 5000)
  assert.ok(errors.length >= 1)
})

test('QR login resolves credentials and configures the gateway', async () => {
  const qrSeen: string[] = []
  const result = await gateway.loginQr({
    onQr: (qr) => qrSeen.push(qr.value),
    onStatus: () => {},
  })
  assert.equal(result.success, true)
  assert.deepEqual(result.credentials, {
    accountId: 'wxid_bot_fake',
    token: 'fake-bot-token',
    baseUrl: server.url,
    userId: 'wxid_bot_fake',
  })
  assert.ok(qrSeen.includes('hex-qr-token-1234'))
  assert.equal(gateway.configured, true)
})

test('QR login honors redirect host before confirming', async () => {
  server.behavior.qrStatusSequence = ['wait', 'scaned_but_redirect', 'confirmed']
  const result = await gateway.loginQr({})
  assert.equal(result.success, true)
})

test('aes128-ecb round trip matches the reference padding', () => {
  const key = new TextEncoder().encode('0123456789abcdef')
  const plaintext = new TextEncoder().encode('hello media payload')
  const ciphertext = aes128EcbEncrypt(plaintext, key)
  const decrypted = aes128EcbDecrypt(ciphertext, key)
  assert.equal(new TextDecoder().decode(decrypted), 'hello media payload')
  // pkcs7 helpers
  const padded = pkcs7Pad(new Uint8Array([1, 2, 3]), 16)
  assert.equal(padded.length, 16)
  assert.deepEqual([...pkcs7Unpad(padded)], [1, 2, 3])
})

test('parseAesKey accepts raw-16 and hex-32 encodings', () => {
  const raw = Buffer.from('0123456789abcdef', 'ascii')
  assert.deepEqual([...parseAesKey(raw.toString('base64'))], [...raw])
  const hexText = '00112233445566778899aabbccddeeff'
  const hex = Buffer.from(hexText, 'hex')
  assert.deepEqual([...parseAesKey(Buffer.from(hexText, 'ascii').toString('base64'))], [...hex])
  assert.throws(() => parseAesKey(Buffer.from('bad').toString('base64')))
})

test('media download decrypts CDN payloads served by the fake CDN', async () => {
  const plaintext = new TextEncoder().encode('secret attachment bytes')
  const key = mediaKey()
  server.media.set('eqp-test-1', { key, plaintext })
  const result = await downloadMedia({
    cdnBaseUrl: server.url,
    encryptedQueryParam: 'eqp-test-1',
    aesKeyBase64: Buffer.from(key).toString('base64'),
    allowHosts: ['novac2c.cdn.weixin.qq.com', '127.0.0.1'],
  })
  assert.equal(new TextDecoder().decode(result), 'secret attachment bytes')
})

test('media download rejects non-CDN hosts (SSRF guard)', async () => {
  await assert.rejects(
    downloadMedia({
      cdnBaseUrl: 'http://127.0.0.1:1',
      encryptedQueryParam: 'x',
      allowHosts: ['novac2c.cdn.weixin.qq.com'],
    }),
    /allowlist/,
  )
})

test('encryptMedia fixture helper round-trips through the real decryptor', () => {
  const plaintext = new TextEncoder().encode('fixture payload')
  const encrypted = encryptMedia(plaintext)
  const decrypted = aes128EcbDecrypt(encrypted, mediaKey())
  assert.equal(new TextDecoder().decode(decrypted), 'fixture payload')
})

test('gateway stays idle without credentials and starts with setCredentials', async () => {
  const idleCtx = new Context()
  await idleCtx.plugin(WechatGateway, { baseUrl: server.url, pollIdleDelayMs: 5 })
  const idleGateway = idleCtx.wechat
  await idleGateway.start()
  assert.equal(idleGateway.status, 'idle')
  idleGateway.setCredentials({ token: 't2', accountId: 'wxid_bot_fake' })
  await waitFor(() => idleGateway.status === 'connected', 3000)
  await idleGateway.stop()
})
