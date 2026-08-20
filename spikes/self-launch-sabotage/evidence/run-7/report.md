# M4 lane F final attack report

Base under test: merged integration head `fda32033e` plus the corrected descendant-attribution and calibration gate.
The run-7 gate exited 0. The fixture was `/tmp/spex-self-launch-sabotage.B5Ofvd`, and every printed checkout, project,
home, `SPEXCODE_HOME`, `TMPDIR`, database, runtime root, tree slot, hostile target and relocated default home resolved
below that fixture.

Raw traces are not stored in this product tree. Their byte-preserving copies and manifest are external at
`/home/jeffry/spexcode-base/studies/session-platform-m4/evidence/sabotage-traces/` and
`/home/jeffry/spexcode-base/studies/session-platform-m4/evidence/sha256sums.txt`.

Run-3/run-5 had file records without clone edges, so ancestry attribution reduced to a PID proxy. Run-6 had process
records without file records because separate `-e` filters selected process tracing; its zeroes were NOT-MEASURED and
its pass was retracted, while calibration accepted an `execve` argv occurrence. Run-7 is the only run with both record
classes in one trace and a calibration grounded in a real file syscall. **A calibration that can pass while the tracer
is blind is not a calibration.** These superseded runs remain external because removing the correction targets would
make the correction unverifiable.

| Attack | Result | Evidence / condition |
| --- | --- | --- |
| 1. Rename old store root | PASS | Initialize, separate-process enqueue and real listener delivery returned `RENAMED-ROOT-DELIVERY`; pending was empty. |
| 2. Deny old store root | PASS | Product dispatch exited 0. The full trace retained 6 live-shape accesses; the `session-listen.sh` PID was `2366345`, and complete child-to-parent ancestry matched 0 legacy selectors. |
| 3. Poison queue/timeline/lock files | NO-CONSUMER | Delivery returned `DATABASE-AUTHORITY`; old message-state selector matched 0. This confirms no consumer; it is not a deletion pass. |
| 4. No backend/observer/wake hints | PASS | Pending retained the message; explicit traced dequeue returned `NO-WAKE-DURABLE`; resident process counts were 0 before and after. |
| 5. Recognized `SPEXCODE_HOME` relocation | PASS | With no explicit database path, initialize created only `<fixture>/relocated-home/sessions.sqlite`; the operator-home default database remained absent. |
| 6. Kernel file trace | PASS | Calibration exit was 0 and the poison path matched a real `openat(...)` line; old message-state selector was 0 across traced dispatch/dequeue. |
| 7. Static references | PASS | Production self-launch/listener source, clean self-launch dist, npm-packed members and materialized executable files each matched 0 old-facility references; test-only evidence was 0. |

The trace command is `/usr/bin/strace -f -qq -e trace=%file,%process`. Attack 2's trace contained 1077 file-syscall
lines and 51 process-syscall lines. Its listener ancestry count is computed from the clone/vfork/clone3 child-to-parent
map, so descendants are covered rather than represented by the listener PID alone. Calibration requires the poison
path on an `openat`, `newfstatat`, `stat`, or `access` syscall line; run-7 reports `trace_calibration_hits=1`.

Calibration evidence (one line, preserved in the external run-7 blob):

```text
2366599 openat(AT_FDCWD, "/tmp/spex-self-launch-sabotage.B5Ofvd/home/.spexcode/projects/-tmp-spex-self-launch-sabotage-B5Ofvd-project/sessions/sabotage-native-session/pending.json", O_RDONLY) = 3
```

Exact trace command families used for every listed blob:

```text
# attack2-dispatch.strace / attack3-dispatch.strace
printf '%s' "$payload" | /usr/bin/strace -f -qq -e trace=$TRACE_SPEC -s 4096 -o "$trace" -- "${fixture_env[@]}" bash "$dispatch" codex "$event"
# attack4-dequeue.strace
/usr/bin/strace -f -qq -e trace=$TRACE_SPEC -s 4096 -o "$trace" -- "${fixture_env[@]}" "$node22" "$cli" dequeue --session-id sabotage-native-session --database-path "$database"
# calibration.strace
/usr/bin/strace -f -qq -e trace=$TRACE_SPEC -s 4096 -o "$trace" -- /bin/cat "$calibration_file"
```

`TRACE_SPEC` was `%file` for run-3/run-5, `%file` followed by a separate `%process` option for invalid run-6, and
`%file,%process` for run-7. The event was `SessionStart` for attack2 and `UserPromptSubmit` for attack3. The command
families are the exact gate invocations; `fixture_env`, `trace`, `dispatch`, `cli`, `database`, and `calibration_file`
are the gate variables printed or resolved inside the disposable fixture.

External SHA256 manifest entries:

```text
56190d0fda78a5cd8ae4b0309abd74763c52193ea8caf1c324264d8aaa8c399a  sabotage-traces/run-3/attack2-dispatch.strace
047b486e836bf73257879f234ea5c2aff5408bb497499cbb6c57dd22655190b2  sabotage-traces/run-3/attack3-dispatch.strace
d89fd832536c9ed4d09c3dc980f81cdaa886adf6e70e8ea606c980d98df08d39  sabotage-traces/run-3/attack4-dequeue.strace
7ab6b2a050b1926ecdc1db68985a48be9043730d94cb5611ee52dce07bfe2275  sabotage-traces/run-3/calibration.strace
9a7012e12ed1307e2935a831606cea43508929bcfd2256d2028e650a45834061  sabotage-traces/run-5/attack2-dispatch.strace
00b6596b522667104c303d78c8ec5699e0f9dcf21b6e94525dcf645cbb3b1fc1  sabotage-traces/run-5/attack3-dispatch.strace
68ed126807408491e5a7c92a0a2bf8a6c9f5f65beff40d2cd9ed3d701d971de6  sabotage-traces/run-5/attack4-dequeue.strace
808de737961834314311bdd87ef3965fde30b0b1bd213b09b38e7c659e6fda3f  sabotage-traces/run-5/calibration.strace
cc85fd4dce8e47c34280b21c47e66df782a6a4276406a85c0dec8ee5ea12ddbd  sabotage-traces/run-6/attack2-dispatch.strace
44ec32b5e749f940218dafda28bfbe8227095bb5f32ba5925efb5ac9c2baaf9e  sabotage-traces/run-6/attack3-dispatch.strace
061f57275bc0bc2d7fe72eb4a3ae039d68c4ec0e19b9ebf98ce2653009c74df9  sabotage-traces/run-6/attack4-dequeue.strace
bf62c6187c138a269064751574e138dbf57b8b468460e8884e20bad96c402a0f  sabotage-traces/run-6/calibration.strace
b1e78a4bab8077e292bbea359ebcf97e86ec890387a6e5f639ad80ab1a36f4c8  sabotage-traces/run-7/attack2-dispatch.strace
7186878636268b869587693100b4a53647ac3f9a1fb668926d45dcb9f393af16  sabotage-traces/run-7/attack3-dispatch.strace
cef3a0570dfb78f7b3a07892a2b42da9a2d039050a72df460b18b0414525d82e  sabotage-traces/run-7/attack4-dequeue.strace
8883145b8993d7fee37c4fa7ed3c6bc3d987dc20fb0f5cd5d6d44e06684db52d  sabotage-traces/run-7/calibration.strace
```

All count prerequisites were `MEASURED`: named source roots, clean build, valid npm pack, real materialize output,
calibrated tracer, and zero-exit traced commands. The five independent counts were:

```text
static_legacy_imports=0
legacy_dist_files=0
legacy_tarball_files=0
legacy_materialized_files=0
runtime_legacy_reads=0
runtime_live_legacy_shape_reads=15
```

The 15 retained live-shape accesses are governance-hook no-op probes and R07 per-tree manifest checks; listener
ancestry access is 0. The old queue/timeline/lock zero remains a scoped confirmation, not deletion closure, because
the absent consumer cannot be made to fail from the consumer side.
