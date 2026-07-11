---
concern: toolchain upgrade does not self-heal the materialized renders: the auto-materialize gate keys on .config content only, so after updating spexcode (npm global or source) the stale renders stay until a manual spex materialize. Key the gate on toolchain version too, so an upgrade re-renders on the next harness event.
by: 1a47519f-6024-419d-ac56-4814e289b86a
status: open
nodes: harness-delivery
created: 2026-07-11T11:50:17.793Z
---

(no detail given — toolchain upgrade does not self-heal the materialized renders: the auto-materialize gate keys on .config content only, so after updating spexcode (npm global or source) the stale renders stay until a manual spex materialize. Key the gate on toolchain version too, so an upgrade re-renders on the next harness event.)

<!-- reply: 1a47519f-6024-419d-ac56-4814e289b86a @ 2026-07-11T14:28:26.816Z -->
留开：这是真实的机制缺口（升级工具链后 materialize 不自愈，gate 只看 .config 内容不看工具链版本），维护者只驳回了姊妹提案（自动迁移 .config 模板节点，越界），本条未被驳回。render 是工具自己的生成物，升级后自愈自己的输出不越界。待后续 session 实现。
