/**
 * wechat-conversation-node plugin: WeChat ⇄ DSH conversation bridge.
 *
 * Consumes the `wechat` gateway service, the `sessions` store, the `agents`
 * registry, and the `approval` seam. Inbound WeChat text becomes a user
 * message on the active session; session events become digest-style WeChat
 * messages (task started, heartbeat, assistant text chunked, finished/error).
 * Commands (`/sessions /use /new /stop /status /yes /no`) are handled
 * locally. The allowlist gate lives here — non-allowlisted senders are never
 * fed to the model.
 *
 * @module @dsh-cowork/chatnode-wechat/node
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_MESSAGE_CHARS } from '../gateway/types.ts'
import { WechatConversationNode, type NodeConfig } from './core.ts'

/** Plugin config. `allowFrom` is REQUIRED and validated at apply time. */
export interface Config {
  /** Hard allowlist of WeChat sender ids. REQUIRED — no permissive default. */
  allowFrom?: string[]
  /** Heartbeat interval for progress digests (seconds; 0 disables). */
  digestIntervalSec?: number
  /** Approval prompt timeout before default-deny (seconds). */
  approvalTimeoutSec?: number
  /** Max chars per WeChat bubble. */
  maxMessageChars?: number
  /** Throttle between outbound bubbles (ms). */
  sendChunkDelayMs?: number
  /** Working directory for `/new` sessions. */
  cwd?: string
  /** Agent preset name for `/new` sessions. */
  agentPreset?: string
  /** Provider route for `/new` agents. */
  agentProvider?: string
  /** Model id for `/new` agents. */
  agentModel?: string
}

export const Config = z.object({
  allowFrom: z.array(z.string()).default([]),
  digestIntervalSec: z.number().default(300),
  approvalTimeoutSec: z.number().default(600),
  maxMessageChars: z.number().default(MAX_MESSAGE_CHARS),
  sendChunkDelayMs: z.number().default(1_500),
  cwd: z.string(),
  agentPreset: z.string(),
  agentProvider: z.string(),
  agentModel: z.string(),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-chatnode-wechat'

/** Services required by the conversation node. */
export const inject = ['wechat', 'sessions', 'agents', 'approval']

/** Mount the conversation node on a context that already provides `wechat`. */
export function apply(ctx: Context, config: Config): void {
  const node = new WechatConversationNode(ctx, config as NodeConfig)
  ctx.effect(() => {
    return () => node.dispose()
  })
}

/** The conversation-node plugin object (mountable via `ctx.plugin`). */
export const wechatConversationNode = { name, inject, Config, apply }

export { WechatConversationNode, type NodeConfig } from './core.ts'
export { splitForWechat, digestLine, textOfAssistantMessage } from './outbound.ts'
export { extractText, isGroupMessage } from './inbound.ts'
export { listSessions } from './commands.ts'
