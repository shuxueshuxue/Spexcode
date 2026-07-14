// raw-byte secret-scan regression ([[spec-reconstruction-bench]]) — proves the archive gate catches the
// credential's exact / prefix / base64-literal bytes embedded in BINARY blobs (NUL-surrounded), stays
// clean on innocent binary, and that the shared FAIL-CLOSED tree scan hard-stops on symlink / unreadable
// / missing-root instead of silently skipping. run: node spec-eval/bench/reconstruction/scan.selftest.mjs
import { rawByteScan, scanTreeRaw } from './sandbox.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let failed = 0
const check = (name, cond, detail = '') => { if (!cond) { failed++; console.log(`  ✗ ${name} ${detail}`) } else console.log(`  ✓ ${name}`) }

const KEY = 'ZK-secret-abcdef0123456789'
const b64 = Buffer.from(KEY).toString('base64')
const NUL = Buffer.from([0, 1, 2, 0])

// positive: exact key bytes wrapped in NUL binary
const binExact = Buffer.concat([NUL, Buffer.from(KEY), NUL, Buffer.from([0xff, 0x00])])
const rExact = rawByteScan(binExact, KEY)
check('binary-exact-caught', rExact.keyHits >= 1 && rExact.prefixHits >= 1, JSON.stringify(rExact))

// positive: only the 6-char prefix embedded in binary
const binPrefix = Buffer.concat([NUL, Buffer.from(KEY.slice(0, 6)), NUL])
const rPrefix = rawByteScan(binPrefix, KEY)
check('binary-prefix-caught', rPrefix.keyHits === 0 && rPrefix.prefixHits >= 1, JSON.stringify(rPrefix))

// positive: base64-literal of the key embedded in binary (e.g. an accidental base64 dump)
const binB64 = Buffer.concat([NUL, Buffer.from(b64), NUL])
const rB64 = rawByteScan(binB64, KEY)
check('binary-b64-literal-caught', rB64.b64Hits >= 1, JSON.stringify(rB64))

// negative: innocent binary (no key/prefix/b64) — must be clean
const clean = Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, 65, 66, 67])
const rClean = rawByteScan(clean, KEY)
check('clean-binary-negative', rClean.keyHits === 0 && rClean.prefixHits === 0 && rClean.b64Hits === 0, JSON.stringify(rClean))

// counts multiple occurrences
const twice = Buffer.concat([Buffer.from(KEY), NUL, Buffer.from(KEY)])
check('counts-occurrences', rawByteScan(twice, KEY).keyHits === 2)

// ---- scanTreeRaw: the shared fail-closed tree gate ----
const tree = (build) => { const d = mkdtempSync(join(tmpdir(), 'srb-scantree-')); build(d); return d }

// clean tree → clean, every file counted
const tClean = tree((d) => { mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'a.txt'), 'hello'); writeFileSync(join(d, 'sub/b.bin'), NUL) })
const rTreeClean = scanTreeRaw(tClean, KEY)
check('tree-clean', rTreeClean.clean === true && rTreeClean.scanError === false && rTreeClean.scannedFiles === 2, JSON.stringify(rTreeClean))

// planted key deep in the tree → hit, unclean
const tPlant = tree((d) => { mkdirSync(join(d, 'deep/deeper'), { recursive: true }); writeFileSync(join(d, 'deep/deeper/leak.bin'), Buffer.concat([NUL, Buffer.from(KEY)])) })
const rTreePlant = scanTreeRaw(tPlant, KEY)
check('tree-planted-key-caught', rTreePlant.keyHits === 1 && rTreePlant.clean === false, JSON.stringify(rTreePlant))

// symlink anywhere → HARD scanError, walk stops (file behind it never certified)
const tLink = tree((d) => { writeFileSync(join(d, 'a.txt'), 'x'); symlinkSync('/etc/hostname', join(d, 'escape')) })
const rTreeLink = scanTreeRaw(tLink, KEY)
check('tree-symlink-hard-stop', rTreeLink.scanError === true && rTreeLink.clean === false && rTreeLink.errors.some((e) => /symlink/.test(e)), JSON.stringify(rTreeLink.errors))

// unreadable file → HARD scanError (never a silent skip)
const tPerm = tree((d) => { writeFileSync(join(d, 'locked.bin'), 'x'); chmodSync(join(d, 'locked.bin'), 0o000) })
const rTreePerm = scanTreeRaw(tPerm, KEY)
check('tree-unreadable-hard-stop', rTreePerm.scanError === true && rTreePerm.clean === false, JSON.stringify(rTreePerm.errors))
chmodSync(join(tPerm, 'locked.bin'), 0o600)

// missing scan root → fail-closed scanError, NOT an empty clean pass
const rTreeMissing = scanTreeRaw(join(tmpdir(), 'srb-scantree-definitely-absent'), KEY)
check('tree-missing-root-fail-closed', rTreeMissing.scanError === true && rTreeMissing.clean === false, JSON.stringify(rTreeMissing.errors))

// shape/content digests: deterministic across runs; content change flips contentDigest but not the
// path-set; adding a file flips both. (the promotion publisher's stability gate rides on these)
const rAgain = scanTreeRaw(tClean, KEY)
check('tree-digests-deterministic', rAgain.pathSetDigest === rTreeClean.pathSetDigest && rAgain.contentDigest === rTreeClean.contentDigest)
writeFileSync(join(tClean, 'a.txt'), 'hello CHANGED')
const rMut = scanTreeRaw(tClean, KEY)
check('tree-content-change-flips-content-digest', rMut.contentDigest !== rTreeClean.contentDigest && rMut.pathSetDigest === rTreeClean.pathSetDigest)
writeFileSync(join(tClean, 'new.txt'), 'x')
const rAdd = scanTreeRaw(tClean, KEY)
check('tree-new-file-flips-path-set-digest', rAdd.pathSetDigest !== rTreeClean.pathSetDigest && rAdd.scannedFiles === 3)

for (const d of [tClean, tPlant, tLink, tPerm]) rmSync(d, { recursive: true, force: true })

console.log(failed ? `\nSCAN SELFTEST FAILED (${failed})` : '\nscan selftest ✓ all pass')
process.exit(failed ? 1 : 0)
