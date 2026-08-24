import { useEffect, useState } from 'react'

import { useStatusItem } from './StatusBar.jsx'
import { loadPublicGraphMetadata } from './data.js'
import { Icon, IconButton } from './icons.jsx'
import { useEscLayer } from './escStack.js'

const shortRevision = (revision) => revision?.slice(0, 12) || ''

// The public graph's release metadata is a separate static file so the ordinary graph boot remains one
// small index transfer. This reading surface never consults the live dashboard API.
export default function PublicGraphAbout() {
  const [open, setOpen] = useState(false)
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

  useEscLayer(open, () => setOpen(false))

  const about = metadata?.about
  const publication = metadata?.publication
  const archive = metadata?.release?.archive
  // A persistent, always-available disclosure is a status-bar item, not a floating corner block. It kept
  // the same bottom-right corner it always had, but now it shares the strip's ordering and can be hidden
  // like any other item instead of being a fixture the reader cannot dismiss.
  useStatusItem({
    id: 'public-about',
    side: 'right',
    priority: 10,
    node: (
    <span className="public-about-shell">
      <button type="button" className="public-about-trigger" onClick={() => setOpen((value) => !value)}
        aria-label="About this public graph" aria-expanded={open} aria-controls="public-graph-about" title="About this public graph">
        <Icon name="info" size={16} />
        <span>About</span>
      </button>
      {open && (
        <aside id="public-graph-about" className="public-about" aria-label="About this public graph">
          <header className="public-about-head">
            <div>
              <p className="public-about-kicker">Read-only Spec Graph</p>
              <h2>{about?.title || 'About'}</h2>
            </div>
            <IconButton icon="x" size={14} className="public-about-close" label="Close about panel" onClick={() => setOpen(false)} />
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
                <a className="public-about-link primary" href={`./${archive.path}`} download={archive.name}>
                  <Icon name="download" size={14} /> Download .spec
                </a>
              </div>
            </>
          )}
        </aside>
      )}
    </span>
    ),
  })
  return null
}
