# Compact trace evidence

The product commit traced by both inventory runs is
`ca51f4ca5281439bbc45933402e502069100a5a0`. Dependencies were installed with Node 24; the build and traced product
loop ran with Node 22.21.0. The two historical capture commands were:

```bash
inventory_dir="$PWD/.spec/spexcode/session-runtime/self-launch-inventory/evidence"
/usr/bin/strace -f -qq -e trace=%file -s 4096 -o "$inventory_dir/trace.raw.log" \
  bash /tmp/spex-m4-self-launch.8eAkev/run-trace.sh > "$inventory_dir/hook-events.raw.txt" 2>&1
/usr/bin/strace -f -qq -e trace=%file -s 4096 -o "$inventory_dir/trace.canonical.raw.log" \
  bash /tmp/spex-m4-self-launch-canonical.fKhk1p/run-trace.sh \
  > "$inventory_dir/hook-events.canonical.raw.txt" 2>&1
```

`reproduce-traces.sh` recreates the disposable clone, runner, real materialize/hooks/self-launch CLI loop and that
trace command. Run the historical bad-inheritance shape and the corrected canonical shape with:

```bash
.spec/spexcode/session-runtime/self-launch-inventory/evidence/reproduce-traces.sh \
  <source-checkout> <output-dir> fail-first \
  /home/jeffry/spexcode/spec-cli/bin/spex.mjs
.spec/spexcode/session-runtime/self-launch-inventory/evidence/reproduce-traces.sh \
  <source-checkout> <output-dir> canonical
```

The fail-first run deliberately inherits an external `SPEX`; it is retained to reproduce the invalid precondition,
not as closure evidence. Canonical pins `SPEX` to the base-pinned fixture. `hook-events.raw.txt` and
`hook-events.canonical.raw.txt` retain the small event/result transcripts. `trace-excerpts.txt` contains only the
verbatim syscall lines necessary to ground the path ledger and five positive consumer decisions.

The clean product landing carries no complete raw trace. Durable raw retention is instead in the
`spexcode-base` repository at commit `d234b46083fa0717db2dde407d8f1335ec8e2f37`, under
`studies/session-platform-m4/evidence/inventory-traces/`; the authoritative manifest is the sibling
`studies/session-platform-m4/evidence/sha256sums.txt` at that commit:

```text
3d4cfe09d18f59ca2a243d79826791c3144fa95c49ae3f742258d5e78c1290ac  trace.raw.log
9aeb75623decfb051ec02d19bc439960f85b42f5f345e4c934ea673ac39c6410  trace.canonical.raw.log
437f905a0fa593fa7423b3c6abf9e09a31da064a91b52a7eb54193f905a83a09  hook-events.raw.txt
7c4b4f4395834fe2e22a876c30f2539d135457a3e534c0ce3f1152f79f66a18e  hook-events.canonical.raw.txt
```
