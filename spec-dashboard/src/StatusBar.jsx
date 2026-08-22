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

const StatusContext = createContext(null)
const HIDDEN_KEY = 'spexcode.statusHidden'

const readHidden = () => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')) } catch { return new Set() }
}

// Higher priority moves an item LEFT within its own group — toward the outer edge on the left, toward the
// centre on the right (that group is reversed). Ties break on a hash of the id rather than on arrival, so
// the bar is a pure function of what is registered.
const order = (a, b) => (b.priority - a.priority) || (hash(b.id) - hash(a.id)) || (a.id < b.id ? -1 : 1)

export function StatusBarProvider({ children }) {
  const [items, setItems] = useState(() => new Map())
  const [hidden, setHidden] = useState(readHidden)

  const register = useCallback((item) => {
    setItems((prev) => new Map(prev).set(item.id, item))
  }, [])
  const dispose = useCallback((id) => {
    setItems((prev) => { const next = new Map(prev); next.delete(id); return next })
  }, [])
  const toggleHidden = useCallback((id) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }, [])

  const value = useMemo(() => ({ items, hidden, register, dispose, toggleHidden }), [items, hidden, register, dispose, toggleHidden])
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

// Register one item for as long as the caller is mounted. The item is re-registered whenever its own fields
// change, so a contributor updates by re-rendering — there is no imperative update handle to keep in sync
// with React's own. Outside a provider this is a no-op, which is what keeps the phone face and the static
// public build from needing a bar they do not draw.
export function useStatusItem(item) {
  const ctx = useContext(StatusContext)
  const { id } = item || {}
  const latest = useRef(item)
  latest.current = item
  // the fields that change the RENDERED item; a new `node` element each paint must not re-register.
  const key = item ? `${item.id}|${item.side}|${item.priority}|${item.kind ?? ''}|${item.text ?? ''}|${item.tooltip ?? ''}` : null
  useEffect(() => {
    if (!ctx || !id) return undefined
    ctx.register(latest.current)
    return () => ctx.dispose(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, id, key])
}

function StatusItem({ item, hidden, onToggleHidden }) {
  const t = useT()
  const cls = `sb-item${item.kind && item.kind !== 'standard' ? ` sb-${item.kind}` : ''}${item.onClick ? ' sb-act' : ''}`
  const body = item.node ?? item.text
  const common = {
    className: cls,
    'data-tip': item.tooltip || undefined,
    // right-click hides — the user owns visibility, and the contributor is never asked.
    onContextMenu: (e) => { e.preventDefault(); onToggleHidden(item.id) },
    title: hidden ? t('statusBar.hidden') : undefined,
  }
  return item.onClick
    ? <button type="button" {...common} onClick={item.onClick}>{body}</button>
    : <span {...common}>{body}</span>
}

export default function StatusBar() {
  const ctx = useContext(StatusContext)
  const t = useT()
  if (!ctx) return null
  const all = [...ctx.items.values()].filter((i) => !ctx.hidden.has(i.id))
  const left = all.filter((i) => i.side !== 'right').sort(order)
  const right = all.filter((i) => i.side === 'right').sort(order)
  const hiddenCount = ctx.items.size - all.length
  return (
    <footer className="statusbar" role="status">
      <div className="sb-group sb-left">
        {left.map((i) => <StatusItem key={i.id} item={i} onToggleHidden={ctx.toggleHidden} />)}
      </div>
      <div className="sb-group sb-right">
        {right.map((i) => <StatusItem key={i.id} item={i} onToggleHidden={ctx.toggleHidden} />)}
        {hiddenCount > 0 && (
          <button type="button" className="sb-item sb-restore" data-tip={t('statusBar.restore')}
            onClick={() => [...ctx.items.keys()].filter((id) => ctx.hidden.has(id)).forEach(ctx.toggleHidden)}>
            +{hiddenCount}
          </button>
        )}
      </div>
    </footer>
  )
}
