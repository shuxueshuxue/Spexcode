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
