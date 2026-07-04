import { useEffect, useState } from 'react'
import { useT } from './i18n/index.jsx'

// The ONE evidence renderer ([[event-detail]], U1): a content-addressed blob → the right media element,
// identical in EVERY home evidence appears — the node eval tab's gallery ([[yatsu-eval-tab]]), the eval
// detail's stage ([[event-detail]] — whose annotate-a-loop CLIP player is the one deliberate
// specialization; everything else on the stage renders here), and an issue/eval reply's inline links
// ([[issues-view]]'s Thread). A typed entry ({hash, kind, state}) renders via EvidenceItem; a BARE hash
// (a thread body's blob link — the body carries no kind) renders via BlobMedia, which resolves the kind
// from the Content-Type the blob route already serves (one sniff at the server, [[video-evidence]] —
// the client never grows a parallel magic-number table, and the reply schema never grows a type field).

const blobUrl = (hash) => `/api/yatsu/blob/${hash}`

// click-to-enlarge for an evidence image: a fixed overlay showing the same blob at viewport size —
// click anywhere or Esc closes; Esc is swallowed in capture so the page's own Esc stack never fires.
export function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt={alt} />
    </div>
  )
}

export function Transcript({ hash }) {
  const t = useT()
  const [text, setText] = useState(null)
  useEffect(() => {
    let live = true
    fetch(blobUrl(hash))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('miss'))))
      .then((tx) => { if (live) setText(tx) })
      .catch(() => { if (live) setText('') })
    return () => { live = false }
  }, [hash])
  if (text === null) return <pre className="eval-transcript loading">{t('nodeView.eval.loadingTranscript')}</pre>
  return <pre className="eval-transcript">{text}</pre>
}

// an evidence image owns its own enlarge loop — every home gets click-to-zoom without holding zoom state.
function EvidenceImage({ hash, alt }) {
  const [zoom, setZoom] = useState(false)
  return (
    <>
      <img className="an-image" src={blobUrl(hash)} alt={alt} loading="lazy" onClick={() => setZoom(true)} />
      {zoom && <ImageLightbox src={blobUrl(hash)} alt={alt} onClose={() => setZoom(false)} />}
    </>
  )
}

// one evidence entry rendered by its kind — a transcript pulls its text, a video plays inline, an image
// shows (click-to-enlarge); a pruned entry (state 'miss') is the honest sentinel, never a broken media box.
export function EvidenceItem({ e, alt = '' }) {
  const t = useT()
  if (e.state === 'miss') return <div className="eval-noimg">{t('nodeView.eval.miss')}</div>
  if (e.kind === 'transcript') return <Transcript hash={e.hash} />
  if (e.kind === 'video') return <video className="eval-video" src={blobUrl(e.hash)} controls preload="metadata" playsInline />
  return <EvidenceImage hash={e.hash} alt={alt} />
}

// a BARE hash's kind, resolved from the Content-Type the blob route serves (a 1-byte ranged GET — the
// server's sniff is the one source; hashes are content-addressed, so the answer caches forever).
const kindCache = new Map()
function useBlobKind(hash) {
  const [known, setKnown] = useState(() => kindCache.get(hash) ?? null)
  useEffect(() => {
    if (kindCache.has(hash)) { setKnown(kindCache.get(hash)); return }
    let live = true
    fetch(blobUrl(hash), { headers: { Range: 'bytes=0-0' } })
      .then((r) => {
        const ct = r.headers.get('content-type') || ''
        const k = !r.ok ? { kind: 'image', state: 'miss' }
          : { kind: ct.startsWith('video/') ? 'video' : ct.startsWith('image/') ? 'image' : 'transcript', state: 'present' }
        kindCache.set(hash, k)
        if (live) setKnown(k)
      })
      .catch(() => { if (live) setKnown({ kind: 'image', state: 'miss' }) })
    return () => { live = false }
  }, [hash])
  return known
}

// a blob referenced by hash alone (a reply body's `![…](/api/yatsu/blob/<hash>)` link): sniff, then render
// through the same EvidenceItem — a video plays, an image shows, wherever the link appears.
export function BlobMedia({ hash, alt = '' }) {
  const known = useBlobKind(hash)
  if (!known) return null
  return <EvidenceItem e={{ hash, ...known }} alt={alt} />
}
