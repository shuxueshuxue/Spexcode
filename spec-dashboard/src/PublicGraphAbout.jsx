import { useEffect, useState, useSyncExternalStore } from 'react'

import { loadPublicGraphMetadata } from './data.js'
import { Icon, IconButton } from './icons.jsx'
import { useEscLayer } from './escStack.js'

const shortRevision = (revision) => revision?.slice(0, 12) || ''

// Whether the panel is open is state the STATUS BAR's project button owns the door to, while the panel
// itself renders here — so the two live in a module store rather than in either component. The published
// page has no project switcher behind that button (there is no hub to switch to, and no backend to list
// one), and a published tree's one ambient fact about itself IS this panel: identity, revision, what the
// surface does and does not carry. So the identity button opens it, and the strip keeps one door instead
// of an identity chip that leads nowhere plus a second "About" chip wedged in beside the tallies.
let aboutOpen = false
const listeners = new Set()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
const read = () => aboutOpen
export const usePublicAboutOpen = () => useSyncExternalStore(subscribe, read, read)
export const togglePublicAbout = () => { aboutOpen = !aboutOpen; emit() }
export const closePublicAbout = () => { if (aboutOpen) { aboutOpen = false; emit() } }

// The public graph's release metadata is a separate static file so the ordinary graph boot remains one
// small index transfer. This reading surface never consults the live dashboard API.
export default function PublicGraphAbout() {
  const open = usePublicAboutOpen()
  const [metadata, setMetadata] = useState(null)
  const [failure, setFailure] = useState(null)

  useEffect(() => {
    if (!open || metadata || failure) return undefined
    let active = true
    loadPublicGraphMetadata()
      .then((next) => { if (active) setMetadata(next) })
      .catch((error) => { if (active) setFailure(error) })
    return () => { active = false }
  }, [open, metadata, failure])

  useEscLayer(open, closePublicAbout)

  if (!open) return null
  const about = metadata?.about
  const publication = metadata?.publication
  const archive = metadata?.release?.archive
  return (
    <aside id="public-graph-about" className="public-about" aria-label="About this public graph">
      <header className="public-about-head">
        <div>
          <p className="public-about-kicker">Read-only Spec Graph</p>
          <h2>{about?.title || 'About'}</h2>
        </div>
        <IconButton icon="x" size={14} className="public-about-close" label="Close about panel" onClick={closePublicAbout} />
      </header>
      {!metadata && !failure && <p className="public-about-status">Loading release information...</p>}
      {failure && <p className="public-about-status public-about-error">Release information is unavailable: {failure.message}</p>}
      {metadata && (
        <>
          <p className="public-about-summary">{about.summary}</p>
          <dl className="public-about-facts">
            {about.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            <div><dt>Revision</dt><dd><code>{shortRevision(metadata.release.revision)}</code></dd></div>
          </dl>
          <div className="public-about-actions">
            {publication.repository?.url && (
              <a className="public-about-link" href={publication.repository.url} target="_blank" rel="noopener noreferrer">
                <Icon name="globe" size={14} /> Repository
              </a>
            )}
            {archive && (
              <a className="public-about-link primary" href={`./${archive.path}`} download={archive.name}>
                <Icon name="download" size={14} /> Download .spec
              </a>
            )}
          </div>
        </>
      )}
      {/* The page says what drew it. A published tree travels to readers who have never seen the tool, with
          no other line on the page naming it — and the panel is the one place that is ABOUT the surface
          rather than about the repository, so the credit belongs here and nowhere else. */}
      <p className="public-about-credit">
        Drawn by <a href="https://spexcode.net" target="_blank" rel="noopener noreferrer">SpexCode</a> — specs that govern code
      </p>
    </aside>
  )
}
