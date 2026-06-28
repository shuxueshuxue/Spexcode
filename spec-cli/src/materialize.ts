import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig, loadSkillConfig } from './specs.js'
import { compileManifest } from './hooks.js'
import { HARNESSES, writeManagedBlock } from './harness.js'
import { runtimeRoot } from './layout.js'

// @@@ materialize - the "pay-per-change" node step (≈0.85s) the cheap shell gate invokes ONLY when the
// .config content-hash moved. It renders the spec tree's surface nodes into the flat artifacts each
// consumer reads cheaply, so a USER-self-launched claude/codex (no SpexCode process in the launch) gets the
// whole system via harness-auto-discovered files: (1) the hook MANIFEST (our dispatcher reads it),
// (2) the CONTRACT as a managed <spexcode> block in each harness's contract file(s) — user content
// preserved, (3) the thin SHIMS (every event → dispatch.sh), (4) the per-harness TRUST (Codex's deterministic
// trusted_hash; Claude none) so the self-launch is zero-prompt. EVERY harness-specific fact is owned by the
// [[harness-adapter]] (harness.ts) — this file just loops over HARNESSES, so adding a harness adds an adapter,
// not a branch here. All writes are idempotent + scoped. The content-hash marker is stamped last.

const PKG = fileURLToPath(new URL('..', import.meta.url))                 // installed spec-cli root
const DISPATCH = join(PKG, 'hooks', 'dispatch.sh')
const SPEX = `${join(PKG, 'node_modules', '.bin', 'tsx')} ${join(PKG, 'src', 'cli.ts')}`
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
  // (2) the contract = the surface:system bodies, in name order, written into EACH harness's contract file(s)
  //     + (3) each harness's thin shim → dispatch.sh + (4) its trust. All owned by the adapter.
  const contract = loadSystemConfig().map((c) => c.body.trim()).filter(Boolean).join('\n\n')
  // a skill node → the agentskills.io SKILL.md primitive: `name`+`description` frontmatter (the load-trigger)
  // over the body instructions. One pure render shared by every harness — divergence is only its skillDir.
  const renderSkill = (sk: { name: string; desc: string; body: string }) =>
    `---\nname: ${sk.name}\ndescription: ${JSON.stringify(sk.desc)}\n---\n\n${sk.body}\n`
  const shimPaths: string[] = []
  for (const h of HARNESSES) {
    if (contract) for (const f of h.contractFiles(proj)) writeManagedBlock(f, contract)
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
  // (4b) the shims are machine-specific generated wiring (they bake this machine's absolute install path), so
  // gitignore them — regenerated per-machine by this same gate. Derived from the adapters' shimFile(), not
  // hardcoded; written as a managed `#` block so the user's own .gitignore is preserved. Keeps the worktree
  // free of tracked machine-specific files (the contract md files stay tracked — they carry the user's prose).
  if (shimPaths.length) writeManagedBlock(join(proj, '.gitignore'), shimPaths.sort().join('\n'), ['# ', ''])
  // (5) stamp the content-hash marker LAST (so a crash mid-render leaves it stale → re-renders next gate).
  const h = contentHash(proj)
  writeFileSync(join(rt, 'content-hash'), h)
  return h
}
