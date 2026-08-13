/**
 * Shared helpers for the Cowork tools: session-cwd resolution (mirrors
 * dsh-tool-fs), read-target resolution, and read-only sandbox gating.
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Minimal structural view of the sandbox policy service (may be absent). */
export interface SandboxPolicyLike {
  resolve(opts?: { session?: unknown }): { mode: string; workspaceRoot?: string } | undefined
}

/**
 * The calling agent's session cwd, or undefined for non-agent callers (the
 * backend then applies its own default).
 */
export function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  void requestedPath
  return exec.agent?.session.header.cwd
}

/** Resolution options shared by the Cowork tools. */
export function sessionResolveOptions(
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}

/** Resolve + stat a regular file, emitting the absence observation. */
export async function resolveRegularReadTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: FsTarget; info: FsInfo }> {
  const target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath))
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}

/**
 * The effective sandbox mode for this call: the per-session policy when one is
 * mounted, else the backend's default. `undefined` means no sandboxing.
 */
export function effectiveSandboxMode(ctx: Context, exec: ToolExecution): string | undefined {
  const policy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  const resolved = policy?.resolve(exec.agent ? { session: exec.agent.session } : undefined)
  return resolved?.mode ?? ctx.fs.sandboxMode
}

/**
 * Gate a mutating tool: in `read-only` mode every write is denied with the
 * shared `[sandbox: …]` marker so the model reads it like a bash denial.
 * Returns a marker string when the call must be refused, else undefined.
 */
export function readOnlyDenial(ctx: Context, exec: ToolExecution): string | undefined {
  if (effectiveSandboxMode(ctx, exec) === 'read-only') {
    return '[sandbox: write denied] doc_write is blocked in read-only sandbox mode; doc_read remains available.'
  }
  return undefined
}

/** The canonical OOXML/document error message prefix for model-facing text. */
export function fsErrorText(error: unknown): string {
  if (error instanceof FsError) return error.message
  return error instanceof Error ? error.message : String(error)
}
