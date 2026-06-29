import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig, loadSkillConfig, loadAgentConfig } from './specs.js'
import { compileManifest } from './hooks.js'
import { HARNESSES, writeManagedBlock } from './harness.js'
import { runtimeRoot } from './layout.js'
import { tsxBin } from './tsx-bin.js'

// @@@ materialize - the "pay-per-change" node step (≈0.85s) the cheap shell gate invokes ONLY when the
// .config content-hash moved. It renders the spec tree's surface nodes into the flat artifacts each
// consumer reads cheaply, so a USER-self-launched claude/codex (no SpexCode process in the launch) gets the
// whole system via harness-auto-discovered files: (1) the hook MANIFEST (our dispatcher reads it),
// (2) the CONTRACT — the tracked docs guide (docs/AGENT_GUIDE.md) FOLLOWED BY the surface:system bodies —
// written WHOLE into each harness's contract file(s), which are GENERATED, gitignored artifacts (like the
// shims + skills): regenerated per clone/launch, never committed, so a self-launched agent still discovers
// guide + contract while the repo tracks only the guide source, (3) the thin SHIMS (every event → dispatch.sh),
// (4) the per-harness TRUST (Codex's deterministic trusted_hash; Claude none) so the self-launch is zero-prompt.
// EVERY harness-specific fact is owned by the [[harness-adapter]] (harness.ts) — this file just loops over
// HARNESSES, so adding a harness adds an adapter, not a branch here. All writes are idempotent + scoped. The
// content-hash marker is stamped last.

const PKG = fileURLToPath(new URL('..', import.meta.url))                 // installed spec-cli root
const DISPATCH = join(PKG, 'hooks', 'dispatch.sh')
const SPEX = `${tsxBin(PKG)} ${join(PKG, 'src', 'cli.ts')}`
// the manifest + content-hash marker render into the GLOBAL per-project store (layout.runtimeRoot), NOT the
// worktree — the worktree keeps zero SpexCode-rendered runtime; only the harness-discovered contract files +
// shims (which the harness must find in-tree) are written under proj below.

// the deterministic content fingerprint of the config roots. ONE definition — `hp_config_hash` in the shell
// mirror (harness.sh) — which the dispatch.sh gate ALSO calls, so the gate and this renderer can never disagree
// on "changed" (they used to inline the identical find-pipeline in two places, each commenting the other "MUST match").
export function contentHash(proj: string): string {
  try {
    const harnessSh = join(PKG, 'hooks', 'harness.sh')
    return execFileSync('bash', ['-c', `cd "${proj}" && . "${harnessSh}" && hp_config_hash`]).toString().trim()
  } catch { return '' }
}

// the whole pay-per-change render. proj defaults to cwd. Returns the new content-hash it stamped.
export function materialize(proj = process.cwd()): string {
  const rt = runtimeRoot(proj)                                            // global per-project store, not the worktree
  mkdirSync(rt, { recursive: true })
  // (1) hook manifest (persistent — the dispatcher reads it; regenerated only here, on change).
  writeFileSync(join(rt, 'hooks-manifest'), compileManifest())
  // (2) the contract = the tracked docs guide (the hand-written agent/contributor notes — the ONE piece of
  //     in-tree prose) FOLLOWED BY the surface:system bodies (in name order), written WHOLE into EACH harness's
  //     contract file(s) + (3) each harness's thin shim → dispatch.sh + (4) its trust. All owned by the adapter.
  //     The contract files are generated artifacts (gitignored below), so the guide is the single source a
  //     self-launched agent reads from — assembling it in keeps guide + contract reaching the agent together.
  const guidePath = join(proj, 'docs', 'AGENT_GUIDE.md')
  const guide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8').trim() : ''
  const systemBodies = loadSystemConfig().map((c) => c.body.trim()).filter(Boolean)
  const contract = [guide, ...systemBodies].filter(Boolean).join('\n\n')
  // a skill node → the agentskills.io SKILL.md primitive: `name`+`description` frontmatter (the load-trigger)
  // over the body instructions. One pure render shared by every harness — divergence is only its skillDir.
  const renderSkill = (sk: { name: string; desc: string; body: string }) =>
    `---\nname: ${sk.name}\ndescription: ${JSON.stringify(sk.desc)}\n---\n\n${sk.body}\n`
  // an agent node → a coding-agent sub-agent definition (the same primitive .claude/agents/*.md ships): the
  // node's `desc` is the on-demand load-trigger, its `tools` the harness tool allowlist, its body the agent's
  // system prompt. One pure render shared by every harness — divergence is only its agentDir.
  const renderAgent = (ag: { name: string; desc: string; tools: string[]; body: string }) =>
    `---\nname: ${ag.name}\ndescription: ${ag.desc}\ntools: ${ag.tools.join(', ')}\n---\n\n${ag.body}\n`
  const shimPaths: string[] = []
  for (const h of HARNESSES) {
    if (contract) for (const f of h.contractFiles(proj)) { writeManagedBlock(f, contract); shimPaths.push(relative(proj, f)) }
    const shimFile = h.shimFile(proj)
    mkdirSync(dirname(shimFile), { recursive: true })
    const shim = h.shim(DISPATCH, SPEX)
    writeFileSync(shimFile, shim.json)
    h.writeTrust(proj, shim.cmd)
    shimPaths.push(relative(proj, shimFile))
  }
  // (6) skills - each `surface: skill` node → a SKILL.md the harness auto-discovers, written into every
  //     harness's own skillDir (Claude .claude/skills, Codex .codex/skills). Generated wiring, so the paths
  //     join the same managed .gitignore block below. A harness with no skill primitive (skillDir null) is skipped.
  for (const sk of loadSkillConfig()) {
    for (const h of HARNESSES) {
      const dir = h.skillDir(proj); if (!dir) continue
      const f = join(dir, sk.name, 'SKILL.md')
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, renderSkill(sk))
      shimPaths.push(relative(proj, f))   // reuse the same managed .gitignore block
    }
  }
  // (7) sub-agents - each `surface: agent` node → a <name>.md the harness auto-discovers, written into every
  //     harness's own agentDir (Claude .claude/agents). The SAME pattern as skills: generated wiring, so the
  //     paths join the same managed .gitignore block below. A harness with no agent primitive (agentDir null,
  //     e.g. Codex) is skipped — no `if (codex)`, the divergence is the adapter's agentDir line.
  for (const ag of loadAgentConfig()) {
    for (const h of HARNESSES) {
      const dir = h.agentDir(proj); if (!dir) continue
      const f = join(dir, `${ag.name}.md`)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, renderAgent(ag))
      shimPaths.push(relative(proj, f))   // reuse the same managed .gitignore block
    }
  }
  // (4b) every artifact this render writes IN-TREE is generated wiring, so gitignore it — regenerated per
  // clone/launch by this same gate, never committed. That now includes the CONTRACT files (CLAUDE.md/AGENTS.md):
  // their whole content is the generated guide+system block, so they are artifacts exactly like the shims +
  // skills + sub-agents — the only tracked prose is the guide SOURCE (docs/AGENT_GUIDE.md), which this render
  // reads. Derived from the adapters' own contractFiles()/shimFile()/skillDir/agentDir, not hardcoded; written
  // as a managed `#` block so the user's own .gitignore is preserved.
  // only ignore paths that live INSIDE proj. The codex hooks shim now materializes at the MAIN checkout (codex
  // reads a linked worktree's hooks from the root checkout — see harness.ts); from a linked worktree that path
  // escapes proj (`../…`) and is gitignored by the main checkout's OWN materialize, not the worktree's.
  // spexcode.local.json — the machine-local config overlay (host-specific values, e.g. an absolute worker
  // launcher path; see portable-layout) — joins the SAME block on the same rationale: machine-specific, must
  // never be committed. Without it an adopter who follows our own guidance to put a host path there would
  // `git add -A` and leak it — the exact thing the overlay exists to prevent.
  const ignorable = [...shimPaths.filter((p) => !p.startsWith('..')), 'spexcode.local.json']
  if (ignorable.length) writeManagedBlock(join(proj, '.gitignore'), ignorable.sort().join('\n'), ['# ', ''])
  // (5) stamp the content-hash marker LAST (so a crash mid-render leaves it stale → re-renders next gate).
  const h = contentHash(proj)
  writeFileSync(join(rt, 'content-hash'), h)
  return h
}
