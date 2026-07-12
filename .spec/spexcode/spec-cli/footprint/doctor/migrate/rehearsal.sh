#!/usr/bin/env bash
# A/B rehearsal rig for `spex doctor --migrate` ([[migrate]]): builds a REAL 0.2.x adopter repo from this
# repo's own git history (v0.2.8, the last all-old-vocabulary release), proves the new CLI refuses it
# loudly (A), migrates it, then proves the whole new-CLI chain works on the result (B) — plus the
# customized-asset flag rehearsal and the idempotency refusal. HOME is redirected into the rig so no
# global store / codex config on the real machine is touched.
set -uo pipefail

SRC=${SRC:-$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)}
REF=${REF:-cf3902d8}
RIG=${RIG:-/tmp/spex-migrate-rehearsal}
TSX="$SRC/spec-cli/node_modules/.bin/tsx"
CLI="$SRC/spec-cli/src/cli.ts"
spx() { "$TSX" "$CLI" "$@"; }

rm -rf "$RIG"; mkdir -p "$RIG/home" "$RIG/adopter"
export HOME="$RIG/home"
unset SPEXCODE_API_URL SPEXCODE_HOME SPEXCODE_SESSION_ID SPEX SPEXCODE_HARNESS_LIB PORT 2>/dev/null || true

echo "== rig: adopter repo from $REF =="
git -C "$SRC" archive "$REF" | tar -x -C "$RIG/adopter"
cd "$RIG/adopter"
git init -q -b main
git config user.email rig@spexcode.invalid; git config user.name rig
git add -A; git commit -qm "adopter frozen at spexcode $REF (0.2.x vocabulary)"

echo; echo "== A: the new CLI on the un-migrated tree (expect LOUD refusal + dangling measurements) =="
spx spec lint > "$RIG/A-spec-lint.txt" 2>&1; a1=$?
spx eval lint > "$RIG/A-eval-lint.txt" 2>&1; a2=$?
spx materialize > "$RIG/A-materialize.txt" 2>&1; a3=$?
echo "materialize exit=$a3:"; sed -n '1,6p' "$RIG/A-materialize.txt"
echo "eval lint exit=$a2 (advisory) — the old tree's declared measurements are INVISIBLE (yatsu.md unread):"
grep -c "eval-coverage:" "$RIG/A-eval-lint.txt" || true
[ $a3 -ne 0 ] || { echo "RIG FAIL: materialize did not refuse the legacy tree"; exit 1; }
grep -q "predates the v0.3.0" "$RIG/A-materialize.txt" || { echo "RIG FAIL: refusal is not the loud legacy-tree message"; exit 1; }
grep -q "eval-coverage: 'board-cache'" "$RIG/A-eval-lint.txt" || { echo "RIG FAIL: expected board-cache (which HAS a yatsu.md with readings) to read as uncovered pre-migration"; exit 1; }

echo; echo "== MIGRATE =="
spx doctor --migrate > "$RIG/migrate.txt" 2>&1; m=$?
tail -40 "$RIG/migrate.txt"
[ $m -eq 0 ] || { echo "RIG FAIL: doctor --migrate exited $m"; cat "$RIG/migrate.txt"; exit 1; }

echo; echo "== B: full new-CLI chain on the migrated tree =="
spx spec lint > "$RIG/B-spec-lint.txt" 2>&1; b1=$?
grep -E "spex spec lint:" "$RIG/B-spec-lint.txt" | tail -1
# The post-0.2.8 content rules (id-format / mention, landed 2026-07-12) legitimately fire on the
# archive's own pre-existing content — that's the adopter's documented post-migration cleanup TODO,
# not migration damage. The migration-owned claim is ZERO errors in every OTHER class.
nonarchive=$(grep -E '^  ✗' "$RIG/B-spec-lint.txt" | grep -vcE '✗ (id-format|mention):')
echo "errors outside the archive-content classes (id-format/mention): $nonarchive"
[ "$nonarchive" -eq 0 ] && b1=0 || b1=1
spx eval lint > "$RIG/B-eval-lint.txt" 2>&1; b2=$?
grep -E "spex eval lint" "$RIG/B-eval-lint.txt" | tail -1
spx materialize > "$RIG/B-materialize.txt" 2>&1; b3=$?
tail -1 "$RIG/B-materialize.txt"

SG=.spec/spexcode/.plugins/core/stop-gate/stop-gate.sh
echo "-- label grep in migrated stop-gate --"
grep -n "eval-(drift|missing|coverage)" -E "$SG" || { echo "RIG FAIL: new labels not in stop-gate"; exit 1; }
grep -n "yatsu" "$SG" && { echo "RIG FAIL: yatsu survives in stop-gate"; exit 1; }

echo "-- run the migrated stop-gate for real (governed active session, first stop → block JSON) --"
enc=$(pwd | sed 's/[/.]/-/g')
sdir="$HOME/.spexcode/projects/$enc/sessions/rig-sess"
mkdir -p "$sdir"
printf '{"session_id":"rig-sess","governed":true,"status":"active","proposal":null}' > "$sdir/session.json"
harness_lib="$SRC/spec-cli/hooks/harness.sh"
[ -f "$harness_lib" ] || { echo "RIG FAIL: package harness.sh missing at $harness_lib"; exit 1; }
out=$(printf '{"session_id":"rig-sess","stop_hook_active":false}' | SPEXCODE_HARNESS_LIB="$harness_lib" SPEX="$TSX $CLI" bash "$SG")
sg=$?
echo "$out" | head -3
echo "$out" | grep -q '"decision":"block"' || { echo "RIG FAIL: stop-gate did not block an undeclared governed stop (exit=$sg)"; exit 1; }

echo; echo "== IDEMPOTENCY: second --migrate must refuse cleanly =="
git add -A >/dev/null 2>&1; git commit -qm "migrated (rig)" >/dev/null 2>&1
spx doctor --migrate > "$RIG/second.txt" 2>&1; s=$?
sed -n '1,4p' "$RIG/second.txt"
[ $s -ne 0 ] || { echo "RIG FAIL: second run did not refuse"; exit 1; }
grep -q "already migrated" "$RIG/second.txt" || { echo "RIG FAIL: refusal does not say already-migrated"; exit 1; }

echo; echo "== CUSTOMIZED ASSET: a hand-edited stop-gate must be FLAGGED, not rewritten =="
rm -rf "$RIG/adopter2"; mkdir -p "$RIG/adopter2"
git -C "$SRC" archive "$REF" | tar -x -C "$RIG/adopter2"
cd "$RIG/adopter2"
git init -q -b main; git config user.email rig@spexcode.invalid; git config user.name rig
printf '\n# local tweak: my custom escape hatch\n' >> .spec/spexcode/.config/core/stop-gate/stop-gate.sh
git add -A; git commit -qm "adopter with a hand-customized stop-gate"
spx doctor --migrate > "$RIG/custom.txt" 2>&1; c=$?
grep -n "stop-gate.sh" "$RIG/custom.txt" | head -3
grep -q "differs from EVERY known stock template version" "$RIG/custom.txt" || { echo "RIG FAIL: customized asset not flagged"; exit 1; }
grep -q "my custom escape hatch" .spec/spexcode/.plugins/core/stop-gate/stop-gate.sh || { echo "RIG FAIL: customized asset was rewritten"; exit 1; }

echo; echo "RIG RESULT: A(refusal)=ok migrate=ok B(spec-lint=$b1 eval-lint=$b2 materialize=$b3) stop-gate=block idempotency=refused customized=flagged"
[ $b1 -eq 0 ] && [ $b2 -eq 0 ] && [ $b3 -eq 0 ] || { echo "RIG FAIL: a B-phase check is red"; exit 1; }
echo "ALL GREEN"
