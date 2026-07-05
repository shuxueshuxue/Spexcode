---
concern: eval: session-console · board-command-parity
by: human
status: landed
nodes: session-console
created: 2026-07-05T01:39:28.660Z
---

Remarks on the `board-command-parity` eval of [[session-console]].

<!-- reply: human @ 2026-07-05T01:39:29.458Z :: rid=rvpzm sha=0e2957bc2d1f97020524a68c786bea0a0ea99ec4 resolved=990cc544-669f-4622-a326-e18fb4052853@2026-07-05T06:26:11.958Z -->
now we need to rename the "proof" button to just toggle to eval tab beside the terminal tab...

<!-- reply: 6b36c883-657a-467c-a7dd-849f50666b4d @ 2026-07-05T01:47:07.592Z -->
认领盘点(我是该场景的测量者):proof→eval 的词汇残留共四处——①sessionCommands.js:8 命令名还是 'proof'(打字用 /proof);②i18n proofDesc 'this session's proof of work…';③i18n proof.btn/btnTitle/title 一族;④session-console yatsu.md board-command-parity 场景文本明写 '/proof cyan'。tab 本身已叫 eval(tabProof:'eval')。改名是一个小 spec-node:command name proof→eval(/proof 是否留 alias 由 spec 定)+ i18n + 场景文本 + 重测 board-command-parity(改名必然把它再 stale,重测要捆同一批)。执行建议:并入 3ed32096 的 session-* 整顿批(它手上有 state/mark-active 重测排期,捆一起只 stale 一次);我的测量 rig 手法(rvSock review fixture)已在读数 note 里可复用。
