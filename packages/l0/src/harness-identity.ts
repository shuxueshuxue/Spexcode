type HarnessIdentityRow = { id: string; sessionEnvVar: string }

// Adapter-neutral identity facts. Full harness adapters project these rows; consumers that only resolve an
// environment identity must not load launchers, runtime transport, or materialization code.
export const HARNESS_IDENTITIES = [
  { id: 'claude', sessionEnvVar: 'CLAUDE_CODE_SESSION_ID' },
  { id: 'codex', sessionEnvVar: 'CODEX_THREAD_ID' },
  { id: 'opencode', sessionEnvVar: 'OPENCODE_SESSION_ID' },
  { id: 'pi', sessionEnvVar: 'PI_SESSION_ID' },
  { id: 'zcode', sessionEnvVar: 'ZCODE_SESSION_ID' },
  { id: 'claude-headless', sessionEnvVar: 'CLAUDE_CODE_SESSION_ID' },
  { id: 'opencode-headless', sessionEnvVar: 'OPENCODE_SESSION_ID' },
  { id: 'pi-headless', sessionEnvVar: 'PI_SESSION_ID' },
  { id: 'codex-headless', sessionEnvVar: 'CODEX_THREAD_ID' },
] as const satisfies readonly HarnessIdentityRow[]

export type HarnessId = typeof HARNESS_IDENTITIES[number]['id']
export type HarnessIdentity = typeof HARNESS_IDENTITIES[number]

const identityById = new Map(HARNESS_IDENTITIES.map((identity) => [identity.id, identity]))

export function harnessIdentity(id: HarnessId): HarnessIdentity {
  const identity = identityById.get(id)
  if (!identity) throw new Error(`unknown harness identity '${id}'`)
  return identity
}
