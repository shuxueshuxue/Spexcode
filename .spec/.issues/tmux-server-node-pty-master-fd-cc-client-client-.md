---
concern: tmux server 全局卡死:node-pty master fd 泄漏进兄弟 -CC client,死 client 的 tty 写阻塞冻结整个 server → 所有 dashboard terminal 黑屏
by: unknown
status: open
created: 2026-07-17T12:25:03.799Z
---

现象:dashboard(bj01.ezfrp.com:20703 / 本机 9443 网关)所有 session 的 terminal 全黑。后端 WS(8787 /api/sessions/:id/socket)带 ?cols&rows 连上后 0 字节:连 seed frame 都没有。

根因(已在本机实测锁定):`-L spexcode` 的 tmux server(当时 pid 399416)整个 event loop 卡死在一次阻塞 tty 写(wchan=wait_woken)——它在往一个已死 control client 的 tty(pts/38)写数据,而这个 tty 的 pty master 早已被其属主(pty-bridge killBridge → node-pty kill)关闭,却被后续 spawn 的兄弟子进程以 fd 继承的方式泄漏持有(node-pty fork 时 master fd 未 CLOEXEC)。master 不死 → slave 不 EIO → tmux 不踢客户端 → 缓冲写满 → 阻塞 → 所有 control-mode bridge 全部失聪 → 每个 terminal 黑屏。

证据链:
- `tmux -L spexcode list-sessions` 无限挂起(timeout 都杀不干净);server State=S,wchan=wait_woken。
- server fd 表持有 pts/38 slave,但 ps 里没有任何 client 在 pts/38。
- 全进程扫 `/dev/ptmx` + fdinfo tty-index:pts/38 的 master 被 pid 803144(一个后来 spawn 的 `tmux -CC attach` client)继承持有;且泄漏呈阶梯状——每个更晚的 -CC client 都继承了之前所有 bridge 的 master(713653 持 46/50/47,713667 持 46/50/16/47,713675 再多一个 19,713686 持 7 个含已死的 pts/30……)。
- kill 803144(释放泄漏 master)的瞬间 server 解卡:list-sessions 立即返回,WS 立刻恢复满帧流(已过 9443 网关带 cookie 实测 101 + 帧字节)。

修复方向:node-pty spawn 出的 master fd 需要 FD_CLOEXEC(node-pty 已知问题,fork 竞态泄 fd 给并发 spawn 的子进程);或 bridge 死亡时主动校验 slave 真正 EIO。只要 dashboard 会反复 spawn/kill `-CC` client(reconcile 正是这么做的),这个 wedge 就会周期性复发——本次已是线上真实中断(用户报障)。

临时恢复手段(已执行,供下次复发时用):找出泄漏 master 的持有者(全进程扫 ptmx fdinfo 的 tty-index,对没有活 client 的 pts 号下手),kill 那个进程即可,无需杀 tmux server(杀 server 会带走所有 agent 会话)。

<!-- reply: human @ 2026-07-17T13:43:57.441Z -->
@new:reclaude 从根本上处理一下
