import { SessionTerminal, isTerminalPointerReport, isTerminalFocusReport, stripTerminalFocusReports, stripTerminalButtonReports, stripTerminalPointerReports } from '@spexcode/terminal-ui'
import '@xterm/xterm/css/xterm.css'
import { createResilientSocket } from './resilientSocket.js'
import { apiUrl } from './project.js'
import { getTerminalFontSize, subscribeTerminalFontSize } from './terminalFont.js'
import { useT } from './i18n/index.jsx'

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

export default function SessionTerm({ sessionId, active = true, focused = active, writable = true, resumeRequired = false, focusRequest = 0 }) {
  const t = useT()
  return <SessionTerminal
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
