#!/usr/bin/env node
/**
 * CLI-driven QR login for dsh-chatnode-wechat.
 *
 * Runs the iLink QR flow against the real gateway and persists the resulting
 * credentials through the dsh credentials service (`$DSH_HOME/.credentials.yaml`
 * via dsh-credentials-local) — the same refs the bundle resolves at boot:
 * WEIXIN_ACCOUNT_ID / WEIXIN_BOT_TOKEN / WEIXIN_BASE_URL.
 *
 * Usage:  pnpm login        (from packages/chatnode-wechat)
 *         node scripts/login.mjs
 *
 * Requires a build first (`pnpm build`) since it imports `lib/`.
 */

import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WechatGateway } from '../lib/gateway/index.js'

const baseUrl = process.env.WEIXIN_BASE_URL?.trim() || undefined

const ctx = new Context()
await ctx.plugin(LocalCredentialProvider, { watch: false })
await ctx.plugin(WechatGateway, {
  ...(baseUrl ? { baseUrl } : {}),
  qrPollIntervalMs: 1500,
})

console.log('\n==============================================')
console.log(' dsh-chatnode-wechat — iLink 微信登录')
console.log('==============================================')
console.log('\n请在微信中扫描以下二维码并确认登录：\n')

const result = await ctx.wechat.loginQr({
  onQr: (qr) => {
    console.log(`二维码链接: ${qr.scanData}`)
    console.log('（若终端不支持渲染二维码，请直接打开上面的链接扫描）\n')
  },
  onStatus: (status) => {
    if (status === 'scaned') console.log('已扫码，请在微信里确认…')
    if (status === 'expired') console.log('二维码已过期，正在刷新…')
  },
})

if (!result.success || !result.credentials) {
  console.error('\n❌ 登录失败或超时，请重试。')
  await ctx.wechat.stop()
  process.exit(1)
}

const { accountId, token, baseUrl: confirmedBaseUrl, userId } = result.credentials

await ctx.credentials.set(credentialRef('WEIXIN_ACCOUNT_ID'), accountId)
await ctx.credentials.set(credentialRef('WEIXIN_BOT_TOKEN'), token)
await ctx.credentials.set(credentialRef('WEIXIN_BASE_URL'), confirmedBaseUrl)

console.log(`\n✅ 登录成功！account_id=${accountId}${userId ? ` user_id=${userId}` : ''}`)
console.log('凭据已保存到 DSH credentials：WEIXIN_ACCOUNT_ID / WEIXIN_BOT_TOKEN / WEIXIN_BASE_URL')
console.log('重启 dsh（或重载 profile）后，dsh-chatnode-wechat 将自动开始轮询。')

await ctx.wechat.stop()
process.exit(0)
