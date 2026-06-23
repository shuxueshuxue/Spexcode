// @@@ evaluator tag - yatsu runs NOTHING; the AGENT measures the loss. The only thing yatsu records about
// WHO measured is an evaluator TAG `<name>@<version>` (e.g. `manual@1`) — pure metadata stamped on every
// reading. There is no executor here: no Driver interface, no `capture()`, no producer registry. That
// driver-as-executor seam is retired — a measuring hand (a human, a future computer-use "stupid user") is
// just another tag, never a code path yatsu calls.
//
// `version` is the EVALUATOR freshness axis: bump an evaluator's version and every reading carrying its old
// version reads stale (the measuring instrument changed, so re-measure). The core knows ONE evaluator,
// `manual`, today; a new one slots in by adding an entry here, never by registering executable code.

export const EVALUATORS: Record<string, number> = { manual: 1 }
export const DEFAULT_EVALUATOR = 'manual'

// the tag stamped on a reading. With no name → the default `manual`; an unknown name still tags (version 1)
// so an out-of-band evaluator can record without the core having to know it yet.
export function evaluatorTag(name: string = DEFAULT_EVALUATOR): string {
  return `${name}@${EVALUATORS[name] ?? 1}`
}

// parse a recorded evaluator tag back into name + version (for comparing against the current version).
export function parseEvaluator(tag: string): { name: string; version: number } {
  const at = tag.lastIndexOf('@')
  if (at < 0) return { name: tag, version: NaN }
  return { name: tag.slice(0, at), version: Number(tag.slice(at + 1)) }
}

// a reading's evaluator tag is stale iff its evaluator is KNOWN to the core and its version is behind the
// current one. An unknown evaluator invents no staleness — we can't version an instrument we don't define.
export function isEvaluatorStale(tag: string): boolean {
  const { name, version } = parseEvaluator(tag)
  const cur = EVALUATORS[name]
  if (cur === undefined) return false
  return version !== cur
}
