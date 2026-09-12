import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { apiUrl } from './project.js'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { SessionWidgetsContext, resolveWidgetRef, widgetDocument, widgetThemeStyle } from './widgetRefs.js'

// Every live frame registers the object its document reaches through `window.spex`. The frame is
// same-origin, so the injected line takes the object straight from the parent: no message protocol to
// version, and the state is already there when the widget's first line of script runs.
const bridges = new Map()
let nextInstance = 0
if (typeof window !== 'undefined') window.__spexWidget = (instance) => bridges.get(instance) || null

const MAX_FRAME_HEIGHT = 520

// One widget renders once per conversation: the LAST place its name appears is the live frame, and every
// earlier mention is a link to it. Position is read from the document rather than from render order, so a
// re-render that reorders items cannot leave two live frames behind.
function useIsLastMention(name, ref, stamp) {
  const [isLast, setIsLast] = useState(true)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const all = [...document.querySelectorAll(`[data-widget-name="${CSS.escape(name)}"]`)]
    setIsLast(all.length === 0 || all[all.length - 1] === node)
  }, [name, ref, stamp])
  return isLast
}

export function WidgetRef({ name }) {
  const t = useT()
  const scope = useContext(SessionWidgetsContext)
  const ref = useRef(null)
  const widget = resolveWidgetRef(name, scope?.widgets)
  const isLast = useIsLastMention(name, ref, `${scope?.widgets?.length ?? 0}:${widget?.body ?? ''}`)

  if (!scope || !widget) {
    return <span className="doc-widget-ref is-unresolved" data-tip={t('widget.missing')}>
      <Icon name="list-checks" size={12} />{name}
    </span>
  }
  if (!isLast) {
    return <a ref={ref} className="doc-widget-ref" data-widget-name={name} href={`#widget-${name}`}
      data-tip={t('widget.olderMention')}
      onClick={(event) => { event.preventDefault(); document.querySelector(`.wg[data-widget-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}>
      <Icon name="list-checks" size={12} />{name}
    </a>
  }
  return <WidgetFrame nodeRef={ref} widget={widget} scope={scope} />
}

function WidgetFrame({ nodeRef, widget, scope }) {
  const t = useT()
  const [body, setBody] = useState(null)
  const [error, setError] = useState(null)
  const [height, setHeight] = useState(96)
  const instance = useMemo(() => `w${nextInstance++}`, [])
  const draft = scope.drafts?.[widget.name] || null
  const reloadKey = scope.reloads?.[widget.name] || 0
  const pending = useRef({ text: draft?.text || '', state: widget.state ?? null })

  // The body is content-addressed, so its bytes are fetched once per version and the browser's own cache
  // answers a re-render. A missing blob is reported in the frame's place, never as an empty component.
  useEffect(() => {
    let live = true
    setBody(null); setError(null)
    fetch(apiUrl(`/api/evidence/${widget.body}`))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((text) => { if (live) setBody(text) })
      .catch((err) => { if (live) setError(err.message || String(err)) })
    return () => { live = false }
  }, [widget.body])

  useEffect(() => {
    pending.current = { text: draft?.text || '', state: draft?.state ?? widget.state ?? null }
  }, [draft, widget.state])

  useLayoutEffect(() => {
    bridges.set(instance, {
      name: widget.name,
      session: scope.sessionId,
      api: apiUrl('/api'),
      state: widget.state ?? null,
      draft(text, state) {
        pending.current = { text: String(text ?? ''), state: state === undefined ? pending.current.state : state }
        scope.onDraft?.(widget.name, pending.current.text, pending.current.state)
      },
      save(state) {
        pending.current = { ...pending.current, state }
        scope.onDraft?.(widget.name, pending.current.text, state)
      },
      // the frame's own observer calls this ([[widgets]]); a widget author never has to
      resize(px) { setHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(48, Math.ceil(px) || 48))) },
    })
    return () => { bridges.delete(instance) }
  }, [instance, widget.name, widget.state, scope])

  // The palette's own `color-scheme` is read from the root rather than guessed from the theme's NAME: the
  // presets are called notion, gruvbox, dracula, and which of them are light is not in their names. The theme
  // is applied by writing an attribute on <html>, which React never sees, and it can land AFTER this frame's
  // first render — so the attribute itself is watched, and the document is rebuilt in the palette that is
  // actually on the page.
  const [theme, setTheme] = useState(() => (typeof document === 'undefined' ? '' : document.documentElement.dataset.theme || ''))
  useEffect(() => {
    const root = document.documentElement
    setTheme(root.dataset.theme || '')
    if (typeof MutationObserver === 'undefined') return undefined
    const observer = new MutationObserver(() => setTheme(root.dataset.theme || ''))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  const srcDoc = useMemo(() => {
    if (body == null) return null
    return widgetDocument({
      body,
      instance,
      theme: widgetThemeStyle(),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    })
  }, [body, instance, theme])

  return <span className="wg" ref={nodeRef} data-widget-name={widget.name} id={`widget-${widget.name}`}>
    <span className="wg-head">
      <Icon name="list-checks" size={12} />
      <span className="wg-name">{widget.name}</span>
      {draft && <span className="wg-pending">{t('widget.pending')}</span>}
      {draft && <span className="wg-actions">
        <button type="button" className="wg-btn" onClick={() => scope.onSend?.()}>{t('widget.send')}</button>
        <button type="button" className="wg-btn" onClick={() => scope.onRemoveDraft?.(widget.name)}>{t('widget.discard')}</button>
      </span>}
    </span>
    {error
      ? <span className="wg-error">{t('widget.bodyMissing', { reason: error })}</span>
      : srcDoc == null
        ? <span className="wg-loading" />
        : <iframe key={reloadKey} className="wg-frame" title={widget.name} srcDoc={srcDoc} style={{ height }} />}
  </span>
}

export default WidgetRef
