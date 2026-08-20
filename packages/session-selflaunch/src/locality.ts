import { statfsSync } from 'node:fs'
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

export interface LocalityDetector {
  readonly platform: string
  statfsType(parentPath: string): number | bigint
}

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
  if (detector.platform !== 'linux') {
    throw new LocalityError(
      'LOCALITY_DETECTOR_UNAVAILABLE',
      `no filesystem locality detector for platform ${detector.platform}; pass --assume-local-storage only after auditing ${parent}`,
    )
  }

  let type: number | bigint
  try {
    type = detector.statfsType(parent)
  } catch (error) {
    // @@@missing-parent - It cannot open, so preserve the protocol's more actionable path error.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return databasePath
    throw new LocalityError('LOCALITY_PROBE_FAILED', `could not determine the filesystem of ${parent}`, error)
  }

  const classification = classifyFilesystemType(type)
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

const linuxDetector: LocalityDetector = {
  platform: process.platform,
  statfsType: parentPath => statfsSync(parentPath).type,
}

export function requireLocalDatabasePath(databasePath: string, options: { assumeLocal?: boolean } = {}): string {
  return requireLocalDatabasePathWithDetector(databasePath, options, linuxDetector)
}
