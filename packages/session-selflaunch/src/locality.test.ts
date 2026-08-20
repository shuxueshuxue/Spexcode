import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  LocalityError,
  classifyFilesystemType,
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
  assert.equal(requireLocalDatabasePathWithDetector(databasePath, {}, {
    platform: 'linux',
    statfsType: parent => {
      probed = parent
      return 0x794c7630
    },
  }), databasePath)
  assert.equal(probed, '/var/lib/spexcode')
})

test('known network and unknown filesystem values fail closed with distinct codes', () => {
  assert.equal(localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, {
    platform: 'linux', statfsType: () => 0x6969,
  })).code, 'LOCALITY_NETWORK_FILESYSTEM')
  assert.equal(localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, {
    platform: 'linux', statfsType: () => 0x65735546,
  })).code, 'LOCALITY_UNDETERMINED')
})

test('a platform without a detector refuses before probing', () => {
  let probed = false
  const error = localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, {
    platform: 'darwin',
    statfsType: () => {
      probed = true
      return 0xef53
    },
  }))
  assert.equal(error.code, 'LOCALITY_DETECTOR_UNAVAILABLE')
  assert.equal(probed, false)
})

test('a failed probe refuses and preserves its cause', () => {
  const cause = new Error('statfs unavailable')
  const error = localityError(() => requireLocalDatabasePathWithDetector(databasePath, {}, {
    platform: 'linux', statfsType: () => { throw cause },
  }))
  assert.equal(error.code, 'LOCALITY_PROBE_FAILED')
  assert.equal(error.cause, cause)
})

test('a missing parent is left for the protocol path gate without pretending it is local', () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  assert.equal(requireLocalDatabasePathWithDetector(databasePath, {}, {
    platform: 'linux', statfsType: () => { throw missing },
  }), databasePath)
})

test('assumeLocal bypasses only locality probing, never absolute-path validation', () => {
  let probed = false
  assert.equal(requireLocalDatabasePathWithDetector(databasePath, { assumeLocal: true }, {
    platform: 'unsupported',
    statfsType: () => {
      probed = true
      throw new Error('must not probe')
    },
  }), databasePath)
  assert.equal(probed, false)
  assert.throws(
    () => requireLocalDatabasePathWithDetector('relative.sqlite', { assumeLocal: true }, {
      platform: 'linux', statfsType: () => 0xef53,
    }),
    (error: unknown) => error instanceof DatabasePathError && error.code === 'PROTOCOL_PATH_NOT_ABSOLUTE',
  )
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
