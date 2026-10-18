---
title: gugu-app
status: active
hue: 30
desc: SpexCode as a gugu App — beside a task, the spec tree of that task's working copy as spex assembles it, drift included, each node's body and diagram, on whichever computer the task runs; work on a node goes to a new gugu session or this one's composer; agents get SpexCode's skills and share a read-only snapshot of the tree into a group, which the App draws in the group and on phones.
code:
  - distribution/gugu/spexcode/app.js
related:
  - distribution/gugu/spexcode/tools.js
  - distribution/gugu/spexcode/spex-in.mjs
  - distribution/gugu/spexcode/index.html
  - distribution/gugu/spexcode/style.css
  - distribution/gugu/spexcode/manifest.json
  - distribution/gugu/spexcode/spex-command.js
  - distribution/gugu/spexcode/skills/spexcode/SKILL.md
  - distribution/gugu/spexcode/diagram.css
  - distribution/gugu/spexcode/README.md
  - distribution/gugu/spexcode/CHANGELOG.md
  - scripts/distribution.mjs
  - scripts/distribution.test.mjs
---

# gugu-app

gugu is a chat client whose tasks are agent sessions; an App adds a tab beside a task, a program its tabs can call,
and skills for its agents, each behind a capability the person consents to once at install. SpexCode's App is the
one part of SpexCode gugu does not have — the spec tree, its drift and its pictures — and it hands everything else to
gugu: sessions are gugu's own, so the App starts none of SpexCode's ([[distribution]]).

**What the tab shows.** The spec tree of the working copy of the task it sits beside, exactly as `spex graph --json`
assembles it — the same nodes, parents and drift the dashboard shows, not a second reader of the folder tree. A node
that drifted is marked in the tree and says which files moved under it; a node a session changed and has not landed
says that. The selected node shows its title, description, governed code, its diagram and its body. Bodies render
with gugu's own markdown, so they read like every other gugu surface; a `[[node]]` mention is a link only when it
names a node. Diagrams are drawn in the tab with archify's renderer bundled for a browser, the same SVG the
dashboard draws, with its focus behaviour; a diagram that cannot be drawn shows archify's reason in its own slot.

**Why a program.** Drift is a computation over git, and a gugu tab runs in a sandbox with no process, no git and no
network to this machine — so the tab cannot run `spex` and cannot reach `spex serve`. The App's program (`tools.js`)
can: it runs with the person's rights, the tab calls its two tools (`graph`, `node`) through the host, and both are
page-only, so no agent sees them — an agent has a shell and runs `spex` itself. Which working copy they read is
gugu's stamp on the call (`workspaceRoot`), never an argument: a tab beside a task on another of the person's
computers has its call run on THAT computer, in that task's working copy, and its context names no path at all —
the tab asks, the stamp decides, and a page cannot point the program at a folder of its choosing. The program runs
the spex of THIS App's version through npx with the public registry named (`spex-command.js`, generated): what the
install sheet was consented to and what runs stay one thing. npx runs from the App's own folder and `spex-in.mjs`
then runs spex in the working copy: inside SpexCode's own repository, whose package is itself called `spexcode`, npx
run there takes the local package for the one it was asked to fetch and finds no `spex`. The command line holds constants only — the
helper by its name relative to the App's folder, the working copy in `SPEXCODE_APP_ROOT` — because on Windows npx is a
`.cmd` that only a shell runs, and a shell splits a folder with a space in it (`咕咕 Beta`) and runs what follows a
`&` in a working copy's name. `node` reads only a `spec.md` under the working copy's
`.spec/` and the diagram beside it. A machine without npx is told so, with what to install.

**It follows, it does not write.** The tab writes nothing. It re-reads the tree when gugu reports a change under
`.spec/` in a working copy on this computer (beside a task on another computer, Refresh reads again), once a burst of saves settles, one read at a time: changes that arrive during a read mark it
dirty and one more read follows. Moving the tab to another task drops a read still out for the old one: it is never drawn under the new task. Moving the tab to another task rebinds it to that
task's working copy. A missing capability is said plainly, with where to grant it.

**Work goes to gugu.** "Start here" takes the person's words and starts a new gugu session in the working copy's
project with `[[node]]` and those words as its prompt; "Cite" puts `[[node]]` in this task's composer, where the
person sends it or not. "Draw the atlas" starts a session with the atlas instructions every package carries. The
tasks the App started are listed with the status gugu reports for them, verbatim, each a click away — the tab never
announces work it cannot observe.

**A group sees a snapshot.** The people of a group have no working copy and a phone runs no program, so what reaches
them is a file: an agent in the group calls `share` (its one tool, agent-only) with the group's chat, and the program
puts `<project>.spexcode` in that chat's files — the tree as the tab reads it and every node's body and diagram, no
path of the sharer's computer. Sharing again makes that file's next version, so a group keeps one snapshot per
project, with its history. The agent must be in the group (gugu checks the chat it hands); the file is the agent's.
The App claims the suffix in chats (its second tab, `snapshot`), and the same page, opened for such a file, draws it
read-only — no program, no watch, no Start here or Cite, who shared it and when above the tree. The file is a stored
file whatever its size (its own suffix and type): a `.json` would become a live document under 1 MB and a stored
file over it, and the page would read one thing two ways.

**Agents get the skills.** The App gives the agents on the computer two skills: `atlas` (the same skill every
package ships) and `spexcode` — how to work in a repository SpexCode governs, through the same pinned spex: find the
spec of a file, change code and spec together, `Spec-OK` or `spec ack` when the contract still holds, lint before
handing back, the local issues, and sharing the tree with a group.

**On the market.** gugu's market (`nmhjklnm/gugu-apps`) lists a version of this folder at a commit of this
repository: `README.md` (with the pictures in `screenshots/`) is its card's page, and `CHANGELOG.md` must have a
section for the manifest's version, which is the package's own.

The page's helpers (`focus.js`, `prompt.js`) are classic scripts sharing one global lexical scope, so each publishes
its namespace from inside a wrapper and leaks nothing else; `app.js` is a module and the archify bundle a module it
imports.
