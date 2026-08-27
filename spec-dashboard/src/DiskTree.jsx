import { useEffect, useState } from 'react'
import { fetchDirEntries } from './data.js'
import { navigate, routeHash } from './route.js'
import { newTabAnchor } from './tabs.js'
import { useT } from './i18n/index.jsx'

// [[disk-tree]]: the explorer's ORDINARY-FILE projection. [[file-tree]] above it navigates the project the
// way the SPEC tree is shaped — a node is a folder, a governed file hangs off the node that claims it — and
// that is the right shape for the work this product is about. It is the wrong shape for the other thing a
// reader does constantly, which is open a file they know the location of: a path only exists there if some
// node happens to claim it, so the reader has to know which node that is before they can find the file.
//
// So this is the disk, listed as the disk ([[source-list]]): governed roots at the top, real directories
// under them, one level fetched per expand. Nothing here re-derives the spec graph and nothing there
// re-derives the filesystem — two projections of the same project, each honest about which one it is.

// A branch fetches ONCE, on the expand that reveals it, and keeps what it got. Re-opening a branch is then
// instant, and a reader who never opens one never pays for its listing — the same bargain the node tree's
// attachments make. A failed listing is HELD as the failure it was, so a branch that cannot be read says so
// instead of looking like a folder with nothing in it.
function useBranch(path, open) {
  const [state, setState] = useState(null)   // null = never asked; { entries, truncated } | { error }
  useEffect(() => {
    if (!open || state) return undefined
    let live = true
    fetchDirEntries(path)
      .then((result) => live && setState(result))
      .catch((err) => live && setState({ error: err instanceof Error ? err.message : String(err) }))
    return () => { live = false }
  }, [open, state, path])
  return state
}

function Dir({ entry, depth }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const branch = useBranch(entry.path, open)
  return (
    <>
      {/* A DIRECTORY ONLY DISCLOSES. It names no document — there is no `#/dir/<path>` and there should not
          be one — so clicking it opens the branch and nothing else. The node tree's rows do both because a
          node IS a document; a folder is not, and giving it a navigation would be inventing an address for
          something that has nothing to show. */}
      {/* the row menu reads its subject off the row ([[file-tree]]'s one explorer seam), so a folder offers
          exactly the one verb it has and never grows a handler of its own. */}
      <button type="button" className="ft-row ft-dir" style={{ paddingLeft: 6 + depth * 11 }}
        aria-expanded={open} data-tip={entry.path} data-menu-kind="dir" data-menu-path={entry.path}
        onClick={() => setOpen((v) => !v)}>
        <span className="ft-caret">{open ? '▾' : '▸'}</span>
        <span className="ft-label">{entry.name}</span>
      </button>
      {open && <Branch state={branch} depth={depth + 1} loading={t('diskTree.loading')} />}
    </>
  )
}

// A FILE IS A DOCUMENT, so its row is a real anchor on the workspace's tab semantics ([[tab-strip]]):
// plain click reads it in the focused tab, ctrl/⌘ opens it in a new tab. Same gesture, same helper, and
// the same address the node tree's governed-file rows open — one file has one address however it was found.
function FileRow({ entry, depth }) {
  const href = routeHash('file', entry.path)
  return (
    <a className="ft-row ft-code" style={{ paddingLeft: 6 + depth * 11 }} href={href} data-tip={entry.path}
      data-menu-kind="file" data-menu-path={entry.path}
      onClick={(event) => newTabAnchor(event, href)}
      onDoubleClick={(event) => { event.preventDefault(); navigate('file', entry.path) }}>
      <span className="ft-caret" />
      <span className="ft-label">{entry.name}</span>
    </a>
  )
}

function Branch({ state, depth, loading }) {
  if (!state) return <div className="ft-note" style={{ paddingLeft: 6 + depth * 11 }}>{loading}</div>
  if (state.error) return <div className="ft-note ft-note-error" style={{ paddingLeft: 6 + depth * 11 }}>{state.error}</div>
  return (
    <>
      {state.entries.map((entry) => (entry.kind === 'dir'
        ? <Dir key={entry.path} entry={entry} depth={depth} />
        : <FileRow key={entry.path} entry={entry} depth={depth} />))}
      {/* the cap, said out loud. A client that cannot tell "this is everything" from "this is the first
          500" shows the reader a lie, which is why the endpoint reports it rather than clipping silently. */}
      {state.truncated && <div className="ft-note" style={{ paddingLeft: 6 + depth * 11 }}>…</div>}
    </>
  )
}

export default function DiskTree() {
  const t = useT()
  const branch = useBranch('', true)
  return <div className="ft-files">
    <Branch state={branch} depth={0} loading={t('diskTree.loading')} />
  </div>
}
