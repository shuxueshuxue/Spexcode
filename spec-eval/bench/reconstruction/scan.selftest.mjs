// raw-byte secret-scan regression ([[spec-reconstruction-bench]]) — proves the archive gate catches the
// credential's exact / prefix / base64-literal bytes embedded in BINARY blobs (NUL-surrounded), and stays
// clean on innocent binary. run: node spec-eval/bench/reconstruction/scan.selftest.mjs   (exit 0 = pass)
import { rawByteScan } from './sandbox.mjs'

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

console.log(failed ? `\nSCAN SELFTEST FAILED (${failed})` : '\nscan selftest ✓ all pass')
process.exit(failed ? 1 : 0)
