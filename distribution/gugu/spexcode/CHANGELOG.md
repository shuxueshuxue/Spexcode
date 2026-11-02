# Changelog

## 0.9.0

- App interface 25: the tab reads its session's working copy from `ctx.workspace` and watches `.spec/` with `files.onChanged({ workspace, folder: '.spec' })`.

## 0.8.0

- gugu App model v2 (App interface 24): `description` gives way to `subtitle` and `contributes.instructions`; the market page reads `store/` (about, screenshots, whats-new).

## 0.7.3

- Declare desktop and phone support for the human interface (App API 12).

## 0.7.2

- Add promotional artwork as the first market image; preserve the existing screenshots.

## 0.7.1

- A subtitle under the name in gugu's App market, and three screenshots of the App in use on its page.
- Declares gugu's App API 8 (gugu 0.2.57 or newer): a gugu that does not know subtitles keeps 0.7.0.
- The App's version is now its own; it still runs spexcode 0.7.0.

## 0.7.0

- The spec tree of a task's working copy beside the task, with drift, each node's body and diagram.
- A task on another of your computers is read on that computer.
- Start a task on a node, cite a node in this task, draw the atlas.
- Agents get the `atlas` and `spexcode` skills, and share a read-only snapshot of the tree into a group, readable
  there and on phones.
