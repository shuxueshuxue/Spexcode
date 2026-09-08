// @@@ folding two speakers into one document ([[dispatcher-runtime]]) - the dispatcher runs every handler
// bound to an event and passes their stdout to the harness. While exactly ONE handler per event emitted JSON
// that was fine: raw concatenation of "" and one object is that object. But the plugin system exists to let
// someone bind a SECOND handler to the same event, and the moment two of them speak JSON the harness receives
// `{...}{...}` — not a document with a losing field, an unparseable one, so BOTH decisions are lost at once.
// The fold lives here rather than in the shell because deciding which of two `decision` fields wins is a
// semantic question about the harness contract, and shell cannot read a JSON object without inventing a
// parser. The dispatcher calls this only when it actually holds two JSON outputs, so the common path keeps
// costing nothing.
type Json = Record<string, unknown>

// The keys whose collision has a defined answer. Everything else is unknown vocabulary: a plugin may emit it,
// so it is carried, but two DIFFERENT values for one unknown key is a real ambiguity and is reported rather
// than silently resolved.
const strongest = <T extends string>(order: readonly T[], a: unknown, b: unknown): T | undefined => {
  const rank = (v: unknown) => (typeof v === 'string' ? order.indexOf(v as T) : -1)
  const [ra, rb] = [rank(a), rank(b)]
  if (ra < 0 && rb < 0) return undefined
  return (ra > rb ? a : b) as T
}
const joinText = (a: unknown, b: unknown): string | undefined => {
  const parts = [a, b].filter((v): v is string => typeof v === 'string' && v.length > 0)
  return parts.length ? parts.join('\n\n') : undefined
}

function foldHookSpecific(a: unknown, b: unknown, warn: (m: string) => void): Json | undefined {
  if (!isObject(a)) return isObject(b) ? b : undefined
  if (!isObject(b)) return a
  const out: Json = { ...a }
  for (const [key, value] of Object.entries(b)) {
    if (key === 'additionalContext') { out[key] = joinText(a[key], value); continue }
    if (key === 'permissionDecision') { out[key] = strongest(['allow', 'ask', 'deny'] as const, a[key], value); continue }
    if (key === 'permissionDecisionReason') { out[key] = joinText(a[key], value); continue }
    if (key === 'hookEventName') { out[key] = a[key] ?? value; continue }
    out[key] = pickUnknown(key, a[key], value, warn)
  }
  return out
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

// An unknown key we have no merge rule for. Same value → no conflict. Different values → the first handler's
// value is kept and the collision is NAMED, because quietly choosing one is how a handler ends up silently
// disarmed by a neighbour it never knew about.
function pickUnknown(key: string, a: unknown, b: unknown, warn: (m: string) => void): unknown {
  if (a === undefined) return b
  if (b === undefined) return a
  if (JSON.stringify(a) === JSON.stringify(b)) return a
  warn(`dispatch: two handlers set '${key}' differently (${JSON.stringify(a)} vs ${JSON.stringify(b)}); keeping the first`)
  return a
}

function foldPair(a: Json, b: Json, warn: (m: string) => void): Json {
  const out: Json = { ...a }
  for (const [key, value] of Object.entries(b)) {
    switch (key) {
      // a block from ANY handler blocks: the dispatcher already treats one blocking handler as decisive, so
      // the folded document must not be able to downgrade it.
      case 'decision': out[key] = strongest(['approve', 'block'] as const, a[key], value); break
      case 'reason': out[key] = joinText(a[key], value); break
      case 'systemMessage': out[key] = joinText(a[key], value); break
      case 'stopReason': out[key] = joinText(a[key], value); break
      // `continue: false` is a halt. False is sticky in both directions.
      case 'continue': out[key] = (a[key] === false || value === false) ? false : (a[key] ?? value); break
      case 'suppressOutput': out[key] = (a[key] === true || value === true) ? true : (a[key] ?? value); break
      case 'hookSpecificOutput': out[key] = foldHookSpecific(a[key], value, warn); break
      default: out[key] = pickUnknown(key, a[key], value, warn)
    }
  }
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key]
  return out
}

export type HookMerge = { stdout: string; warnings: string[] }

// Fold an ordered list of handler stdouts into ONE payload. Non-JSON stdout is passthrough text and keeps its
// position relative to the other text; the JSON objects fold into a single document emitted last, so a harness
// that parses the whole stream still sees exactly one object.
export function mergeHookOutputs(outputs: string[]): HookMerge {
  const warnings: string[] = []
  const warn = (m: string) => { warnings.push(m) }
  const texts: string[] = []
  const objects: Json[] = []
  for (const raw of outputs) {
    if (!raw.trim()) continue
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { texts.push(raw); continue }
    if (isObject(parsed)) objects.push(parsed)
    else texts.push(raw)
  }
  const folded = objects.length ? objects.reduce((a, b) => foldPair(a, b, warn)) : null
  const stdout = [...texts, ...(folded ? [JSON.stringify(folded)] : [])].join('')
  return { stdout, warnings }
}
