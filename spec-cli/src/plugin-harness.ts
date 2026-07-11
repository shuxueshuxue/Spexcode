import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// @@@ plugin-harness - the PLUGIN BUNDLE emitter: materialize the whole SpexCode system into ONE self-contained
// Claude-plugin bundle dropped into the host-agent-scanned folder [[harness-select]] resolved (e.g. `.zcode` /
// `.claude` → <folder>/plugins/spexcode/). It is the plugin-target counterpart of the native per-harness
// write [[harness-adapter]] does — chosen INSTEAD of the natives (plugin exclusivity), so [[harness-delivery]]'s
// materialize prunes every native first, then emits this. The bundle follows the de-facto Claude-plugin schema
// (a `.claude-plugin/plugin.json` pointing at hooks/skills/commands/agents); the host's discovery order is
// `.zcode-plugin > .claude-plugin > .codex-plugin` and z-code/Claude both read a `.claude-plugin` directly, so
// the ONE `.claude-plugin` bundle reaches ZCode, Claude, and (future) Codex from a single emit.
//
// The contract is NOT delivered by an always-on CLAUDE.md block here (the bundle never touches the repo's own
// files) — it maps to a SessionStart hook that emits hookSpecificOutput.additionalContext (the harness-neutral
// injection Claude/z-code normalize, the superpowers pattern), so a plugin host gets the contract with no
// --append-system-prompt. The hooks reuse the SAME dispatch.sh wiring as the natives, located via the host's
// ${CLAUDE_PLUGIN_ROOT} variable; dispatch.sh's first arg is the harness id `plugin`, so its shell mirror
// (harness.sh) parses payloads as the claude family (z-code/Claude share Claude's tool names + file_path).

const PKG = fileURLToPath(new URL('..', import.meta.url))   // installed spec-cli root
const HOOKS_SRC = join(PKG, 'hooks')                        // the canonical dispatch.sh + harness.sh source
const PLUGIN_NAME = 'spexcode'
// the host substitutes ${CLAUDE_PLUGIN_ROOT} with the bundle's own absolute path before running a hook command
// (the same variable z-code's hook-compat honours), so dispatch.sh/inject-contract.sh resolve regardless of
// where the host scanned the bundle from.
const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}'
// the lifecycle events the bundle binds — the Claude/z-code superset; a host that fires fewer (Codex) simply
// never invokes the extras, so binding all is harmless and one emit serves every host.
const PLUGIN_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification'] as const

// the gathered surface artifacts this materialize writes into the bundle. contract = the assembled guide+system
// block (the SAME string the native path folds into CLAUDE.md, here delivered as additionalContext); skills/
// agents/commands are the already-materialized file CONTENTS (reusing materialize's skillArtifact/agentArtifact),
// keyed
// by node name; spex is the baked tsx+cli invocation the dispatcher gate calls; version stamps plugin.json.
export type PluginBundle = {
  contract: string
  skills: { name: string; content: string }[]
  agents: { name: string; content: string }[]
  commands: { name: string; content: string }[]
  spex: string
  version: string
}

// the bundle dir for a plugin folder: <proj>/<folder>/plugins/spexcode — `<folder>` is the host's plugins-scan
// root ([[harness-select]] requires it explicit), `plugins/<name>` the conventional bundle location under it.
export function pluginBundleDir(proj: string, folder: string): string {
  return join(proj, folder, 'plugins', PLUGIN_NAME)
}

// the de-facto Claude-plugin manifest: name (the bundle identity clean() gates on), version, description, and
// the component pointers Claude/z-code discover (hooks.json + the skills/commands/agents dirs).
function pluginManifest(version: string): string {
  return JSON.stringify({
    name: PLUGIN_NAME,
    version,
    description: 'SpexCode — spec-driven dev-flow contract, hooks, skills, commands & agents as one self-contained plugin.',
    hooks: './hooks/hooks.json',
    commands: './commands',
    agents: './agents',
    skills: './skills',
  }, null, 2)
}

// hooks.json in the Claude/z-code-compatible shape { "hooks": { "<Event>": [{ "hooks": [command…] }] } }. Every
// event → the SHARED dispatch.sh (`plugin` baked as its harness id, SPEX inherited by handlers); SessionStart
// ALSO runs inject-contract.sh first, so the contract additionalContext lands alongside the normal dispatch.
function pluginHooksJson(spex: string): string {
  const dispatch = (e: string) => `SPEX='${spex}' bash "${PLUGIN_ROOT}/hooks/dispatch.sh" plugin ${e}`
  const inject = `bash "${PLUGIN_ROOT}/hooks/inject-contract.sh"`
  const hooks: Record<string, unknown> = {}
  for (const e of PLUGIN_EVENTS) {
    const cmds = e === 'SessionStart'
      ? [{ type: 'command', command: inject }, { type: 'command', command: dispatch(e) }]
      : [{ type: 'command', command: dispatch(e) }]
    hooks[e] = [{ hooks: cmds }]
  }
  return JSON.stringify({ hooks }, null, 2)
}

// the SessionStart hook OUTPUT carrying the contract as additionalContext. JSON-encoded HERE, at materialize time,
// so the runtime hook is a trivial `cat` — never a fragile shell escaping of arbitrary contract prose.
function contractContextJson(contract: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: contract } }, null, 2)
}

// the SessionStart contract injector: print the pre-encoded additionalContext payload (the harness-neutral
// stand-in for --append-system-prompt). A bare cat — all the encoding happened at materialize time.
const INJECT_SH = `#!/usr/bin/env bash
# Emit the SpexCode contract as SessionStart additionalContext — the harness-neutral contract injection (the
# superpowers pattern; Claude/z-code normalize hookSpecificOutput.additionalContext) that replaces a plugin
# host's missing --append-system-prompt. The JSON was written at materialize time, so this is a trivial cat.
here="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
[ -f "$here/contract-context.json" ] && cat "$here/contract-context.json"
exit 0
`

// emit (or idempotently re-emit) the whole bundle into <folder>/plugins/spexcode.
export function emitPlugin(proj: string, folder: string, r: PluginBundle): void {
  const bundle = pluginBundleDir(proj, folder)
  const meta = join(bundle, '.claude-plugin')
  const hooksDir = join(bundle, 'hooks')
  mkdirSync(meta, { recursive: true })
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(meta, 'plugin.json'), pluginManifest(r.version))
  // hooks: the SHARED dispatcher + its shell mirror (copied verbatim — the exact native wiring), the contract
  // injector + its pre-encoded payload, and the event→dispatch binding.
  copyFileSync(join(HOOKS_SRC, 'dispatch.sh'), join(hooksDir, 'dispatch.sh'))
  copyFileSync(join(HOOKS_SRC, 'harness.sh'), join(hooksDir, 'harness.sh'))
  writeFileSync(join(hooksDir, 'inject-contract.sh'), INJECT_SH)
  writeFileSync(join(hooksDir, 'contract-context.json'), contractContextJson(r.contract))
  writeFileSync(join(hooksDir, 'hooks.json'), pluginHooksJson(r.spex))
  // skills / agents / commands — the Claude-plugin layout, the SAME materialized contents as the native dirs.
  for (const s of r.skills) writeBundleFile(join(bundle, 'skills', s.name, 'SKILL.md'), s.content)
  for (const a of r.agents) writeBundleFile(join(bundle, 'agents', `${a.name}.md`), a.content)
  for (const c of r.commands) writeBundleFile(join(bundle, 'commands', `${c.name}.md`), c.content)
}

function writeBundleFile(f: string, content: string): void {
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, content)
}

// the INVERSE of emitPlugin — prune the bundle when its folder is DESELECTED ([[harness-delivery]] tracks the
// previously-emitted folders and cleans any the current set dropped, e.g. switching plugin→native or folder A→B).
// Identity-gated on the bundle's own plugin.json `name`, so it removes ONLY a spexcode bundle, never a folder
// the user populated with another plugin.
export function cleanPlugin(proj: string, folder: string): void {
  const bundle = pluginBundleDir(proj, folder)
  const manifest = join(bundle, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) return
  try {
    if (String(JSON.parse(readFileSync(manifest, 'utf8'))?.name) !== PLUGIN_NAME) return
  } catch { return }
  rmSync(bundle, { recursive: true, force: true })
}

// the bundle version stamped into plugin.json — the monorepo root `spexcode` package version (the published
// artifact's version), falling back to the spec-cli package, then 0.0.0.
export function pluginVersion(): string {
  for (const p of [join(PKG, '..', 'package.json'), join(PKG, 'package.json')]) {
    try { const v = JSON.parse(readFileSync(p, 'utf8'))?.version; if (v) return String(v) } catch { /* keep trying */ }
  }
  return '0.0.0'
}
