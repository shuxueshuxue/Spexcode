import { Suspense, lazy, useEffect, useState } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import { navigate, useRoute } from './route.js'
import { useT } from './i18n/index.jsx'
import { useIsMobile } from './useIsMobile.js'

const App = lazy(() => import('./App.jsx'))
const EvalsPage = lazy(() => import('./EvalsPage.jsx'))
const MobileApp = lazy(() => import('./MobileApp.jsx'))

function focusNode(id) {
  try { sessionStorage.setItem('spex.focus', id) } catch { /* unavailable storage does not block navigation */ }
  navigate('graph')
}

const openSession = (id) => navigate('sessions', id)

function EvalEntry() {
  const isMobile = useIsMobile()
  const t = useT()
  const loading = <div className="loading">{t('hud.loading')}</div>

  if (isMobile) {
    return (
      <Suspense fallback={loading}>
        <MobileApp specs={[]} sessions={[]} />
      </Suspense>
    )
  }

  return (
    <div className="app">
      <TooltipLayer />
      <SideBar page="evals" identity={null} catalog={null} />
      <div className="app-main">
        <div className="page-pane page-evals">
          <Suspense fallback={loading}>
            <EvalsPage onOpenSession={openSession} onFocusNode={focusNode} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default function Root() {
  const t = useT()
  const { page, param } = useRoute()
  const directEvalDetail = page === 'evals' && !!param
  // @@@ cold-entry latch - only a tab born on a detail may bypass App; once the board starts, its warm
  // graph/session state survives every later route change exactly as it did before this outer selector.
  const [boardStarted, setBoardStarted] = useState(() => !directEvalDetail)
  useEffect(() => {
    if (!directEvalDetail) setBoardStarted(true)
  }, [directEvalDetail])
  const lightweight = directEvalDetail && !boardStarted

  return (
    <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
      {lightweight ? <EvalEntry /> : <App />}
    </Suspense>
  )
}
