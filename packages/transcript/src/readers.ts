import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TranscriptReadError, type TranscriptRead, type TranscriptReader } from './turns.js'
import { IntervalCollector, claudeEvent, codexEvent, geminiEvent, hermesEvents, openclawEvent, opencodeEvents, piEvent, type Parse, type ParsedEvent } from './parsers.js'

// THE NATIVE-THREAD READERS. Each harness keeps its conversation somewhere private — Claude's project JSONL,
// Codex's rollout, pi's session JSONL, OpenCode's store behind `opencode export` — and this module is the only
// place that knows where. It answers exactly one question for every harness: "what happened in this thread
// between `from` and `to`?", as normalized turns, through the three reader verbs of [[transcript]].

const POST_RANGE_LOOKAHEAD_LINES = 256

const children = (dir: string): string[] => { try { return readdirSync(dir).sort().reverse() } catch { return [] } }

// --- where each harness keeps the thread ------------------------------------------------------------------

const projectTranscriptRoot = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
export function claudeTranscriptPath(threadId: string, root = projectTranscriptRoot()): string | null {
  for (const project of children(root)) {
    const path = join(root, project, `${threadId}.jsonl`)
    try { if (statSync(path).isFile()) return path } catch { /* try next */ }
  }
  return null
}

const codexSessionsDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
// Walk newest day first and return on the first hit; the walk is exhaustive rather than capped, because
// future-dated junk under sessions/ sorts above every real day and a cap once masked every real rollout.
export function codexRolloutPath(threadId: string, root = codexSessionsDir()): string | null {
  for (const year of children(root)) for (const month of children(join(root, year))) for (const day of children(join(root, year, month))) {
    const dir = join(root, year, month, day)
    const file = children(dir).find((name) => name.includes(threadId))
    if (file) return join(dir, file)
  }
  return null
}

const piSessionsRoot = () => join(process.env.SPEXCODE_PI_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions')
const piSessionPaths = new Map<string, string>()
export function piSessionPath(threadId: string, root = piSessionsRoot()): string | null {
  const key = `${root}:${threadId}`
  const cached = piSessionPaths.get(key)
  if (cached) {
    try { if (statSync(cached).isFile()) return cached } catch { piSessionPaths.delete(key) }
  }
  for (const directory of children(root)) for (const file of children(join(root, directory))) {
    if (!file.endsWith('.jsonl')) continue
    const path = join(root, directory, file)
    try {
      const header: unknown = JSON.parse(readFileSync(path, 'utf8').split('\n', 1)[0])
      if (header && typeof header === 'object' && (header as Record<string, unknown>).type === 'session' && (header as Record<string, unknown>).id === threadId) {
        piSessionPaths.set(key, path)
        return path
      }
    } catch { /* unreadable entries are not a match */ }
  }
  return null
}

const findJsonl = (root: string, threadId: string, maxDepth = 5): string | null => {
  const walk = (dir: string, depth: number): string | null => {
    if (depth > maxDepth) return null
    for (const name of children(dir)) {
      const path = join(dir, name)
      try {
        if (statSync(path).isFile() && name.endsWith('.jsonl')) {
          if (name.includes(threadId)) return path
          const header = JSON.parse(readFileSync(path, 'utf8').split('\n', 1)[0]) as Record<string, unknown>
          if (header.sessionId === threadId || header.id === threadId) return path
        } else if (statSync(path).isDirectory()) {
          const found = walk(path, depth + 1)
          if (found) return found
        }
      } catch { /* skip entries that disappear or are not JSON */ }
    }
    return null
  }
  return walk(root, 0)
}

const geminiRoot = () => process.env.GEMINI_HOME || process.env.GEMINI_CONFIG_DIR || join(homedir(), '.gemini')
export function geminiTranscriptPath(threadId: string, root = geminiRoot()): string | null { return findJsonl(root, threadId) }

const openclawRoot = () => process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw', 'state')
export function openclawTranscriptPath(threadId: string, root = openclawRoot()): string | null { return findJsonl(root, threadId) }

const opencodeStoreRoot = () => process.env.SPEXCODE_OPENCODE_DATA_DIR
  || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode')
function opencodeStoreRevision(root: string): string | null {
  try {
    const database = statSync(join(root, 'opencode.db'))
    let writeAheadLog = '0:0'
    try {
      const stat = statSync(join(root, 'opencode.db-wal'))
      writeAheadLog = `${stat.size}:${Math.floor(stat.mtimeMs)}`
    } catch { /* a checkpointed database has no separate write-ahead log */ }
    return `${database.size}:${Math.floor(database.mtimeMs)}:${writeAheadLog}`
  } catch { return null }
}
// The export is read RAW: `--sanitize` replaces every prose and tool-output part with a `[redacted:…]` token,
// which made the whole conversation unreadable; the reader hands over the same local bytes the other harnesses'
// files hold, and nothing here leaves the machine that ran the thread.
function opencodeExport(threadId: string): string {
  return execFileSync(process.env.SPEXCODE_OPENCODE_CMD || 'opencode', ['export', threadId], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  })
}


const fileRevision = (path: string): string | null => {
  try { const stat = statSync(path); return `${stat.size}:${Math.floor(stat.mtimeMs)}` } catch { return null }
}

// @@@interval-seek - a native file is append-only, so the byte where an interval's first event sits never
// moves. The open tail re-reads its interval on every change; remembering that offset per (file, from) turns
// each re-read into "parse the current stretch" instead of "parse the whole thread again".
const intervalOffsets = new Map<string, number>()

// Where a scan of the file stands: the next byte to read, and the bytes of a line that had no newline yet —
// a trailing line without its newline is still being written by the harness and joins the next scan.
type LineScan = Readonly<{ position: number; carry: Buffer }>

// One pass over the bytes from `scan.position` to the end of the file. Every complete line is parsed as JSON
// and handed to `onLine` with its byte offset; `onLine` returning true stops the scan early (a bounded
// lookahead), which abandons the rest — only a one-shot read does that.
function scanLines(harness: string, fd: number, scan: LineScan, onLine: (value: unknown, offset: number) => boolean): LineScan {
  const chunk = Buffer.allocUnsafe(64 * 1024)
  let { position, carry } = scan
  let lineStart = position - carry.length
  while (true) {
    const read = readSync(fd, chunk, 0, chunk.length, position)
    if (read <= 0) break
    position += read
    const buffer = carry.length ? Buffer.concat([carry, chunk.subarray(0, read)]) : Buffer.from(chunk.subarray(0, read))
    let cut = 0
    for (let index = 0; index < buffer.length; index++) {
      if (buffer[index] !== 10) continue
      const line = buffer.subarray(cut, index).toString('utf8')
      const lineOffset = lineStart
      lineStart += index - cut + 1
      cut = index + 1
      if (!line.trim()) continue
      let value: unknown
      try { value = JSON.parse(line) } catch (error) { throw new TranscriptReadError('invalid', `${harness} transcript cannot be parsed: ${error instanceof Error ? error.message : String(error)}`) }
      if (onLine(value, lineOffset)) return { position, carry: Buffer.alloc(0) }
    }
    carry = Buffer.from(buffer.subarray(cut))
  }
  return { position, carry }
}

// The cursor over one interval of one line file. A one-shot `read` is a cursor advanced once and dropped; the
// open interval's `tail` keeps it, so each advance parses only what the harness appended since the last one.
class LineFileCursor {
  private collector: IntervalCollector
  private scan: LineScan = { position: 0, carry: Buffer.alloc(0) }
  private started = false
  private readonly seekKey: string
  constructor(private readonly harness: string, private readonly path: string, private readonly parse: Parse, private readonly from: number) {
    this.seekKey = `${path}\n${from}`
    this.collector = new IntervalCollector({ from, to: from })
  }

  private restart(size: number): void {
    const seek = intervalOffsets.get(this.seekKey) ?? 0
    const start = seek > 0 && seek < size ? seek : 0
    this.collector = new IntervalCollector({ from: this.from, to: this.from })
    // a seek lands on the interval's first event, so the timestamps before it are known to exist
    if (start > 0) this.collector.sawTimestamp = true
    this.scan = { position: start, carry: Buffer.alloc(0) }
  }

  advance(to: number, lookahead = Number.POSITIVE_INFINITY): TranscriptRead {
    let size = 0
    try { size = statSync(this.path).size } catch (error) { throw new TranscriptReadError('unreadable', `${this.harness} transcript is unreadable: ${error instanceof Error ? error.message : String(error)}`) }
    if (size <= 0) throw new TranscriptReadError('unreadable', `${this.harness} transcript is unreadable: file is empty`)
    // a source that shrank was rewritten underneath the cursor: forget the position and read the interval afresh
    if (!this.started || size < this.scan.position) { this.restart(size); this.started = true }
    this.collector.extend(to)
    let fd: number | null = null
    try {
      fd = openSync(this.path, 'r')
      let postRangeLines = 0
      this.scan = scanLines(this.harness, fd, this.scan, (value, offset) => {
        const event = this.parse(value)
        if (!event) return false
        const inRange = event.at !== null && event.at >= this.from && event.at <= to
        if (inRange && !intervalOffsets.has(this.seekKey)) intervalOffsets.set(this.seekKey, offset)
        const pastRange = this.collector.add(event)
        return pastRange && ++postRangeLines >= lookahead
      })
    } catch (error) {
      if (error instanceof TranscriptReadError) throw error
      throw new TranscriptReadError('unreadable', `${this.harness} transcript could not be read: ${error instanceof Error ? error.message : String(error)}`)
    } finally { if (fd !== null) closeSync(fd) }
    return this.collector.finish(fileRevision(this.path) ?? `${size}`, this.harness)
  }
}

function lineFileReader(harness: string, locate: (threadId: string) => string | null, parse: Parse): TranscriptReader {
  const find = (threadId: string): string => {
    const path = locate(threadId)
    if (!path) throw new TranscriptReadError('missing', `${harness} transcript for ${threadId} is unavailable: file was not found`)
    return path
  }
  return {
    revision: (threadId) => { const path = locate(threadId); return path ? fileRevision(path) : null },
    // after passing `to`, a one-shot read scans a fixed lookahead window for timestamp disorder before stopping
    read: async (threadId, range) => new LineFileCursor(harness, find(threadId), parse, range.from).advance(range.to, POST_RANGE_LOOKAHEAD_LINES),
    tail: (threadId, from) => {
      let cursor: LineFileCursor | null = null
      return {
        // the file is located on the first advance, so a tail opened before the thread exists fails as `missing`
        // there rather than at construction
        advance: async (to) => (cursor ??= new LineFileCursor(harness, find(threadId), parse, from)).advance(to),
        close: () => { cursor = null },
      }
    },
  }
}

export const claudeTranscript: TranscriptReader = lineFileReader('claude', (threadId) => claudeTranscriptPath(threadId), claudeEvent)
export const codexTranscript: TranscriptReader = lineFileReader('codex', (threadId) => codexRolloutPath(threadId), codexEvent)
export const piTranscript: TranscriptReader = lineFileReader('pi', (threadId) => piSessionPath(threadId), piEvent)
export const geminiTranscript: TranscriptReader = lineFileReader('gemini', (threadId) => geminiTranscriptPath(threadId), geminiEvent)
export const openclawTranscript: TranscriptReader = lineFileReader('openclaw', (threadId) => openclawTranscriptPath(threadId), openclawEvent)

// OpenCode has no per-thread file: the store's revision is the change token, and one export per
// revision is parsed and kept, so repeated interval reads of a quiet thread cost nothing new.
const opencodeExports = new Map<string, { revision: string; events: ParsedEvent[] }>()
export function opencodeTranscriptReader(root = opencodeStoreRoot(), load: (threadId: string) => string = opencodeExport): TranscriptReader {
  const reader: Pick<TranscriptReader, 'revision' | 'read'> = {
    revision: () => opencodeStoreRevision(root),
    read: async (threadId, range) => {
      const revision = opencodeStoreRevision(root)
      if (!revision) throw new TranscriptReadError('missing', `opencode transcript for ${threadId} is unavailable: store was not found`)
      const key = `${root}:${threadId}`
      let cached = opencodeExports.get(key)
      if (!cached || cached.revision !== revision) {
        let exported: string
        try { exported = load(threadId) } catch (error) { throw new TranscriptReadError('unreadable', `opencode transcript could not be exported: ${error instanceof Error ? error.message : String(error)}`) }
        let value: unknown
        try { value = JSON.parse(exported) } catch (error) { throw new TranscriptReadError('invalid', `opencode transcript cannot be parsed: ${error instanceof Error ? error.message : String(error)}`) }
        cached = { revision, events: opencodeEvents(value) }
        opencodeExports.set(key, cached)
      }
      const collector = new IntervalCollector(range)
      for (const event of cached.events) collector.add(event)
      return collector.finish(revision, 'opencode')
    },
  }
  return {
    ...reader,
    // no file grows here: an open interval is re-collected from the cached export, which is one export per revision
    tail: (threadId, from) => ({ advance: (to) => reader.read(threadId, { from, to }), close: () => {} }),
  }
}
export const opencodeTranscript: TranscriptReader = opencodeTranscriptReader()

const hermesRoot = () => process.env.HERMES_HOME || join(homedir(), '.hermes', 'profiles', 'default')
function hermesRevision(root: string): string | null {
  try { const stat = statSync(join(root, 'state.db')); return `${stat.size}:${Math.floor(stat.mtimeMs)}` } catch { return null }
}
function hermesExport(threadId: string): string {
  return execFileSync(process.env.SPEXCODE_HERMES_CMD || 'hermes', ['sessions', 'export', '--format', 'jsonl', '--session-id', threadId, '--yes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}
const hermesExports = new Map<string, { revision: string; events: ParsedEvent[] }>()
export function hermesTranscriptReader(root = hermesRoot(), load: (threadId: string) => string = hermesExport): TranscriptReader {
  const read = async (threadId: string, range: { from: number; to: number }): Promise<TranscriptRead> => {
    const revision = hermesRevision(root)
    if (!revision) throw new TranscriptReadError('missing', `hermes transcript for ${threadId} is unavailable: state.db was not found`)
    const key = `${root}:${threadId}`
    let cached = hermesExports.get(key)
    if (!cached || cached.revision !== revision) {
      let exported: string
      try { exported = load(threadId) } catch (error) { throw new TranscriptReadError('unreadable', `hermes transcript could not be exported: ${error instanceof Error ? error.message : String(error)}`) }
      let value: unknown
      try { value = JSON.parse(exported) } catch (error) { throw new TranscriptReadError('invalid', `hermes transcript cannot be parsed: ${error instanceof Error ? error.message : String(error)}`) }
      cached = { revision, events: hermesEvents(value) }
      hermesExports.set(key, cached)
    }
    const collector = new IntervalCollector(range)
    for (const event of cached.events) collector.add(event)
    return collector.finish(revision, 'hermes')
  }
  return { revision: () => hermesRevision(root), read, tail: (threadId, from) => ({ advance: (to) => read(threadId, { from, to }), close: () => {} }) }
}
export const hermesTranscript: TranscriptReader = hermesTranscriptReader()

export function unsupportedTranscript(harness: string): TranscriptReader {
  const refuse = async (): Promise<never> => { throw new TranscriptReadError('unsupported', `${harness} does not support transcript access`) }
  return {
    revision: () => null,
    read: refuse,
    tail: () => ({ advance: refuse, close: () => {} }),
  }
}
