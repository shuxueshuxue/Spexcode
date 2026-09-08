import { useEffect, useState } from 'react'
import { ContextMenu, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator } from './ContextMenu.jsx'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'
import { copyAddress, copyText, graphNodeAddress, hashAddress, navigateAddress, specAddress } from './address.js'
import { routeHash } from './route.js'
import { openNewTab } from './tabs.js'
import { shortcutHint } from './bindings.js'

// [[file-tree]]'s row menu — one menu for every SUBJECT the explorer lists, not one per projection. A spec
// node offers the same verbs whether you right-click it on the graph ([[node-graph]]'s node menu) or in the
// tree; a file offers the same verbs whether the spec tree revealed it as governed/attached or the disk tree
// listed it. The gesture that already existed — ⌘/ctrl-click to open a row in a new tab — was
// discoverable only to a reader who already knew it, which is exactly what a right-click is for.
//
// The menu prints each command's CURRENT binding beside it ([[keyboard-nav]]'s hint reader), so the menu is
// where the keyboard is learned rather than a substitute for it.
export default function ExplorerContextMenu({ menu, onClose, owningNodeOf }) {
  const t = useT()
  const [copyState, setCopyState] = useState(null)

  // Standard dismissal, identical to the session-row and spec-node menus: any click outside closes; a
  // right-click anywhere closes in the CAPTURE phase so re-aiming at another row closes the old menu first.
  useEffect(() => {
    if (!menu) return undefined
    window.addEventListener('click', onClose)
    window.addEventListener('contextmenu', onClose, true)
    return () => {
      window.removeEventListener('click', onClose)
      window.removeEventListener('contextmenu', onClose, true)
    }
  }, [menu, onClose])

  useEscLayer(!!menu, onClose)
  useEffect(() => { setCopyState(null) }, [menu])
  useEffect(() => {
    if (!copyState) return undefined
    const id = setTimeout(onClose, 900)
    return () => clearTimeout(id)
  }, [copyState, onClose])

  if (!menu) return null

  // Ordinary actions close BEFORE they run: the action navigates or mints a tab, and the menu must not
  // linger over the surface it just opened.
  const act = (fn) => (event) => { event.stopPropagation(); onClose(); fn() }
  const copy = (make) => async (event) => {
    event.stopPropagation()
    setCopyState((await make()) ? 'copied' : 'failed')
  }
  const copyLabel = (fallback) => (copyState ? t(`explorerMenu.${copyState}`) : t(fallback))
  const newTabHint = shortcutHint('explorer.openInNewTab')
  const owner = menu.kind === 'file' ? owningNodeOf?.(menu.path) : null

  return (
    <ContextMenu x={menu.x} y={menu.y} anchorKey={menu.key} keyboard={menu.keyboard}
      label={t(menu.kind === 'node' ? 'explorerMenu.nodeLabel' : 'explorerMenu.fileLabel')}>
      {menu.kind === 'node' && (
        <>
          <ContextMenuGroup>
            <ContextMenuItem icon="plus" hint={newTabHint} onClick={act(() => openNewTab('spec', menu.id))}>
              {t('tabs.openInNewTab')}
            </ContextMenuItem>
            <ContextMenuItem icon="graph" onClick={act(() => navigateAddress(graphNodeAddress(menu.id)))}>
              {t('explorerMenu.revealOnGraph')}
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem icon="copy" onClick={copy(() => copyAddress(specAddress(menu.id)))}>
              {copyLabel('explorerMenu.copyLink')}
            </ContextMenuItem>
            <ContextMenuItem icon="copy" onClick={copy(() => copyText(menu.id))}>
              {copyLabel('explorerMenu.copyNodeId')}
            </ContextMenuItem>
          </ContextMenuGroup>
        </>
      )}
      {menu.kind === 'file' && (
        <>
          <ContextMenuGroup>
            <ContextMenuItem icon="plus" hint={newTabHint} onClick={act(() => openNewTab('file', menu.path))}>
              {t('tabs.openInNewTab')}
            </ContextMenuItem>
            {/* Only a path some node actually claims can be revealed; an unclaimed file has no node to open. */}
            {owner && (
              <ContextMenuItem icon="node" onClick={act(() => navigateAddress(specAddress(owner)))}>
                {t('explorerMenu.revealOwner')}
              </ContextMenuItem>
            )}
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem icon="copy" onClick={copy(() => copyAddress(hashAddress(routeHash('file', menu.path))))}>
              {copyLabel('explorerMenu.copyLink')}
            </ContextMenuItem>
            <ContextMenuItem icon="copy" onClick={copy(() => copyText(menu.path))}>
              {copyLabel('explorerMenu.copyPath')}
            </ContextMenuItem>
          </ContextMenuGroup>
        </>
      )}
      {menu.kind === 'dir' && (
        <ContextMenuGroup>
          <ContextMenuItem icon="copy" onClick={copy(() => copyText(menu.path))}>
            {copyLabel('explorerMenu.copyPath')}
          </ContextMenuItem>
        </ContextMenuGroup>
      )}
    </ContextMenu>
  )
}
