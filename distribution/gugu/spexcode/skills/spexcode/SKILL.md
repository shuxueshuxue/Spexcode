---
name: spexcode
description: "Use when working in a repository that has a .spec/ tree (SpexCode): find the spec that governs a file, keep specs and code in step, check drift with spex spec lint, read or file the repository's local issues. Also when a message names a spec node as [[node-id]]."
---

# spexcode

This repository's intent is written as a spec tree: every folder under `.spec/` with a `spec.md` is a node, and a
node's `code:` line names the files or functions it governs. Run SpexCode as `npx -y --registry=https://registry.npmjs.org -p spexcode@0.7.0 spex <command>` (Node 22 or
newer); a `spex` already on the PATH works the same. Inside SpexCode's own repository npx takes the local
`spexcode` package for the one it was asked to fetch and says `spex: command not found`: run the npx line from
any other directory with `-c 'cd <this repository> && spex <command>'`, or use a `spex` on the PATH.

- **A message that names `[[node-id]]`** is about that node: read it first, `npx -y --registry=https://registry.npmjs.org -p spexcode@0.7.0 spex spec search <id or topic>`
  finds it, and its `spec.md` is the contract your change must keep.
- **Which spec governs a file:** `spex spec owner <path>`. The whole tree: `spex graph`.
- **Change code and spec together.** A change inside an anchored unit that leaves its spec alone is drift; with the
  repository's hooks installed the commit is refused. Update the spec in the same change, or, when the contract
  still holds, say so: `git commit --trailer "Spec-OK: <node-id>"`, or afterwards
  `spex spec ack <node-id> --reason "<why the contract still holds>"`.
- **Before you hand work back:** `spex spec lint` and fix what it reports.
- **Issues** are markdown threads in `.spec/.issues/`: `spex issue ls`, `spex issue show <id>`,
  `spex issue reply <id> …`.
- `spex guide spec` is the full file format; `spex help <verb>` the rest. Diagrams: the atlas skill.

The SpexCode tab beside this task shows the tree, each node's drift and its diagram, and follows `.spec/` as you write.
