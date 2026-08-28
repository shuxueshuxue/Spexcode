import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  LocalityError,
  classifyDarwinMount,
  classifyFilesystemType,
  darwinLocalityDetector,
  linuxLocalityDetector,
  localityDetectorForPlatform,
  parseDarwinMountTable,
  requireLocalDatabasePath,
  requireLocalDatabasePathWithDetector,
} from './locality.js'
import { DatabasePathError } from './path.js'

const databasePath = '/var/lib/spexcode/sessions.sqlite'
const localityError = (body: () => unknown): LocalityError => {
  try {
    body()
    assert.fail('expected LocalityError')
  } catch (error) {
    assert.ok(error instanceof LocalityError, String(error))
    return error
  }
}

test('filesystem magic classifier distinguishes local, network, and undetermined values', () => {
  assert.deepEqual(classifyFilesystemType(0xef53), { locality: 'local', name: 'EXT2/3/4' })
  assert.deepEqual(classifyFilesystemType(0x6969), { locality: 'network', name: 'NFS' })
  assert.deepEqual(classifyFilesystemType(0x65735546), { locality: 'undetermined', name: '0x65735546' })
  assert.deepEqual(classifyFilesystemType(0xfe534d42 | 0), { locality: 'network', name: 'SMB2' })
})

test('a positively identified local filesystem is admitted', () => {
  let probed = ''
  assert.equal(requireLocalDatabasePathWithDetector(databasePath, {}, linuxLocalityDetector(parent => {
    probed = parent
    return 0x794c7630
  })), databasePath)
  assert.equal(probed, '/var/lib/spexcode')
})

test('known network and unknown filesystem values fail closed with distinct codes', () => {
  assert.equal(localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, linuxLocalityDetector(() => 0x6969))).code, 'LOCALITY_NETWORK_FILESYSTEM')
  assert.equal(localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, linuxLocalityDetector(() => 0x65735546))).code, 'LOCALITY_UNDETERMINED')
})

test('a platform without a detector row refuses before probing', () => {
  const error = localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, localityDetectorForPlatform('win32')))
  assert.equal(error.code, 'LOCALITY_DETECTOR_UNAVAILABLE')
  assert.equal(error.message, 'no filesystem locality detector for platform win32; pass --assume-local-storage only after auditing /var/lib/spexcode')
  assert.equal(localityDetectorForPlatform('linux').platform, 'linux')
  assert.equal(localityDetectorForPlatform('darwin').platform, 'darwin')
})

test('a failed probe refuses and preserves its cause', () => {
  const cause = new Error('statfs unavailable')
  const error = localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, linuxLocalityDetector(() => { throw cause })))
  assert.equal(error.code, 'LOCALITY_PROBE_FAILED')
  assert.equal(error.cause, cause)
})

test('a missing parent fails with the protocol path code without pretending it is local', () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  assert.throws(
    () => requireLocalDatabasePathWithDetector(databasePath, {}, linuxLocalityDetector(() => { throw missing })),
    (error: unknown) => (
      error instanceof DatabasePathError
      && error.code === 'PROTOCOL_PATH_PARENT_MISSING'
      && error.message === 'database parent directory does not exist: /var/lib/spexcode'
      && error.cause === missing
    ),
  )
})

test('assumeLocal bypasses only locality probing, never absolute-path validation', () => {
  let probed = false
  assert.equal(requireLocalDatabasePathWithDetector(databasePath, { assumeLocal: true }, {
    platform: 'unsupported',
    classify: () => {
      probed = true
      throw new Error('must not probe')
    },
  }), databasePath)
  assert.equal(probed, false)
  assert.throws(
    () => requireLocalDatabasePathWithDetector('relative.sqlite', { assumeLocal: true }, linuxLocalityDetector(() => 0xef53)),
    (error: unknown) => error instanceof DatabasePathError && error.code === 'PROTOCOL_PATH_NOT_ABSOLUTE',
  )
})


// A real `/sbin/mount` transcript from a macOS 15 host (Apple silicon), with a network share and an autofs map
// added in the shapes those mounts actually print.
const DARWIN_MOUNT_TABLE = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
devfs on /dev (devfs, local, nobrowse)
/dev/disk3s6 on /System/Volumes/VM (apfs, local, noexec, journaled, noatime, nobrowse)
/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)
map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)
//user@nas._smb._tcp.local/share on /Volumes/My Share (smbfs, nodev, nosuid, mounted by user)
nas:/export/scratch on /Volumes/scratch (nfs, nodev, nosuid, mounted by user)
`

test('the darwin mount table parses mount points with spaces and keeps fstype apart from flags', () => {
  const entries = parseDarwinMountTable(DARWIN_MOUNT_TABLE)
  assert.equal(entries.length, 7)
  const share = entries.find(entry => entry.mountPoint === '/Volumes/My Share')!
  assert.equal(share.fstype, 'smbfs')
  assert.deepEqual([...share.flags], ['nodev', 'nosuid', 'mounted by user'])
  assert.equal(entries[0]!.fstype, 'apfs')
  assert.ok(entries[0]!.flags.has('local'))
})

test('darwin classification picks the deepest covering mount and trusts the kernel local flag', () => {
  assert.deepEqual(classifyDarwinMount(DARWIN_MOUNT_TABLE, '/Users/me/.spexcode'), { locality: 'local', name: 'apfs' })
  assert.deepEqual(classifyDarwinMount(DARWIN_MOUNT_TABLE, '/System/Volumes/Data/Users/me/.spexcode'), { locality: 'local', name: 'apfs' })
  assert.deepEqual(classifyDarwinMount(DARWIN_MOUNT_TABLE, '/Volumes/My Share/spex'), { locality: 'network', name: 'smbfs' })
  assert.deepEqual(classifyDarwinMount(DARWIN_MOUNT_TABLE, '/Volumes/scratch'), { locality: 'network', name: 'nfs' })
  assert.deepEqual(classifyDarwinMount(DARWIN_MOUNT_TABLE, '/System/Volumes/Data/home/me'), { locality: 'undetermined', name: 'autofs' })
  // `/Volumes/My Shared` is a sibling directory, not inside `/Volumes/My Share`: it falls through to the root mount
  assert.deepEqual(classifyDarwinMount(DARWIN_MOUNT_TABLE, '/Volumes/My Shared/x'), { locality: 'local', name: 'apfs' })
  assert.deepEqual(classifyDarwinMount('', '/anything'), { locality: 'undetermined', name: 'no mount table entry' })
})

test('the darwin detector row refuses network and undetermined mounts with the shared codes', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-selflaunch-darwin-'))
  const path = join(root, 'sessions.sqlite')
  try {
    // the root mount covers every path, so a table whose root is a network share refuses any real parent
    const networkRoot = darwinLocalityDetector(() => '//user@nas/share on / (smbfs, nodev, nosuid, mounted by user)\n')
    assert.equal(localityError(() => requireLocalDatabasePathWithDetector(path, {}, networkRoot)).code, 'LOCALITY_NETWORK_FILESYSTEM')
    // a table with no entry covering the parent is undetermined, never silently local
    const noRoot = darwinLocalityDetector(() => DARWIN_MOUNT_TABLE.split('\n').filter(line => !line.includes(' on / ')).join('\n'))
    assert.equal(localityError(() => requireLocalDatabasePathWithDetector(path, {}, noRoot)).code, 'LOCALITY_UNDETERMINED')
    // the real table admits it through the local root
    assert.equal(requireLocalDatabasePathWithDetector(path, {}, darwinLocalityDetector(() => DARWIN_MOUNT_TABLE)), path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const missing = requireLocalDatabasePathWithDetector.bind(null, join(root, 'gone', 'sessions.sqlite'), {}, darwinLocalityDetector(() => DARWIN_MOUNT_TABLE))
  assert.throws(missing, (error: unknown) => error instanceof DatabasePathError && error.code === 'PROTOCOL_PATH_PARENT_MISSING')
})

test('the production detector admits this host temporary filesystem', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-selflaunch-locality-'))
  try {
    const path = join(root, 'sessions.sqlite')
    assert.equal(requireLocalDatabasePath(path), path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
