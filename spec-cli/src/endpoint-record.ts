// @@@ the endpoint record ([[host-gateway]]) - the backend's half of host discovery, and deliberately its
// own module. A `spex serve` publishes one record per project whether or not any gateway is running, and
// every reader — the hub's router, the machine peer, the CLI's discovery ladder — only needs to read a file.
// While this lived beside the host catalog and the dashboard launcher, both gateway modules had to import
// host.ts for `readEndpointRecord` while host.ts imported them to mount the gateway, so the three formed an
// import cycle around a JSON reader. The direction is now the one the comment in host.ts always claimed:
// backends never depend on the gateway.
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spexcodeHome, encodeProject } from '@spexcode/spec-core'
import type { ResolvedIdentity } from '@spexcode/spec-core'

// One record per project, written by that project's `spex serve` after its public bind succeeds and
// removed (only by its own writer) on a clean stop. The shape carries the serve's IDENTITY — url, pid,
// instanceId, root — so a reader can validate "the backend at this url is the serve that wrote this
// record, serving this root" instead of trusting a URL that a recycled port may have re-occupied.
export type EndpointRecord = {
  version: 2; url: string; pid: number; instanceId: string; root: string
  identity: ResolvedIdentity; startedAt: string
}

export const endpointRecordPath = (root: string): string =>
  join(spexcodeHome(), 'projects', encodeProject(root), 'backend.json')

// atomic publish: tmp + rename, so a reader never sees a torn record (the old write-in-place could be
// caught mid-write by the reconciler or a bare `spex`'s discovery probe).
export function publishEndpoint(rec: EndpointRecord): void {
  const file = endpointRecordPath(rec.root)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.backend.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n')
  renameSync(tmp, file)
}

// remove the record ONLY if it is ours (matched by instanceId): a newer serve that already overwrote it,
// or another project's record, is never deleted by a retiring process.
export function dropOwnEndpoint(instanceId: string, root: string): void {
  const file = endpointRecordPath(root)
  try { if (JSON.parse(readFileSync(file, 'utf8'))?.instanceId === instanceId) rmSync(file) } catch { /* not ours / already gone */ }
}

// a record is HOSTABLE only in the full identity shape; legacy {url,pid} records (pre-instance-identity)
// are ignored by the host — the direct CLI ladder still reads their url, and they are rewritten in the new
// shape the next time that serve restarts.
export function readEndpointRecord(file: string): EndpointRecord | null {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8'))
    if (r?.version === 2 && typeof r.url === 'string' && typeof r.instanceId === 'string' && typeof r.root === 'string' &&
      typeof r.identity?.title === 'string' && typeof r.identity?.icon === 'string') return r as EndpointRecord
    return null
  } catch { return null }
}
