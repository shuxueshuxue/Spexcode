// Reference ADOPTER-SIDE path resolver. This is not protocol core and is not part of the protocol
// contract: it is one way to satisfy the precondition the contract states, namely that a
// databasePath sits on a local filesystem with reliable advisory locking.
//
// The rule that matters is FAIL CLOSED. If locality cannot be determined -- an unrecognised
// filesystem, a platform with no usable detector, a probe that throws -- the answer is refusal, not
// optimistic acceptance. A rollback journal works over a network filesystem without complaint, so
// nothing downstream will fail loud on our behalf. WAL used to do that for free by requiring shared
// memory; v1 does not use WAL, so the guarantee has to be made here, explicitly, up front.
import { statfsSync } from 'node:fs'
import { dirname } from 'node:path'
import { platform } from 'node:process'

export class PathLocalityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PathLocalityError'
    this.code = code
  }
}

// Verbatim from /usr/include/linux/magic.h (package linux-libc-dev). These identify filesystems
// whose advisory locking cannot be relied on across hosts.
export const NETWORK_FILESYSTEM_TYPES = [
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

// Filesystems measured or documented as ordinary local storage on Linux. An allow-list rather than
// a deny-list is what makes the resolver fail closed: an unknown type is refused, not admitted.
export const LOCAL_FILESYSTEM_TYPES = [
  { name: 'EXT2/3/4', type: 0xef53 },
  { name: 'BTRFS', type: 0x9123683e },
  { name: 'XFS', type: 0x58465342 },
  { name: 'F2FS', type: 0xf2f52010 },
  { name: 'TMPFS', type: 0x01021994 },
  { name: 'OVERLAYFS', type: 0x794c7630 },
  { name: 'ZFS', type: 0x2fc12fc1 },
]

export const classifyFilesystemType = type => {
  const network = NETWORK_FILESYSTEM_TYPES.find(e => e.type === type)
  if (network) return { locality: 'network', name: network.name }
  const local = LOCAL_FILESYSTEM_TYPES.find(e => e.type === type)
  if (local) return { locality: 'local', name: local.name }
  // FUSE lands here on purpose: its magic identifies the driver, not whether the backing store is
  // local, so sshfs and a local overlay are indistinguishable by identity. Undetermined = refused.
  return { locality: 'undetermined', name: `0x${(type >>> 0).toString(16)}` }
}

/**
 * Establishes the locality precondition, then returns the path for openProtocol.
 * Throws rather than returning a verdict, so a caller cannot ignore the answer by accident.
 */
export function resolveProtocolDatabasePath(databasePath, options = {}) {
  const parent = dirname(databasePath)

  if (platform !== 'linux' && !options.assumeLocal) {
    throw new PathLocalityError('LOCALITY_DETECTOR_UNAVAILABLE',
      `no filesystem locality detector for platform ${platform}; refusing ${parent}. `
      + 'Supply an audited detector, or pass assumeLocal for an operator-attested local path.')
  }
  if (options.assumeLocal) return databasePath

  let type
  try {
    type = statfsSync(parent).type
  } catch (error) {
    throw new PathLocalityError('LOCALITY_PROBE_FAILED',
      `could not determine the filesystem of ${parent}: ${error.message}`)
  }

  const { locality, name } = classifyFilesystemType(type)
  if (locality === 'network') {
    throw new PathLocalityError('LOCALITY_NETWORK_FILESYSTEM',
      `${parent} is ${name}; advisory locking is unreliable there and the protocol would corrupt silently`)
  }
  if (locality === 'undetermined') {
    throw new PathLocalityError('LOCALITY_UNDETERMINED',
      `filesystem type ${name} at ${parent} is not on the audited local list; refusing rather than guessing`)
  }
  return databasePath
}
