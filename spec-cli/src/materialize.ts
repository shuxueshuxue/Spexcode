import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSystemConfig } from './specs.js'
import { compileManifest } from './hooks.js'
import { HARNESSES, writeManagedBlock } from './harness.js'

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
const RUNTIME = '.spexcode'                                              // gitignored per-project runtime dir

// the deterministic content fingerprint of the config roots — MUST match the shell gate (dispatch.sh).
export function contentHash(proj: string): string {
  try {
    const out = execFileSync('bash', ['-c',
      `cd "${proj}" && find .spec/*/.config .spec/*/config \\( -name '*.md' -o -name '*.sh' \\) -type f -print0 2>/dev/null | sort -z | xargs -0 cat 2>/dev/null | sha256sum | cut -d' ' -f1`,
    ]).toString().trim()
    return out
  } catch { return '' }
}

// the whole pay-per-change render. proj defaults to cwd. Returns the new content-hash it stamped.
export function materialize(proj = process.cwd()): string {
  mkdirSync(join(proj, RUNTIME), { recursive: true })
  // (1) hook manifest (persistent — the dispatcher reads it; regenerated only here, on change).
  writeFileSync(join(proj, RUNTIME, 'hooks-manifest'), compileManifest())
  // (2) the contract = the surface:system bodies, in name order, written into EACH harness's contract file(s)
  //     + (3) each harness's thin shim → dispatch.sh + (4) its trust. All owned by the adapter.
  const contract = loadSystemConfig().map((c) => c.body.trim()).filter(Boolean).join('\n\n')
  for (const h of HARNESSES) {
    if (contract) for (const f of h.contractFiles(proj)) writeManagedBlock(f, contract)
    const shimFile = h.shimFile(proj)
    mkdirSync(dirname(shimFile), { recursive: true })
    const shim = h.shim(DISPATCH, SPEX)
    writeFileSync(shimFile, shim.json)
    h.writeTrust(proj, shim.cmd)
  }
  // (5) stamp the content-hash marker LAST (so a crash mid-render leaves it stale → re-renders next gate).
  const h = contentHash(proj)
  writeFileSync(join(proj, RUNTIME, 'content-hash'), h)
  return h
}
