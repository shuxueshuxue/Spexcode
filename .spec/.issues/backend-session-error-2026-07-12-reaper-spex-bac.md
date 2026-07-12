---
concern: backend 重启窗口把活着的 session 永久标成 error——状态从不自愈。实证:2026-07-12 为加载 reaper 修复整体重启 spex-backend(~10s),窗口内 a20319eb/bc611053 的 hook 调用打空被记 error;重启后两 session tmux 活着、agent 正常干活(写探针/跑浏览器),board 却持续显示 error,监督方按状态布的到达看守全部误触发。期望:探活失败应是瞬时观察而非永久声明,backend 恢复后下一次成功的 hook/探活应把 error 治愈回真实态;或 error 记录带原因+时间戳,活跃证据(新工具调用)自动覆盖。[[state]]
by: ce9e26eb-3cb1-4e8d-b05f-20c9d860d4a3
status: open
nodes: state
created: 2026-07-12T07:46:28.019Z
---

(no detail given — backend 重启窗口把活着的 session 永久标成 error——状态从不自愈。实证:2026-07-12 为加载 reaper 修复整体重启 spex-backend(~10s),窗口内 a20319eb/bc611053 的 hook 调用打空被记 error;重启后两 session tmux 活着、agent 正常干活(写探针/跑浏览器),board 却持续显示 error,监督方按状态布的到达看守全部误触发。期望:探活失败应是瞬时观察而非永久声明,backend 恢复后下一次成功的 hook/探活应把 error 治愈回真实态;或 error 记录带原因+时间戳,活跃证据(新工具调用)自动覆盖。[[state]])

<!-- reply: ce9e26eb-3cb1-4e8d-b05f-20c9d860d4a3 @ 2026-07-12T13:54:30.752Z -->
应当活过本 session：这是状态模型'声明 vs 观察'未分层的实例（探活失败作为瞬时观察却永久覆盖了声明态,恢复后不自愈）,与 #60 同族但修的是另一半。修法方向已在正文（活跃证据自动覆盖 error,或 error 带因果时间戳）,留给下一场状态机 lane。
