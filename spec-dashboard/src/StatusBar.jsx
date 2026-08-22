import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { hash } from './color.js'
import { useT } from './i18n/index.jsx'

// [[status-bar]]: one strip along the bottom, and a REGISTRY rather than a place to hang widgets.
//
// Before this, every persistent readout was its own absolutely-positioned block with its own offsets and
// its own z-index, and the neighbours had to know about each other — the session window reserved a literal
// 112px of height because a stats strip happened to sit under it. That coupling is what a registry removes:
// a contributor declares an item and never learns where the bar is, and the bar reserves its own height
// once, for everyone.
//
// The model is what VS Code, Zed and lualine independently agree on:
//   · TWO ordered arrays, never one flow — left carries workspace state, right carries the focused
//     document's state, and the right group renders outward-in.
//   · an item is DATA plus a handle, never a DOM node someone hands in; `kind` picks the colour so a
//     contributor cannot spend a raw hex (the mistake the node status dots made).
//   · order is a NUMBER with a deterministic tiebreak, never insertion order, so re-registering in a
//     different order can never shuffle the bar.
//   · visibility is a set the USER owns, keyed by id and stored outside the item, so hiding a readout is
//     not a negotiation with whoever contributed it.
//
// @@@ two contexts, not one - the WRITE api is stable forever; the READ state changes on every
// registration. Putting both in one value made the api's identity change whenever any item registered,
// which put every registrant's effect back in the queue, which registered again: an unbounded render loop
// that pinned a core and grew memory for as long as the tab stayed open. A registry whose api identity
// changes with its contents cannot be depended on by the things it registers.

const StatusApi = createContext(null)      // { register, dispose, toggleHidden } — identity never changes
const StatusState = createContext(null)    // { items, hidden } — changes freely; only the bar reads it
const HIDDEN_KEY = 'spexcode.statusHidden'

const readHidden = () => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')) } catch { return new Set() }
}

// Higher priority moves an item LEFT within its own group — toward the outer edge on the left, toward the
// centre on the right (that group is reversed). Ties break on a hash of the id rather than on arrival, so
// the bar is a pure function of what is registered.
const order = (a, b) => (b.priority - a.priority) || (hash(b.id) - hash(a.id)) || (a.id < b.id ? -1 : 1)

// what actually changes the rendered item. A fresh `node` element every paint must not count as a change,
// or the bar would re-render itself for as long as its contributor keeps painting.
const itemKey = (i) => i && `${i.id}|${i.side}|${i.priority}|${i.kind ?? ''}|${typeof i.text === 'string' ? i.text : ''}|${i.tooltip ?? ''}`

export function StatusBarProvider({ children }) {
  const [items, setItems] = useState(() => new Map())
  const [hidden, setHidden] = useState(readHidden)

  const register = useCallback((item) => {
    setItems((prev) => {
      // Identical re-registration is a no-op on the STATE, so a contributor that re-renders does not make
      // the bar re-render. Belt as well as braces: the stable api already stops the loop, and this stops
      // the churn.
      const before = prev.get(item.id)
      if (before && itemKey(before) === itemKey(item) && before.node === item.node && before.onClick === item.onClick) return prev
      return new Map(prev).set(item.id, item)
    })
  }, [])
  const dispose = useCallback((id) => {
    setItems((prev) => (prev.has(id) ? (() => { const next = new Map(prev); next.delete(id); return next })() : prev))
  }, [])
  const toggleHidden = useCallback((id) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }, [])

  // deliberately NOT memoised on items/hidden: these three are stable for the provider's whole life, which
  // is the property every registrant depends on.
  const api = useMemo(() => ({ register, dispose, toggleHidden }), [register, dispose, toggleHidden])
  const state = useMemo(() => ({ items, hidden }), [items, hidden])
  return (
    <StatusApi.Provider value={api}>
      <StatusState.Provider value={state}>{children}</StatusState.Provider>
    </StatusApi.Provider>
  )
}

// Register one item for as long as the caller is mounted. It re-registers only when its own rendered
// fields change — never because some other item registered. Outside a provider this is a no-op, which is
// what keeps the phone face and the static public build from needing a bar they do not draw.
export function useStatusItem(item) {
  const api = useContext(StatusApi)
  const { id } = item || {}
  const latest = useRef(item)
  latest.current = item
  const key = itemKey(item)
  useEffect(() => {
    if (!api || !id) return undefined
    api.register(latest.current)
    return () => api.dispose(id)
  }, [api, id, key])
  // a node-bearing item still needs its node refreshed when the node changes, without the identity churn
  // of putting an element in the dependency list: register again only when the element actually differs.
  const lastNode = useRef(item?.node)
  useEffect(() => {
    if (!api || !id) return
    if (lastNode.current !== latest.current?.node) {
      lastNode.current = latest.current?.node
      api.register(latest.current)
    }
  })
}

function StatusItem({ item, onToggleHidden }) {
  const cls = `sb-item${item.kind && item.kind !== 'standard' ? ` sb-${item.kind}` : ''}${item.onClick ? ' sb-act' : ''}`
  const body = item.node ?? item.text
  const common = {
    className: cls,
    'data-tip': item.tooltip || undefined,
    // right-click hides — the user owns visibility, and the contributor is never asked.
    onContextMenu: (e) => { e.preventDefault(); onToggleHidden(item.id) },
  }
  return item.onClick
    ? <button type="button" {...common} onClick={item.onClick}>{body}</button>
    : <span {...common}>{body}</span>
}

export default function StatusBar() {
  const api = useContext(StatusApi)
  const state = useContext(StatusState)
  const t = useT()
  if (!api || !state) return null
  const all = [...state.items.values()].filter((i) => !state.hidden.has(i.id))
  const left = all.filter((i) => i.side !== 'right').sort(order)
  const right = all.filter((i) => i.side === 'right').sort(order)
  const hiddenCount = state.items.size - all.length
  return (
    <footer className="statusbar" role="status">
      <div className="sb-group sb-left">
        {left.map((i) => <StatusItem key={i.id} item={i} onToggleHidden={api.toggleHidden} />)}
      </div>
      <div className="sb-group sb-right">
        {right.map((i) => <StatusItem key={i.id} item={i} onToggleHidden={api.toggleHidden} />)}
        {hiddenCount > 0 && (
          <button type="button" className="sb-item sb-restore" data-tip={t('statusBar.restore')}
            onClick={() => [...state.items.keys()].filter((id) => state.hidden.has(id)).forEach(api.toggleHidden)}>
            +{hiddenCount}
          </button>
        )}
      </div>
    </footer>
  )
}
