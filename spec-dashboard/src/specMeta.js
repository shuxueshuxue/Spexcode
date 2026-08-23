// the node vocabulary CONSTANTS, dependency-free — extracted from SpecNode.jsx so light surfaces
// (the mobile face, the session window/search rows) can speak the same colours/glyphs without
// importing the graph tile component, which drags @xyflow/react into their chunk.

// the four backend-DERIVED states (specs.ts deriveStatus): merged in-sync, active in-flight,
// drift = governed code ahead of spec, pending = no committed version. The dot takes the colour.
// One source for the nodes AND the Legend — they can never drift.
export const STATUS = {
  merged:  { color: '#859900' },
  active:  { color: '#cb4b16' },
  drift:   { color: '#b58900' },
  pending: { color: '#93a1a1' },
}

// the pending-op glyphs an overlay can stamp on a node. Exported alongside STATUS for the Legend.
export const GLYPH = { added: '+', edited: '~', deleted: '✕', moved: '→' }

// the board's reading order for the four states, worst-understood last.
export const STATUS_ORDER = ['merged', 'active', 'drift', 'pending']

// ONE pass over the full node list → per category, the node ids (board order) that belong to it. It lives
// beside STATUS rather than inside the graph's tally component for the same reason STATUS does: the
// numbers are the BOARD's, and the ambient status bar has to say them on every route, including the ones
// that never mount a graph. Importing them from the tally would have dragged @xyflow/react along.
//
// Most categories count ids.length and WALK those ids where a caller offers a walk. Two decouple the count
// from the ring: issues count the DEDUPED distinct open-issue total (a Set of numbers) while collecting the
// nodes carrying them; coverage counts SCENARIOS (scoreCount) while collecting the nodes that own them
// (scoreNodes — a node enters each state's ring once, however many of its scenarios sit there). `missing`
// (declared but never measured) folds into empty.
export function summarizeBoard(specs) {
  const status = { merged: [], active: [], drift: [], pending: [] }
  const driftIds = []
  const issueIds = []
  const issueNumbers = new Set()
  const scoreCount = { pass: 0, fail: 0, stalePass: 0, staleFail: 0, empty: 0 }     // scenarios per state (the shown number)
  const scoreNodes = { pass: [], fail: [], stalePass: [], staleFail: [], empty: [] } // nodes owning ≥1 such scenario (the walk ring)
  for (const n of specs) {
    if (status[n.status]) status[n.status].push(n.id)
    if (n.drift > 0) driftIds.push(n.id)                          // node whose code is ahead of spec
    const issueSummary = n.reviewSummary?.issues
    if (issueSummary?.open) {
      issueIds.push(n.id)
      for (const id of issueSummary.openIds || []) issueNumbers.add(id)
    }
    const evalSummary = n.reviewSummary?.evals
    if (evalSummary) {
      for (const bucket of Object.keys(scoreCount)) {
        const count = evalSummary[bucket] || 0
        scoreCount[bucket] += count
        if (count > 0) scoreNodes[bucket].push(n.id)
      }
    }
  }
  return { total: specs.length, status, driftIds, issueIds, issueCount: issueNumbers.size, scoreCount, scoreNodes }
}
// Keep both ends of long identities visible. Bias the fixed budget toward the suffix because sibling
// labels commonly share a long path-like prefix.
export function middleEllipsis(value, maxChars = 14) {
  const text = String(value ?? '')
  if (text.length <= maxChars) return text
  if (maxChars <= 1) return '…'.slice(0, maxChars)
  const available = maxChars - 1
  const head = Math.max(1, Math.floor(available / 2) - 1)
  const tail = available - head
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
