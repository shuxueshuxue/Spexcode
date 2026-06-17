<source>
一个 node-graph 形态的界面，每个节点是一个 spec，spec 呈现树状关系。spec 有版本变迁历史，每次版本变迁都 attribute 到一个 claude code session。用户的所有指令落实到一个具体的 spec 节点上，也可以由一个层级较高的 spec 节点来进行子节点自动分配和创建，节点上只能有一个正在工作的 claude code session，每个 claude code session 都在自己的 worktree 里面，都是基于最新的 main 分支创建的。
</source>
