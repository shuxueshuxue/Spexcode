import { cycleNext } from './cycle.js'

// [[graph-stats]] keeps the graph-specific part of the retired tally: category clicks walk the same
// node rings, in board order, and wrap. The shell owns the one visible ledger ([[status-bar]]); this
// helper lets it add the graph walk without importing graph rendering or minting a second status item.
export const nextGraphStatNode = (ids, focusId) => cycleNext(ids, focusId)

// GraphView still mounts this boundary as part of its stable document shape. It contributes no DOM and,
// crucially, registers no status item: a hidden keep-mounted graph must be unable to leave chrome behind.
export default function GraphStats() {
  return null
}
