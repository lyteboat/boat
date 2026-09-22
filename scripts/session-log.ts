/**
 * Read dsh session logs (`session.v3.jsonl`, plain or Zstandard) outside the
 * running harness: smoke tests, the M1 driver-equivalence diff, and later the
 * evaluation replay all decode logs through this one module.
 *
 * `scanZstdFrames` is adapted from deepseek-ai/deepseek-harness
 * packages/session/session-persistence-jsonl/src/zstd.ts @ dsh-v0.1.5-alpha.2
 * (b2e3b2a0), MIT — see THIRD_PARTY_NOTICES.md. The jsonl backend writes one
 * Zstandard frame per flushed batch; Node's `zstdDecompressSync` stops after
 * the first frame, so frames must be located structurally and decoded one by one.
 * @module scripts/session-log
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528

/** Byte range occupied by one structurally complete Zstandard frame. */
export interface ZstdFrameRange {
  start: number
  end: number
}

/** Structural scan result for a concatenated Zstandard stream. */
export interface ZstdFrameScan {
  frames: ZstdFrameRange[]
  /** Start of an incomplete final frame, when EOF interrupts one. */
  tornStart?: number
}

/**
 * Locate complete frames without decompressing their blocks.
 * @param buffer - complete bytes of the session artifact.
 * @returns complete frame ranges and an optional incomplete-final-frame start.
 */
export function scanZstdFrames(buffer: Buffer): ZstdFrameScan {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** One parsed line of a session log: the header record or an event envelope. */
export type SessionLogRecord = Record<string, unknown>

/**
 * Decode a session artifact's bytes into parsed JSON records.
 * @param bytes - file contents.
 * @param compressed - whether the artifact is the `.zstd` container.
 * @returns records in file order.
 */
export function decodeSessionLog(bytes: Buffer, compressed: boolean): SessionLogRecord[] {
  let text: string
  if (compressed) {
    const { frames, tornStart } = scanZstdFrames(bytes)
    if (tornStart !== undefined) throw new Error(`session log ends inside a Zstandard frame at byte ${tornStart}`)
    text = frames.map(({ start, end }) => zstdDecompressSync(bytes.subarray(start, end)).toString('utf8')).join('')
  } else {
    text = bytes.toString('utf8')
  }
  return text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as SessionLogRecord)
}

/**
 * Read one session artifact by path.
 * @param path - a `session.v3.jsonl` or `session.v3.jsonl.zstd` file.
 * @returns records in file order.
 */
export function readSessionLog(path: string): SessionLogRecord[] {
  return decodeSessionLog(readFileSync(path), path.endsWith('.zstd'))
}

/**
 * Find every session artifact below a harness home's `sessions` directory.
 * @param home - the harness home (`$BOAT_HOME`).
 * @returns absolute artifact paths, sorted.
 */
export function findSessionLogs(home: string): string[] {
  const root = join(home, 'sessions')
  let entries: string[]
  try {
    entries = readdirSync(root, { recursive: true, encoding: 'utf8' })
  } catch {
    return []
  }
  return entries
    .filter(entry => /session\.v3\.jsonl(?:\.zstd)?$/u.test(entry))
    .map(entry => join(root, entry))
    .sort()
}

/** The `type` of every record after the header, in order. */
export function eventTypes(records: readonly SessionLogRecord[]): string[] {
  return records.slice(1).map(record => String(record['type']))
}
