import { SessionTerminal, isTerminalPointerReport, isTerminalFocusReport, stripTerminalFocusReports, stripTerminalButtonReports, stripTerminalPointerReports } from '@spexcode/terminal-ui'
import '@xterm/xterm/css/xterm.css'
import { createResilientSocket } from './resilientSocket.js'
import { apiUrl } from './project.js'
import { getTerminalFontSize, subscribeTerminalFontSize } from './terminalFont.js'
import { useT } from './i18n/index.jsx'
import { useBoard } from './workspace.jsx'
import { MENTION_RE } from './mentions.jsx'
import { navigate, routeHash } from './route.js'
import { newTabAnchor } from './tabs.js'

export { isTerminalPointerReport, isTerminalFocusReport, stripTerminalFocusReports, stripTerminalButtonReports, stripTerminalPointerReports }

function dashboardTransport() {
  return {
    connect(id) {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${proto}://${location.host}${apiUrl(`/api/sessions/${id}/socket`)}`
      const dataListeners = new Set()
      const stateListeners = new Set()
      const openListeners = new Set()
      const socket = createResilientSocket({
        url,
        onState: (state) => stateListeners.forEach((listener) => listener(state)),
        onOpen: () => openListeners.forEach((listener) => listener()),
        onMessage: (event) => dataListeners.forEach((listener) => listener(event.data)),
      })
      return {
        send(data) { return socket.send(data) },
        resize(cols, rows) { return socket.send(JSON.stringify({ t: 'resize', cols, rows })) },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener) },
        onState(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener) },
        onOpen(listener) { openListeners.add(listener); return () => openListeners.delete(listener) },
        isOpen() { return socket.isOpen() },
        close() { socket.close() },
      }
    },
  }
}

// THE PANE'S BINDING of the one `[[node]]` grammar ([[mentions]]). The transcript already turns a
// reference an agent wrote into a document anchor; the live pane is the same session read raw, so the
// same reference must be the same door there — the pane is a fallback view, never a weaker one.
//
// It is a screen read, so it is deliberately narrow: only an id that resolves to a node ON THIS BOARD
// becomes a link. A `[[...]]` inside a diff, a code block, or a quoted prompt therefore stays plain text
// unless it names something real, which is the same rule `expandMentions` and `matchSpecs` already keep.
export const findSpecLinks = (specs) => (line) => {
  const hits = []
  for (const match of line.matchAll(MENTION_RE)) {
    if (!specs.some((node) => node.id === match[1])) continue
    hits.push({ start: match.index, end: match.index + match[0].length, text: match[1] })
  }
  return hits
}

export default function SessionTerm({ sessionId, active = true, focused = active, writable = true, resumeRequired = false, focusRequest = 0 }) {
  const t = useT()
  const { specs = [] } = useBoard()
  // Same navigation contract as the transcript's anchors: an ordinary activation lands in the resident
  // Spec tab, a hold gesture opens a second document ([[tab-strip]]).
  const openNode = (id, event) => {
    const href = routeHash('spec', id)
    if (newTabAnchor(event, href)) return
    navigate('spec', id)
  }
  return <SessionTerminal
    findLinks={findSpecLinks(specs)}
    onOpenLink={openNode}
    sessionId={sessionId}
    transport={dashboardTransport()}
    active={active}
    focused={focused}
    writable={writable}
    resumeRequired={resumeRequired}
    focusRequest={focusRequest}
    getFontSize={getTerminalFontSize}
    subscribeFontSize={subscribeTerminalFontSize}
    labels={{
      resumeInputTitle: t('session.resumeInputTitle'),
      resumeInputMessage: t('session.resumeInputMessage'),
      cancel: t('common.cancel'),
      resumeInputConfirm: t('session.resumeInputConfirm'),
    }}
  />
}
