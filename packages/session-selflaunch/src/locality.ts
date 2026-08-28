import { execFileSync } from 'node:child_process'
import { realpathSync, statSync, statfsSync } from 'node:fs'
import { isAbsolute, dirname } from 'node:path'

import { DatabasePathError } from './path.js'

export type LocalityRefusalCode =
  | 'LOCALITY_NETWORK_FILESYSTEM'
  | 'LOCALITY_UNDETERMINED'
  | 'LOCALITY_DETECTOR_UNAVAILABLE'
  | 'LOCALITY_PROBE_FAILED'

export class LocalityError extends Error {
  readonly code: LocalityRefusalCode

  constructor(code: LocalityRefusalCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'LocalityError'
    this.code = code
  }
}

interface FilesystemType {
  readonly name: string
  readonly type: number
}

// @@@network-magic-evidence - These header values drive classifier vectors, not real-mount evidence;
// this host has no corresponding network mount on which to run them.
const NETWORK_FILESYSTEM_TYPES: readonly FilesystemType[] = [
  { name: 'NFS', type: 0x6969 },
  { name: 'SMB', type: 0x517b },
  { name: 'CIFS', type: 0xff534d42 },
  { name: 'SMB2', type: 0xfe534d42 },
  { name: '9P', type: 0x01021997 },
  { name: 'CEPH', type: 0x00c36400 },
  { name: 'AFS', type: 0x5346414f },
  { name: 'AFS_FS', type: 0x6b414653 },
  { name: 'CODA', type: 0x73757245 },
  { name: 'OCFS2', type: 0x7461636f },
  { name: 'NCP', type: 0x564c },
]

const LOCAL_FILESYSTEM_TYPES: readonly FilesystemType[] = [
  { name: 'EXT2/3/4', type: 0xef53 },
  { name: 'BTRFS', type: 0x9123683e },
  { name: 'XFS', type: 0x58465342 },
  { name: 'F2FS', type: 0xf2f52010 },
  { name: 'TMPFS', type: 0x01021994 },
  { name: 'OVERLAYFS', type: 0x794c7630 },
  { name: 'ZFS', type: 0x2fc12fc1 },
]

export interface FilesystemClassification {
  readonly locality: 'local' | 'network' | 'undetermined'
  readonly name: string
}

const unsignedMagic = (type: number | bigint): number => Number(BigInt.asUintN(32, BigInt(type)))

export function classifyFilesystemType(type: number | bigint): FilesystemClassification {
  const magic = unsignedMagic(type)
  const network = NETWORK_FILESYSTEM_TYPES.find(candidate => candidate.type === magic)
  if (network) return { locality: 'network', name: network.name }
  const local = LOCAL_FILESYSTEM_TYPES.find(candidate => candidate.type === magic)
  if (local) return { locality: 'local', name: local.name }
  return { locality: 'undetermined', name: `0x${magic.toString(16)}` }
}

// @@@ one detector row per platform - a platform's answer to "is this filesystem local?" is a DATA row: Linux
// reads the statfs magic (the kernel's stable per-filesystem constant); Darwin cannot, because its statfs `f_type`
// is a vfs registration ordinal (26 for APFS on one host, anything on another), so the Darwin row reads the mount
// table the kernel publishes and trusts its MNT_LOCAL flag. A platform with no row refuses before probing.
export interface LocalityDetector {
  readonly platform: string
  // absent = this platform has no detector; `requireLocalDatabasePathWithDetector` refuses without probing
  readonly classify?: (parentPath: string) => FilesystemClassification
}

export const linuxLocalityDetector = (statfsType: (parentPath: string) => number | bigint): LocalityDetector => ({
  platform: 'linux',
  classify: parentPath => classifyFilesystemType(statfsType(parentPath)),
})

// Darwin filesystem type names that are network transports even when the mount table omits MNT_LOCAL. `local`
// wins when present (it is the kernel's own verdict); this list only names the refusal, so the operator reads
// "smbfs" instead of a bare "undetermined".
const DARWIN_NETWORK_FILESYSTEM_NAMES: ReadonlySet<string> = new Set(['nfs', 'smbfs', 'afpfs', 'webdav', 'cifs', 'ftp'])

interface DarwinMountEntry {
  readonly mountPoint: string
  readonly fstype: string
  readonly flags: ReadonlySet<string>
}

// `/sbin/mount` prints one `<device> on <mount point> (<fstype>, <flag>, …)` line per mount. The mount point may
// contain spaces (`/Volumes/My Disk`); the parenthesised list is always last and never contains `)`.
const DARWIN_MOUNT_LINE = /^.+ on (.+) \(([^)]*)\)$/

export function parseDarwinMountTable(output: string): DarwinMountEntry[] {
  const entries: DarwinMountEntry[] = []
  for (const line of output.split('\n')) {
    const match = DARWIN_MOUNT_LINE.exec(line.trim())
    if (!match) continue
    const [fstype = '', ...flags] = match[2]!.split(',').map(part => part.trim()).filter(Boolean)
    entries.push({ mountPoint: match[1]!, fstype, flags: new Set(flags) })
  }
  return entries
}

const mountPointCovers = (mountPoint: string, path: string): boolean =>
  mountPoint === '/' || path === mountPoint || path.startsWith(mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`)

export function classifyDarwinMount(mountTable: string, resolvedPath: string): FilesystemClassification {
  let entry: DarwinMountEntry | undefined
  for (const candidate of parseDarwinMountTable(mountTable)) {
    if (!mountPointCovers(candidate.mountPoint, resolvedPath)) continue
    if (!entry || candidate.mountPoint.length > entry.mountPoint.length) entry = candidate
  }
  if (!entry) return { locality: 'undetermined', name: 'no mount table entry' }
  if (entry.flags.has('local')) return { locality: 'local', name: entry.fstype }
  if (DARWIN_NETWORK_FILESYSTEM_NAMES.has(entry.fstype)) return { locality: 'network', name: entry.fstype }
  return { locality: 'undetermined', name: entry.fstype }
}

export const darwinLocalityDetector = (readMountTable: () => string): LocalityDetector => ({
  platform: 'darwin',
  classify: parentPath => {
    // `mount` never fails for a missing directory, so the parent's absence must be raised here for the resolver
    // to keep its actionable PROTOCOL_PATH_PARENT_MISSING error.
    statSync(parentPath)
    return classifyDarwinMount(readMountTable(), realpathSync(parentPath))
  },
})

export function requireLocalDatabasePathWithDetector(
  databasePath: string,
  options: { assumeLocal?: boolean },
  detector: LocalityDetector,
): string {
  if (!isAbsolute(databasePath)) {
    throw new DatabasePathError('PROTOCOL_PATH_NOT_ABSOLUTE', 'databasePath must be absolute before locality detection')
  }
  if (options.assumeLocal) return databasePath

  const parent = dirname(databasePath)
  if (!detector.classify) {
    throw new LocalityError(
      'LOCALITY_DETECTOR_UNAVAILABLE',
      `no filesystem locality detector for platform ${detector.platform}; pass --assume-local-storage only after auditing ${parent}`,
    )
  }

  let classification: FilesystemClassification
  try {
    classification = detector.classify(parent)
  } catch (error) {
    // @@@missing-parent - Preserve the actionable path error without pretending locality was established.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new DatabasePathError('PROTOCOL_PATH_PARENT_MISSING', `database parent directory does not exist: ${parent}`, error)
    }
    throw new LocalityError('LOCALITY_PROBE_FAILED', `could not determine the filesystem of ${parent}`, error)
  }

  if (classification.locality === 'network') {
    throw new LocalityError(
      'LOCALITY_NETWORK_FILESYSTEM',
      `${parent} is ${classification.name}; advisory locking is not admitted there`,
    )
  }
  if (classification.locality === 'undetermined') {
    throw new LocalityError(
      'LOCALITY_UNDETERMINED',
      `filesystem type ${classification.name} at ${parent} is not on the audited local allow-list`,
    )
  }
  return databasePath
}

const readDarwinMountTable = (): string =>
  execFileSync('/sbin/mount', [], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] })

export function localityDetectorForPlatform(platform: string): LocalityDetector {
  if (platform === 'linux') return linuxLocalityDetector(parentPath => statfsSync(parentPath).type)
  if (platform === 'darwin') return darwinLocalityDetector(readDarwinMountTable)
  return { platform }
}

export function requireLocalDatabasePath(databasePath: string, options: { assumeLocal?: boolean } = {}): string {
  return requireLocalDatabasePathWithDetector(databasePath, options, localityDetectorForPlatform(process.platform))
}
