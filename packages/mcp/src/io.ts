/**
 * Atomic byte write + content hash shared by the MCP server.
 */

import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Temp file + atomic rename; never leaves a partial target. */
export function atomicWrite(target: string, data: Uint8Array): void {
  const tmp = join(dirname(target), `.dsh-cowork-${process.pid}-${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, data, { flag: 'wx', mode: 0o644 })
    renameSync(tmp, target)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // noop
    }
    throw error
  }
}
