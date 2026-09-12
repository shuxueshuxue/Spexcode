---
title: gugu-atlas-tab
status: active
hue: 30
desc: The atlas as a gugu tab extension — the workspace's spec tree with each node's diagram drawn in the tab by archify's own renderer, following the files as an agent writes them, and one button that starts that agent.
code:
  - distribution/gugu/spexcode-atlas/app.js
related:
  - distribution/gugu/spexcode-atlas/atlas-model.js
  - distribution/gugu/spexcode-atlas/index.html
  - distribution/gugu/spexcode-atlas/style.css
  - distribution/gugu/spexcode-atlas/manifest.json
  - scripts/distribution.mjs
  - scripts/distribution.test.mjs
  - scripts/gugu-tab.e2e.mjs
---

# gugu-atlas-tab

gugu's extensions add tabs to its interface: a folder with a `manifest.json` and a page that runs in its own
sandbox, reaching the host only through `window.gugu` and only with the capabilities its manifest declares. So the
atlas for gugu is a tab, not a skill ([[distribution]]). It asks for two capabilities: reading the workspace, and
starting agents in the tab's task.

**What the tab shows.** The workspace's spec tree — every folder under `.spec/` holding a `spec.md`, the tree being
the folder tree, SpexCode's own `.plugins` machinery left out — with the selected node's title, description,
governed file, its diagram, and its body. The reading is `atlas-model.js`: pure functions over the files the host
hands the page, a reader rather than SpexCode's assembly (no drift, no lint). A body renders from its markdown with
everything escaped first, and a `[[node]]` mention is a link only when it names a node.

**Diagrams are drawn in the tab.** A page in gugu's sandbox has no SpexCode backend to render for it, so the tab
carries archify's renderer, bundled for a browser, and draws each `diagram.json` itself — the same SVG, byte for
byte, that the dashboard shows, with archify's stylesheet and focus behaviour: a click lights a box and its
neighbours, a double-click on a box that is a child opens it. A diagram that cannot be drawn shows archify's
reason in its own slot and costs the node nothing else.

**It follows, it does not write.** "Draw the atlas" starts an agent in the tab's task with the atlas instructions
(the same text every package carries); the tab writes nothing itself. It re-reads the tree when the host reports a
change under `.spec/`, once a burst of saves settles, so the tree grows while the agent works. A missing capability
is said plainly, with where to grant it, never worked around.

The gugu shelf's shipped-example harness parses every `.js` file as a classic script, so the package's model, focus,
and prompt helpers expose globals. Classic scripts share ONE global lexical scope, so each helper publishes its
namespace object from inside a wrapper and leaks nothing else: a helper whose own `buildTree` reached that scope
would make the page's `const { buildTree } = …` a redeclaration, and the browser would refuse to parse the page's
script at all — the tab would render nothing, with every button dead. Checking each file on its own cannot see this,
because the collision exists only between files; the page parses them together, in the order the page loads them. The archify renderer keeps its top-level-await ESM bundle as `archify.mjs`, loaded
by the classic page through a local dynamic import. The page calls the bridge as explicit `window.gugu.*` methods; the
resulting SVG is byte for byte the same as archify's Node renderer.
