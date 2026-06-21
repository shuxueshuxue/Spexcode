import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, MarkerType, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeView, { PANES } from './NodeView.jsx'
import SessionWindow from './SessionWindow.jsx'
import SessionInterface from './SessionInterface.jsx'
import SessionGraph from './SessionGraph.jsx'
import Legend from './Legend.jsx'
import Settings from './Settings.jsx'
import SpecSearch from './SpecSearch.jsx'
import { loadBoard, layout, X_GAP, Y_GAP } from './data.js'
import { labelColor } from './color.js'
import { useT } from './i18n/index.jsx'

const nodeTypes = { spec: SpecNode }
// node box (used only to centre the camera on a node). NW/NH must track the .spec-node size in
// styles.css: it's now two rows (title line + editor/last-edited line) and a bit wider for longer titles.
const NW = 220, NH = 46
const PANE_KEYS = PANES.map((p) => p.key)
const clamp = (z) => Math.max(0.4, Math.min(1.6, z))

// @@@ board chords - vim-style multi-key sequences typed on the board (a small key buffer; see onKey).
// A chord does NOT act directly: it opens the session board with a special @-directive PRE-SEEDED into
// the New Session input, which the backend performs in a fresh worktree on submit. Each maps the focused
// node id → the directive text. `nn` = new child under focus · `dd` = delete focus. Both their leader
// letters (n/d) are otherwise unbound on the board, so single-key nav (hjkl/i/…) is never shadowed.
const CHORDS = { nn: (id) => `@new under @${id}: `, dd: (id) => `@delete @${id}: ` }
const CHORD_KEYS = Object.keys(CHORDS)
const CHORD_LEADERS = new Set(CHORD_KEYS.map((c) => c[0]))

function Dashboard({ specs, sessions, reload }) {
  const [focusId, setFocusId] = useState(() => specs.find((s) => !s.parent)?.id)
  const [overlay, setOverlay] = useState(false)   // node-info popup (opened by `i`)
  const [pane, setPane] = useState('spec')
  const [sessionUI, setSessionUI] = useState(false) // session interface (opened by Enter)
  const [legend, setLegend] = useState(false)     // centered help modal: keymap + visual vocabulary (`?`)
  const [settings, setSettings] = useState(false) // centered settings modal: language picker etc. (`,`)
  const [graphView, setGraphView] = useState(false) // experimental session-subscription graph (`t`)
  const [search, setSearch] = useState(false)     // jump-to-node search palette (Alt+F)
  const [sessionSel, setSessionSel] = useState('new') // persisted across open/close: last tab/session
  const [highlightId, setHighlightId] = useState(null) // session whose overlays are emphasised
  const [seed, setSeed] = useState(null)          // one-shot text a board chord pre-fills the New Session input with
  const { getViewport, setViewport } = useReactFlow()
  const t = useT()
  const graphRef = useRef(null)
  const animRef = useRef(0)
  const chordRef = useRef({ buf: '', timer: 0 })  // pending board-chord buffer (see onKey)
  // @@@ popup scroll momentum - j/k in the info popup ease the open pane toward an ACCUMULATING
  // target (refs survive across keydowns), so held / repeated keys add up into one continuous glide
  // instead of restarting a fresh `behavior:'smooth'` tween each press (which stuttered on key-repeat).
  const scrollAnimRef = useRef(0)
  const scrollTargetRef = useRef(null)
  const scrollElRef = useRef(null)

  // resolve focus on the RAW tree first (resilient to a polled-away merged/closed node), then expand.
  const rawById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [specs])
  const focusRaw = rawById[focusId] || specs.find((s) => !s.parent) || specs[0]
  // @@@ expand-on-focus - the tree is a DRILL-DOWN, not a fixed full-forest map: only the focused node's
  // ancestor SPINE is expanded; every other subtree collapses to a single tile. So the root layer is
  // always a short, readable column and the whole tree re-plots as focus moves (see layout() in data.js
  // + the follow camera below). This deliberately replaces the older "fixed positions, never re-plots".
  const expanded = useMemo(() => {
    const set = new Set()
    for (let cur = focusRaw; cur; cur = cur.parent ? rawById[cur.parent] : null) set.add(cur.id)
    return set
  }, [focusRaw, rawById])
  // VISIBLE nodes are exactly those the layout placed (root, or a child of an expanded node); they carry
  // the x/y all geometry/render below works on. Hidden subtrees simply aren't in `specs2`.
  const placed = useMemo(() => layout(specs, expanded), [specs, expanded])
  const specs2 = useMemo(() => specs.filter((s) => placed[s.id]).map((s) => ({ ...s, ...placed[s.id] })), [specs, placed])
  const byId = useMemo(() => Object.fromEntries(specs2.map((s) => [s.id, s])), [specs2])
  const focus = byId[focusRaw.id]
  // direct-child count per node — drives the "expandable" hint: a VISIBLE node that has children but is
  // collapsed (not on the expanded spine) shows a ▸N affordance, since its subtree is hidden to the right.
  const childCount = useMemo(() => {
    const m = {}
    specs.forEach((s) => { if (s.parent) m[s.parent] = (m[s.parent] || 0) + 1 })
    return m
  }, [specs])

  // @@@ node<->session link - a node does NOT belong to a session. `node.session` is only the LAST
  // editor (the git Session: trailer — usually a closed session), kept purely as attribution. The LIVE
  // link is the overlay: the board sessions CURRENTLY editing this node = those whose pending ops touch
  // it. That set (not node.session) is what we light up and jump into; a node can have 0, 1, or many.
  const liveEditorsOf = useCallback(
    (node) => (node ? sessions.filter((s) => s.ops?.some((op) => op.nodeId === node.id)) : []),
    [sessions],
  )

  // @@@ open the board - the session interface is a PERSISTENT place you switch to, not a per-open modal:
  // it stays mounted (hidden) so its selected tab AND each tab's typed-but-unsent input survive a
  // close/reopen. Enter (board or node-info popup) always reopens it at the remembered tab (`sessionSel`),
  // a "boarding switch" — never a context jump based on the focused node.
  const openBoard = useCallback(() => setSessionUI(true), [])
  // @@@ open a session's console - the session-graph's embed: clicking a graph node crosses into THAT
  // session's console by reusing the board's open path (select its tab + show the interface). It does NOT
  // touch `graphView`: the console opens ON TOP of whichever graph you're in, and closing it returns you
  // to that same graph. Switching between the two graphs is `t`'s job alone (see onKey) — never a side
  // effect of opening a session. No new mechanism — SessionInterface already keys its console off `sessionSel`.
  const openSession = useCallback((id) => { setSessionSel(id); setSessionUI(true) }, [])
  // @@@ startNew - a board chord opens the session board on its New Session tab with `text` pre-seeded
  // (the @-directive). One-shot: SessionInterface applies it then clears `seed`, so a later reopen keeps
  // the user's own draft instead of re-seeding.
  const startNew = useCallback((text) => { setSessionSel('new'); setSeed(text); setSessionUI(true) }, [])

  const children = useMemo(() => specs2.filter((s) => s.parent === focus.id), [specs2, focus])
  const parent = focus.parent ? byId[focus.parent] : null

  // child is to the RIGHT; pick the one nearest in y.
  const childTarget = useMemo(() => {
    if (!children.length) return null
    return children.reduce((best, c) => (Math.abs(c.y - focus.y) < Math.abs(best.y - focus.y) ? c : best))
  }, [children, focus])

  // @@@ leaf right-step - a leaf has no child to dive into, so → falls back to the nearest node in
  // the columns to the RIGHT (dx>0) instead of dead-ending. Distance is weighted into grid cells
  // (dx/X_GAP, dy/Y_GAP) so the wide 280px column gap and the narrow 54px row gap compete fairly —
  // raw pixels would snap every press to the next column regardless of how far up/down a candidate
  // sits. Strictly rightward, so it never doubles as ↑/↓ and ← still steps back the way you came.
  const rightTarget = useMemo(() => {
    if (childTarget) return childTarget
    let best = null, bestD = Infinity
    for (const s of specs2) {
      const dx = s.x - focus.x
      if (dx <= 0) continue
      const dy = s.y - focus.y
      const d = (dx / X_GAP) ** 2 + (dy / Y_GAP) ** 2
      if (d < bestD) { bestD = d; best = s }
    }
    return best
  }, [childTarget, specs2, focus])

  // @@@ vertical nav - columns are aligned by depth (x = depth * X_GAP), so ↑/↓ move strictly
  // within the focused node's column to the nearest node in that y-direction. They never change
  // column or dive into a child (that's what ←/→ are for): on a border node, up jumps to the
  // cousin above in the SAME column, not to a nearer node one column over. Trivially reversible.
  const nearestY = useCallback((dir) => {
    let best = null
    for (const s of specs2) {
      if (s.id === focus.id || s.x !== focus.x) continue
      const dy = s.y - focus.y
      if (dir === 'down' ? dy <= 0 : dy >= 0) continue
      if (!best || Math.abs(dy) < Math.abs(best.y - focus.y)) best = s
    }
    return best
  }, [specs2, focus])
  const downTarget = useMemo(() => nearestY('down'), [nearestY])
  const upTarget    = useMemo(() => nearestY('up'), [nearestY])

  // @@@ nodes - positions from data; selection + (a) focus-kin dimming, or (b) when a session is
  // highlighted, the overlay-dim: nodes touched by that session glow, the rest fade. Recomputes on
  // poll (specs identity changes) so a freshly-added ghost shows up without a manual refresh.
  const nodes = useMemo(() => {
    return specs2.map((s) => {
    const kin = s.id === focusId || s.id === focus.parent || s.parent === focusId || s.parent === focus.parent
    let className
    if (highlightId) {
      className = (s.overlays || []).some((o) => o.source === highlightId) ? 'ov-hot' : 'ov-dim'
    } else {
      className = kin ? undefined : 'is-far'
    }
    // a node with live editor(s) carries a `link` (SpecNode stamps the subtle ⏎ affordance — Enter
    // crosses into that session) AND an `editors` list (SpecNode's second row draws their avatars).
    // Both driven by the live overlay (pending ops), NOT node.session. `editors` is the minimal slice
    // each avatar needs: id (the avatar seed + tooltip), status (liveness ring), node (tooltip label).
    const editors = liveEditorsOf(s)
    const editorData = editors.map((e) => ({ id: e.id, status: e.status, node: e.node }))
    // collapsed = has children but its subtree is hidden (not on the expanded spine) -> show the ▸N hint.
    const kids = childCount[s.id] || 0
    const extra = { editors: editorData, collapsed: kids > 0 && !expanded.has(s.id), childCount: kids }
    return {
      id: s.id, type: 'spec', position: { x: s.x, y: s.y },
      data: editors.length
        ? { ...s, ...extra, link: { color: labelColor(editors[0].id), status: editors[0].status } }
        : { ...s, ...extra },
      draggable: false, selected: s.id === focusId, className,
    }
    })
  }, [focusId, focus.parent, highlightId, specs2, liveEditorsOf, childCount, expanded])

  const edges = useMemo(() => {
    const tree = specs2.filter((s) => s.parent).map((s) => {
      const hot = s.id === focusId || s.parent === focusId
      return {
        id: `${s.parent}-${s.id}`, source: s.parent, target: s.id, type: 'smoothstep',
        style: { stroke: hot ? '#268bd2' : '#ded7bf', strokeWidth: hot ? 2 : 1 }, zIndex: hot ? 1 : 0,
      }
    })
    // @@@ reparent preview - a node with a `moved` overlay carrying `toParent` (its proposed new parent)
    // gets a faint dashed arrow node→toParent in the author session's colour, so a human SEES the
    // reparent before it merges. Subtle (low opacity, animated dashes) and never touches a tree edge.
    const moves = []
    for (const s of specs2) {
      const mv = (s.overlays || []).find((o) => o.op === 'moved' && o.toParent && byId[o.toParent])
      if (!mv) continue
      const stroke = labelColor(mv.seed)
      moves.push({
        id: `move-${s.id}-${mv.toParent}`, source: s.id, target: mv.toParent, type: 'smoothstep',
        animated: true, zIndex: 2, className: 'move-edge',
        style: { stroke, strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      })
    }
    return [...tree, ...moves]
  }, [focusId, specs2, byId])

  // camera — tree is fixed; viewpoint flat-pans to centre the focused node.
  const animateView = useCallback((target, dur) => {
    const start = getViewport()
    const t0 = performance.now()
    cancelAnimationFrame(animRef.current)
    const step = (now) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1
      const e = 1 - Math.pow(1 - p, 3)
      setViewport({
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        zoom: start.zoom + (target.zoom - start.zoom) * e,
      })
      if (p < 1) animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
  }, [getViewport, setViewport])

  // @@@ centerOn - recentre on a node. When `zoom` is omitted (the arrow-nav path) the CURRENT zoom is
  // reused, so switching nodes is a pure flat-pan — never a zoom-to-fit. An earlier Van Wijk zoom arc
  // zoomed out then back in to frame each node and made switching "jump too high"; holding zoom constant
  // kills the jump. Explicit zoom is passed only by +/-/0.
  const centerOn = useCallback((node, zoom, dur = 300) => {
    const el = graphRef.current
    if (!el) return
    const z = zoom ?? getViewport().zoom
    animateView({ x: el.clientWidth / 2 - (node.x + NW / 2) * z, y: el.clientHeight / 2 - (node.y + NH / 2) * z, zoom: z }, dur)
  }, [animateView, getViewport])

  // @@@ initial framing - center the root once after first paint. Thereafter the camera FOLLOWS focus
  // (see the follow effect below): because the tree re-plots on every focus change, the camera must move
  // even on a mouse click, else the clicked node would teleport out from under the cursor.
  const framedRef = useRef(false)
  useEffect(() => {
    if (framedRef.current) return
    framedRef.current = true
    const id = requestAnimationFrame(() => centerOn(focus, undefined, 0))
    return () => cancelAnimationFrame(id)
  }, [centerOn, focus])

  // @@@ follow focus - the tree RE-PLOTS on every focus change (expand-on-focus), so the focused node
  // moves; the camera pans to keep it centred while its neighbourhood expands/collapses around it. Both
  // keyboard nav and clicks land here. Fires on focusId ALONE — not on the 4s poll (focus is a fresh
  // object each poll) — reading the latest focus/centerOn through refs. Skips the very first paint, which
  // the initial-framing effect owns.
  const focusRef = useRef(focus); focusRef.current = focus
  const centerRef = useRef(centerOn); centerRef.current = centerOn
  const followedRef = useRef(false)
  useEffect(() => {
    if (!followedRef.current) { followedRef.current = true; return }
    centerRef.current(focusRef.current)
  }, [focusId])

  // @@@ keys - capture phase so we win over react-flow. Graph mode: ←↑↓→ walk the tree, +/-/0 zoom,
  // `i` opens the node-info popup, Enter opens the session interface. A modal (popup or session UI)
  // OWNS the keys while open — arrows no longer leak through to move the board behind it (the old
  // blind-navigation bug); the session interface handles its own list nav / input.
  useEffect(() => {
    const cyclePane = (dir) => setPane((p) => PANE_KEYS[(PANE_KEYS.indexOf(p) + dir + PANE_KEYS.length) % PANE_KEYS.length])
    // nav just moves focus; the follow-focus effect recenters once the tree has re-plotted around the new
    // focus (passing the stale pre-re-plot node straight to centerOn would aim at its OLD coordinates).
    const go = (t, e) => { if (t) { e.preventDefault(); e.stopPropagation(); setFocusId(t.id) } }
    // @@@ bumpScroll - ease the open popup pane toward an accumulating target. A press bumps the target
    // by `delta` (clamped to the scroll range); one rAF loop eases scrollTop toward it (fixed fraction
    // per frame = exponential glide). Repeated/held j/k stack onto the SAME target, so the motion stays
    // one continuous flow. Switching panes swaps the scroller element, which resets the stale target.
    const bumpScroll = (delta) => {
      const sc = document.querySelector('.ov-body .pane-doc, .ov-body .pane-hist, .ov-body .pane-issues')
      if (!sc) return
      if (sc !== scrollElRef.current) { scrollElRef.current = sc; scrollTargetRef.current = null }
      const max = sc.scrollHeight - sc.clientHeight
      const base = scrollTargetRef.current ?? sc.scrollTop
      scrollTargetRef.current = Math.max(0, Math.min(max, base + delta))
      cancelAnimationFrame(scrollAnimRef.current)
      const step = () => {
        const d = scrollTargetRef.current - sc.scrollTop
        if (Math.abs(d) < 0.5) { sc.scrollTop = scrollTargetRef.current; return }
        sc.scrollTop += d * 0.2
        scrollAnimRef.current = requestAnimationFrame(step)
      }
      scrollAnimRef.current = requestAnimationFrame(step)
    }
    const onKey = (e) => {
      // @@@ graph toggle - `t` is the ONE switch between the spec graph and the session graph, and it
      // toggles BOTH ways. It is the only crossing: Esc never switches graphs, and opening a session
      // console leaves `graphView` untouched (you return to the graph you were in). It sits ABOVE the
      // guards below so it still fires while the session graph owns the board — but it is suppressed
      // while a modal/console captures keys, where a `t` is just a keystroke (e.g. typed into an input).
      if (!sessionUI && !overlay && !legend && !settings && !search && (e.key === 't' || e.key === 'T')) {
        e.preventDefault(); e.stopPropagation(); setGraphView((v) => !v); return
      }
      if (graphView) return // the session-graph view owns its remaining keys (drag/click, handled there)
      if (sessionUI) return // the session interface owns ALL its keys (arrows / Enter / typing / Esc)
      // search palette — same modal contract as the help/settings: while open its input OWNS every key
      // (typing the query, ↑/↓/Enter to pick, Esc to close — all in SpecSearch), so we return before any
      // board handler fires. App still catches Esc here too, so it closes even if the input lost focus.
      if (search) {
        if (e.key === 'Escape') { e.preventDefault(); setSearch(false) }
        return
      }
      if (overlay) {
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return }
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cyclePane(e.shiftKey ? -1 : 1); return }
        // ←/→ and h/l cycle the panes (alongside Tab and 1/2) — vim's horizontal hand flips tabs,
        // never moves the board behind. (j/k and ↑/↓ below are the vertical hand: they scroll the open pane.)
        if (e.key === 'ArrowLeft'  || e.key === 'h') { e.preventDefault(); e.stopPropagation(); cyclePane(-1); return }
        if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); e.stopPropagation(); cyclePane(1); return }
        if (/^[1-9]$/.test(e.key) && +e.key <= PANE_KEYS.length) { e.preventDefault(); e.stopPropagation(); setPane(PANE_KEYS[+e.key - 1]); return }
        // Inside the popup, j/k AND ↑/↓ scroll the open pane's content (vim's and the arrow hand both go
        // vertical here) rather than moving the board — only one pane is mounted at a time, so the first
        // overflow:auto descendant of .ov-body is the scroller. In the history pane this scroll also drives
        // the progressive reveal: reaching the end of the open version expands the next (see HistoryPane).
        if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation()
          bumpScroll(e.key === 'j' || e.key === 'ArrowDown' ? 120 : -120)
          return
        }
        // Enter crosses from reading the node to the session board (at the remembered tab). Popup closes behind.
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setOverlay(false); openBoard(); return }
        return // anything else does NOT move the board behind the popup
      }
      // graph mode (no modal open). The help modal (keymap + legend) is itself a modal: while open it
      // OWNS the keys — only `?`/Esc close it, nav never leaks to the board behind. Placed AFTER the
      // sessionUI/overlay guards so those modals are never disturbed; `?` opens it from the board.
      if (legend) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setLegend(false); return }
        return
      }
      if (e.key === '?') { e.preventDefault(); setLegend(true); return }
      // settings modal — same modal contract as the help: while open it OWNS the keys (only `,`/Esc
      // close it), nav never leaks to the board behind. `,` opens it from the board (chosen because it
      // collides with no existing binding — t/?/nav keys/chords are all unaffected).
      if (settings) {
        if (e.key === 'Escape' || e.key === ',') { e.preventDefault(); setSettings(false); return }
        return
      }
      if (e.key === ',') { e.preventDefault(); setSettings(true); return }
      // @@@ Alt+F - open the jump-to-node search palette. Matched on e.code (Alt+F emits a dead-key glyph
      // — `ƒ` on macOS — so e.key is unreliable). Alt is otherwise unbound on the board, and the chord
      // buffer below ignores Alt-modified keys, so this shadows nothing.
      if (e.altKey && e.code === 'KeyF') { e.preventDefault(); e.stopPropagation(); setSearch(true); return }
      // @@@ chord buffer - a small vim-style key buffer for multi-key board commands. A leader letter
      // (n/d) opens a pending buffer; the matching next letter fires the chord (open the session board
      // with its @-directive pre-seeded — see CHORDS/startNew). A non-matching key (or a 700ms lull)
      // clears the buffer and falls through, so the key still acts on its own. Plain letters only:
      // modified keystrokes (⌘/^/⌥) never enter the buffer. Sits ABOVE single-key nav so n/d buffer
      // first, but since neither leader is a nav key, hjkl/i/etc. are never shadowed.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[a-zA-Z]$/.test(e.key)) {
        const cur = chordRef.current
        if (cur.buf || CHORD_LEADERS.has(e.key)) {
          clearTimeout(cur.timer)
          const buf = cur.buf + e.key
          if (CHORDS[buf]) { e.preventDefault(); e.stopPropagation(); chordRef.current = { buf: '', timer: 0 }; startNew(CHORDS[buf](focus.id)); return }
          if (CHORD_KEYS.some((c) => c.startsWith(buf))) {
            e.preventDefault(); e.stopPropagation()
            chordRef.current = { buf, timer: setTimeout(() => { chordRef.current = { buf: '', timer: 0 } }, 700) }
            return
          }
          chordRef.current = { buf: '', timer: 0 }   // dead end → reset, fall through to single-key handling
        }
      }
      // hjkl mirror the arrows for graph nav (vim): k/j up/down the column, h/l to parent/child.
      if (e.key === 'ArrowUp'    || e.key === 'k') return go(upTarget, e)
      if (e.key === 'ArrowDown'  || e.key === 'j') return go(downTarget, e)
      if (e.key === 'ArrowLeft'  || e.key === 'h') return go(parent, e)
      if (e.key === 'ArrowRight' || e.key === 'l') return go(rightTarget, e)
      if (e.key === '=' || e.key === '+') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (e.key === '0') { e.preventDefault(); centerOn(focus, 0.85, 200) }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setOverlay(true) }
      // (`t` toggles the session graph — handled at the top of onKey so it works from either graph.)
      // Enter opens the session board at the remembered tab (boarding switch — see openBoard).
      else if (e.key === 'Enter') { e.preventDefault(); openBoard() }
      // @@@ @-key - the spec-oriented launch shortcut: jump straight to a FRESH New Session targeting the
      // focused node. It always lands on the New tab (never the remembered tab) with `@<focus> ` pre-seeded,
      // so starting a node-scoped session is one keystroke. Unlike Enter (which boards at the remembered tab
      // and resolves live editors), `@` is UNCONDITIONAL — it never jumps into an existing session. Reuses
      // startNew (the chord seed path); the seeded `@<id> ` reads as an accepted @-mention, caret after it.
      else if (e.key === '@') { e.preventDefault(); startNew(`@${focus.id} `) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, sessionUI, legend, settings, graphView, search, focus, upTarget, downTarget, rightTarget, parent, centerOn, getViewport, openBoard, startNew])

  // clicking a node focuses it; the follow-focus effect then re-plots the tree around it and pans the
  // camera to keep it in place (a click drills the same way the arrows do). It does NOT open a session —
  // Enter is the deliberate cross into one.
  const onNodeClick = useCallback((_e, n) => setFocusId(n.id), [])

  // double-click is the mouse parallel to the `i` key: focus the node AND open its info popup.
  // (single click still only focuses without panning; the camera follows the keyboard alone.)
  const onNodeDoubleClick = useCallback((_e, n) => { setFocusId(n.id); setOverlay(true) }, [])

  // clicking a session in the top-right window: toggle highlight of its worktree's overlays (matched
  // by source = worktree path) + jump to its first changed node (only .session-linked sessions carry
  // ops; a bare tmux session has none, so it just toggles selection).
  const onPickSession = useCallback((s) => {
    setHighlightId((cur) => (cur === s.source ? null : s.source))
    const first = s.ops?.[0]
    if (first && byId[first.nodeId]) setFocusId(first.nodeId)
  }, [byId])

  return (
    <div className="app">
      <div className="graph" ref={graphRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesFocusable={false}
          disableKeyboardA11y
          defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
        </ReactFlow>
        {/* HUD is deliberately minimal: brand + a discreet `?` that opens the full keymap/legend modal.
            The wall of inline hints used to live here; it now lives inside that modal (see Legend.jsx). */}
        <div className="hud">
          <span className="brand">$ spec-dashboard</span>
          {/* a discreet floating affordance for the session graph — same view the `t` key opens (now also
              documented in the help modal). The button makes the otherwise hidden hotkey discoverable. */}
          <button className="hud-graph" onClick={() => setGraphView(true)} title={t('hud.graphTitle')}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="3.5" cy="4" r="1.8" /><circle cx="12.5" cy="4" r="1.8" /><circle cx="8" cy="12.5" r="1.8" />
              <path d="M4.9 5.1 L7 11 M11.1 5.1 L9 11 M5 4 H11" />
            </svg>
          </button>
          <button className="hud-help" onClick={() => setLegend((v) => !v)} title={t('hud.helpTitle')}>?</button>
        </div>

        <SessionWindow sessions={sessions} activeId={highlightId} onPick={onPickSession} onOpen={openBoard} onOpenSession={openSession} />

        {legend && <Legend onClose={() => setLegend(false)} />}
        {settings && <Settings onClose={() => setSettings(false)} />}
        {/* search over the WHOLE raw tree (not just visible nodes); picking one focuses it and the
            expand-on-focus follow effect drills its spine open + pans the camera. */}
        {search && <SpecSearch specs={specs} onPick={setFocusId} onClose={() => setSearch(false)} />}
      </div>

      {graphView && <SessionGraph onOpen={openSession} active={!sessionUI} />}
      {overlay && <NodeView node={focus} pane={pane} setPane={setPane} onClose={() => setOverlay(false)} />}
      {/* stays MOUNTED across open/close (hidden via `open`) so the selected tab + per-tab drafts persist. */}
      <SessionInterface
        sessions={sessions}
        specs={specs}
        focusNode={focus}
        open={sessionUI}
        sel={sessionSel}
        setSel={setSessionSel}
        seed={seed}
        onSeedConsumed={() => setSeed(null)}
        onClose={() => setSessionUI(false)}
        onCreated={async (id) => { await reload(); if (id) setSessionSel(id) }}
      />
    </div>
  )
}

// @@@ App - loads the board (merged spec tree + live worktree overlay) and polls it so pending
// changes from other worktrees appear without a refresh. Keeps the last good board across reloads.
export default function App() {
  const t = useT()
  const [board, setBoard] = useState(null)
  const reload = useCallback(() => loadBoard().then(setBoard).catch(() => {}), [])
  useEffect(() => {
    reload()
    const id = setInterval(reload, 4000)
    return () => clearInterval(id)
  }, [reload])
  if (!board) return <div className="loading">{t('hud.loading')}</div>
  return <Dashboard specs={board.nodes} sessions={board.sessions} reload={reload} />
}
