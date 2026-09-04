// @@@ presentation only - the glyph/colour vocabulary and the terminal-cell arithmetic the board alignment
// depends on. Nothing here reads a record or a process ([[ls-cjk-width]] owns the cell rules).
import type { DisplayStatus, Session } from './sessions.js'
import { sessionTitle } from './sessions.js'

export const STATUS_GLYPH: Record<DisplayStatus, string> = {
  working: '\u25cf', idle: '\u25cb', offline: '\u23fb', starting: '\u25d4', review: '\u25c6', done: '\u2713',
  'close-pending': '\u2715', parked: '\u29d6', error: '\u2717', asking: '\u2370', queued: '\u25cc', unknown: '\u2047',
  corrupt: '\u26a0', retired: '\u2691',
}
const ANSI: Record<DisplayStatus, string> = {
  working: '33', idle: '90', offline: '90', starting: '36', review: '35', done: '34', 'close-pending': '31', parked: '36', error: '31', asking: '93', queued: '90', unknown: '93',
  corrupt: '31', retired: '90',
}

// @@@ display width - the table aligns by TERMINAL CELLS, not code units. CJK/fullwidth glyphs render
// two cells wide, so `slice`/`padEnd` (which count code units) shear a wide glyph mid-cut and under-pad
// the column, misaligning everything after it. A small wcwidth-style range check covers the wide blocks
// that actually reach session labels/prompts \u2014 no dependency needed.
const isWideCp = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||                   // Hangul Jamo
  (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||  // CJK radicals \u2026 kana \u2026 CJK ideographs \u2026 Yi
  (cp >= 0xac00 && cp <= 0xd7a3) ||                   // Hangul syllables
  (cp >= 0xf900 && cp <= 0xfaff) ||                   // CJK compatibility ideographs
  (cp >= 0xfe30 && cp <= 0xfe4f) ||                   // CJK compatibility forms
  (cp >= 0xff00 && cp <= 0xff60) ||                   // fullwidth forms
  (cp >= 0xffe0 && cp <= 0xffe6) ||                   // fullwidth signs
  (cp >= 0x1f300 && cp <= 0x1faff) ||                 // emoji
  (cp >= 0x20000 && cp <= 0x3fffd)                    // CJK extensions B+
export function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += isWideCp(ch.codePointAt(0)!) ? 2 : 1
  return w
}
// truncate to a display width (the ellipsis occupies its own cell); never cuts a wide glyph in half.
export function truncWidth(s: string, max: number): string {
  if (displayWidth(s) <= max) return s
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = isWideCp(ch.codePointAt(0)!) ? 2 : 1
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return out + '\u2026'
}
// pad to a display width \u2014 `padEnd` would count a double-cell glyph as one and under-pad the column.
export const padWidth = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - displayWidth(s)))
const trunc = truncWidth
// the board table's NOTE display cap \u2014 exported so the declaration echo (cli.ts) can tell an author
// exactly where their note gets cut, instead of the cap living as an anonymous magic number here.
export const NOTE_BOARD_LIMIT = 50
// short display label per status (only close-pending differs from the status name) \u2014 used by the legend.
const SHORT: Partial<Record<DisplayStatus, string>> = { 'close-pending': 'close' }

// @@@ statusLegend - one-line glyph\u2192meaning key, BUILT from STATUS_GLYPH so it can never drift from
// the glyphs the table actually prints. Shown under `spex session ls` so the symbols are self-explanatory.
export function statusLegend(color = true): string {
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  const parts = (Object.keys(STATUS_GLYPH) as DisplayStatus[]).map(
    (k) => `${c(ANSI[k], STATUS_GLYPH[k])} ${SHORT[k] || k}`,
  )
  return c('90', '  key: ') + parts.join('  ')
}

// human-friendly aligned table: header + (glyph + colour + status + title + id + parent + merges + note) rows +
// a status legend, so the table tells the whole story (incl. each agent's note) at a glance.
export type SessionTableScope = { kind: 'sessions' } | { kind: 'children'; parent: string }
function statusSummary(sessions: Session[]): string {
  const counts = new Map<DisplayStatus, number>()
  for (const session of sessions) counts.set(session.status, (counts.get(session.status) || 0) + 1)
  return (Object.keys(STATUS_GLYPH) as DisplayStatus[])
    .flatMap((status) => {
      const count = counts.get(status)
      return count ? [`${count} ${SHORT[status] || status}`] : []
    })
    .join(' · ')
}

export function formatTable(sessions: Session[], color = true, scope: SessionTableScope = { kind: 'sessions' }): string {
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  const label = scope.kind === 'children' ? `children of ${scope.parent.slice(0, 8)}` : 'sessions'
  const heading = c('1', `SpexCode ${label} (${sessions.length}${sessions.length ? `; ${statusSummary(sessions)}` : ''})`)
  if (!sessions.length) return [heading, c('90', `  no ${scope.kind === 'children' ? 'children' : 'living sessions'}`)].join('\n')
  const depthOf = (session: Session): number => {
    let depth = 0
    const ids = new Set(sessions.map((item) => item.id))
    const seen = new Set<string>()
    let parent = session.parent
    while (parent && ids.has(parent) && !seen.has(parent)) {
      seen.add(parent)
      depth++
      parent = sessions.find((item) => item.id === parent)?.parent ?? null
    }
    return depth
  }
  const header = c('90', `    ${'STATUS'.padEnd(13)} ${'TITLE'.padEnd(22)} ${'ID'.padEnd(8)} ${'PARENT'.padEnd(8)} ${'DEPTH'.padEnd(5)} ${'\u00d7'.padEnd(4)}${'PROMPT'.padEnd(42)}NOTE`)
  const rows = sessions.map((s) => {
    const g = STATUS_GLYPH[s.status] ?? '\u00b7'
    const code = ANSI[s.status] ?? '0'
    const title = padWidth(truncWidth(sessionTitle(s), 22), 22)
    const st = s.status.padEnd(13)
    const parent = c('90', (s.parent || '-').slice(0, 8).padEnd(8))
    const depth = String(depthOf(s)).padEnd(5)
    const merges = (s.merges ? `\u00d7${s.merges}` : '').padEnd(4)
    const prompt = c('90', padWidth(s.promptPreview ? trunc(s.promptPreview, 40) : '', 42))   // what it was asked to do
    const note = s.note ? c('90', trunc(s.note, NOTE_BOARD_LIMIT)) : ''
    return `  ${c(code, g)} ${c(code, st)} ${title} ${c('90', s.id.slice(0, 8))} ${parent} ${depth}${merges}${prompt}${note}`
  })
  return [heading, header, ...rows, statusLegend(color)].join('\n')
}
