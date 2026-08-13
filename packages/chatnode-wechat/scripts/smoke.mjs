#!/usr/bin/env node
/**
 * Manual live-account smoke test for dsh-chatnode-wechat.
 *
 * Verifies against the REAL iLink gateway (no fake server):
 *   1. credentials are configured (WEIXIN_BOT_TOKEN / WEIXIN_ACCOUNT_ID),
 *   2. the gateway connects and polls,
 *   3. an inbound message from an allowlisted sender is echoed back,
 *   4. connection status / errors are printed as they happen.
 *
 * Usage (from packages/chatnode-wechat):
 *   WEIXIN_ALLOW_FROM=<your-wechat-id> pnpm smoke
 *
 * The allowlist sender id is the WeChat account id that messages the bot
 * from (find it in a hermes-agent/openclaw account file, or configure and
 * watch the first inbound sender id logged by the node).
 */

import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { WechatGateway } from '../lib/gateway/index.js'
import { wechatConversationNode } from '../lib/node/index.js'

const allowFrom = (process.env.WEIXIN_ALLOW_FROM ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (allowFrom.length === 0) {
  console.error('WEIXIN_ALLOW_FROM is required (comma-separated WeChat sender ids).')
  process.exit(1)
}

const ctx = new Context()
await ctx.plugin(SessionStore)
await ctx.plugin(AgentRegistry)
await ctx.plugin(ApprovalService)
await ctx.plugin(WechatGateway, {
  baseUrl: process.env.WEIXIN_BASE_URL?.trim() || undefined,
  pollIdleDelayMs: 0,
})
await ctx.plugin(wechatConversationNode, {
  allowFrom,
  digestIntervalSec: 60,
  approvalTimeoutSec: 300,
})

ctx.on('wechat/status', (status) => console.log(`[status] ${status}`))
ctx.on('wechat/error', (error) => console.log(`[error] ${error.message}`))
ctx.on('wechat/fatal', (error) => {
  console.error(`[fatal] ${error.message}`)
  process.exit(1)
})
ctx.on('wechat/message', (message) => {
  const sender = message.from_user_id
  const text = Array.isArray(message.item_list)
    ? message.item_list
        .filter((item) => item?.type === 1)
        .map((item) => item.text_item?.text ?? '')
        .join('')
    : ''
  console.log(`[inbound] from=${sender} text=${JSON.stringify(text)}`)
  if (text.trim()) {
    void ctx.wechat.sendText(String(sender), `✅ 收到: ${text.slice(0, 200)}`).then((result) => {
      console.log(`[echo] success=${result.success}${result.error ? ` error=${result.error}` : ''}`)
    })
  }
})

await ctx.wechat.start()
if (!ctx.wechat.configured) {
  console.error('Gateway not configured — run `pnpm login` first (or set WEIXIN_BOT_TOKEN/WEIXIN_ACCOUNT_ID).')
  process.exit(1)
}

console.log('Smoke test running. Send a WeChat message to the bot; Ctrl-C to stop.')
// keep the process alive; the poll loop and event handlers do the work
setInterval(() => {}, 1 << 30)
