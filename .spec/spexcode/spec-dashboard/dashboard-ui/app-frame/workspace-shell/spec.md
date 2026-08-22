---
title: workspace-shell
status: active
hue: 220
desc: The frame — rail, dock, tab strip, content area, status bar — and deliberately nothing else.
code:
  - spec-dashboard/src/Shell.jsx
related:
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---
# workspace-shell

The frame, and only the frame. It does not know what a spec is, what a session is, or what any view needs.
It knows there is an address, that an address names a view, and where on the screen that view goes.

**What it replaced was not a component but a missing layer.** The board used to be one ~710-line component
that *was* the graph, with every other page hung off it as a hidden pane and every page's state held in
that one component's body — the session selection, the search palette, the node menu, the camera, the
keyboard mode, all together. That shape decided three things it had no business deciding:

- **reading a spec had to be a popup**, because the popup was a child of the graph;
- **a tab could only switch pages**, because a page was the only unit that existed;
- **a document area had nowhere to live**, because there was no content area — only "the graph, plus some
  hidden panes".

Adding chrome around that model — a status bar, a tab strip, a file dock — produced more things competing
for one screen and still no way to read a spec beside its code. Chrome around the old model is not the new
model, and building three pieces of it before noticing is the mistake this node exists to have corrected.

**The shell is the only component that reads the global address.** A view receives `{param, query}` as
props ([[view-registry]]). That one rule is the hinge: it is what makes rendering two views at once a
layout change rather than a rewrite, and what stops a view from silently coupling to whichever address
happens to be current.

**A view is keyed on its address**, so a different document is a different instance and one document's
state cannot bleed into the next. The graph is the deliberate exception — keyed on the page alone, because
its camera and expansion are the workspace's home state rather than one address's.

**The sealed public face gets the frame's smallest form**: no dock, no tabs, no palette, one view. A door
that is not built is shut more firmly than a door that closes itself, which is why that face no longer
redirects away from live addresses — it never renders one.

**Two views at once is a layout, not a rewrite** — and that is the whole return on the hinge. A second view
is a second route and a place to put it; not one view changed to make it possible, because a view was
already receiving its route rather than reading it. The second pane is workspace state, true of the window
rather than of either document in it, and it survives a reload like the dock does. A reader sends a
document right by alt-clicking its tab: they are already pointing at the document they mean, so the gesture
asks for no new vocabulary and no new surface.

Measured with two live spec documents open: 0.02 seconds of script per 10 idle seconds.

**The palette is the shell's**, not a view's, because it floats above whichever view is showing; a hidden
view must never be able to swallow it. The dock toggle and the project identity are the shell's for the
same reason: they are true of the window, not of what it currently displays.
