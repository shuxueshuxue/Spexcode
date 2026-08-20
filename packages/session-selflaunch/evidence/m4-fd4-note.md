# M4 F-D4 repaired vector

On the repaired listener, the same PATH-first base64 shim used for fail-first rejects `--decode` and returns exit zero
for `-d` while copying input unchanged. Before dequeue, the fixed `QQ==` probe observes bytes other than the required
single `0x41` and refuses with exit 2. The listener emits no stdout, stderr names the failed capability and the
compatible-tooling/PATH repair, and the real protocol queue still contains its one message. The paired immutable
`m4-fd4-fail-first.log` records that the pre-repair listener consumed that message.
