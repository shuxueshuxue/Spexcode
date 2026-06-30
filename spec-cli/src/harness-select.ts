import { HARNESSES, type Harness, type HarnessId } from './harness.js'

// @@@ harness-select - the DECLARATIVE choice of WHICH harness targets `spex materialize` delivers the
// SpexCode system into. The selection is persistent config (spexcode.json's `harnesses`), NOT a one-shot
// flag, because materialize is driven by a content-hash gate (re-run on every .config edit), so the intent
// must live where every re-materialize can read it. This module owns ONLY the vocabulary + validation; the
// per-harness write/clean mechanics live on the [[harness-adapter]], the render loop on [[harness-delivery]].

// a resolved DELIVERY TARGET. Either a NATIVE harness (claude/codex — its adapter writes shims/contract/trust
// directly), or a PLUGIN bundle dropped into a host-agent-scanned folder. The plugin EMITTER is a later node;
// here a plugin target is only validated, it produces no artifact yet.
export type HarnessTarget =
  | { kind: 'native'; id: HarnessId }
  | { kind: 'plugin'; folder: string }

// the zero-config default: deliver to EVERY native harness, no plugin.
export const DEFAULT_HARNESS_IDS: readonly HarnessId[] = HARNESSES.map((h) => h.id)
const KNOWN: readonly string[] = HARNESSES.map((h) => h.id)

// parse + validate the spexcode.json `harnesses` field into resolved targets. FAIL LOUD on an illegal set —
// materialize and init both gate on this so a bad config never silently delivers the wrong thing. `raw` is the
// JSON value as written; undefined/null → the default native set.
export function resolveHarnessTargets(raw: unknown): HarnessTarget[] {
  if (raw === undefined || raw === null) return DEFAULT_HARNESS_IDS.map((id) => ({ kind: 'native', id }))
  if (!Array.isArray(raw))
    throw new Error(`spexcode.json "harnesses" must be an ARRAY of targets (got ${typeof raw}). Members are native ids (${KNOWN.join(', ')}) or {"plugin":"<folder>"}; omit the field to default to [${DEFAULT_HARNESS_IDS.join(', ')}].`)
  if (raw.length === 0)
    throw new Error(`spexcode.json "harnesses" is EMPTY — list at least one target, or remove the field to default to [${DEFAULT_HARNESS_IDS.join(', ')}].`)
  const targets: HarnessTarget[] = []
  for (const m of raw) {
    if (typeof m === 'string') {
      if (m === 'plugin')
        throw new Error(`spexcode.json "harnesses": a plugin target needs an EXPLICIT landing folder — write {"plugin":"<folder>"} (e.g. {"plugin":".zcode"}), not the bare string "plugin", because each host agent scans a different plugins dir.`)
      if (!KNOWN.includes(m))
        throw new Error(`spexcode.json "harnesses": unknown harness id "${m}" — known native ids are ${KNOWN.join(', ')}, or use {"plugin":"<folder>"}.`)
      targets.push({ kind: 'native', id: m as HarnessId })
    } else if (m && typeof m === 'object' && !Array.isArray(m) && 'plugin' in m) {
      const folder = (m as { plugin?: unknown }).plugin
      if (typeof folder !== 'string' || !folder.trim())
        throw new Error(`spexcode.json "harnesses": a {"plugin":…} target needs a NON-EMPTY folder string (e.g. {"plugin":".zcode"}) — each host agent scans a different plugins dir, so the folder must be explicit.`)
      targets.push({ kind: 'plugin', folder: folder.trim() })
    } else {
      throw new Error(`spexcode.json "harnesses": each member must be a native id string (${KNOWN.join(', ')}) or a {"plugin":"<folder>"} object — got ${JSON.stringify(m)}.`)
    }
  }
  // PLUGIN EXCLUSIVITY: a plugin bundle is a SUPERSET delivery to its host agent, so pairing it with any
  // native harness double-delivers. So a set with a plugin may carry NO native harness.
  const natives = targets.filter((t): t is { kind: 'native'; id: HarnessId } => t.kind === 'native')
  if (targets.some((t) => t.kind === 'plugin') && natives.length)
    throw new Error(`spexcode.json "harnesses": a plugin target is EXCLUSIVE — it cannot coexist with native harnesses (${natives.map((t) => t.id).join(', ')}). A plugin bundle already delivers the whole system to its host agent, so pairing it with a native harness double-delivers. Choose EITHER native harnesses OR plugin target(s).`)
  return targets
}

// split the live HARNESSES adapters by whether the resolved targets SELECT them: selected get write()n,
// unselected get clean()ed (pruned). `plugins` carries the plugin targets (no emitter yet — a later node).
export function partitionHarnesses(targets: HarnessTarget[]): { selected: Harness[]; unselected: Harness[]; plugins: { folder: string }[] } {
  const selectedIds = new Set(targets.filter((t) => t.kind === 'native').map((t) => (t as { id: HarnessId }).id))
  return {
    selected: HARNESSES.filter((h) => selectedIds.has(h.id)),
    unselected: HARNESSES.filter((h) => !selectedIds.has(h.id)),
    plugins: targets.filter((t) => t.kind === 'plugin').map((t) => ({ folder: (t as { folder: string }).folder })),
  }
}
