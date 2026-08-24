import { Suspense, lazy } from 'react'
import { TransientNoticeProvider } from './TransientNotice.jsx'
import { StatusBarProvider } from './StatusBar.jsx'
import { DocumentActionProvider } from './documentActions.jsx'
import { useT } from './i18n/index.jsx'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'
import { BackendStatusFrame } from './BackendStatus.jsx'

const App = lazy(() => import('./App.jsx'))
function RootContent() {
  const t = useT()

  // The public artifact has one face only. It must bypass the live review fast-path as well as the
  // normal App router, otherwise a direct #/issues or #/evals URL would wake a review transport before
  // App can normalize it back to the graph.
  if (PUBLIC_GRAPH_ONLY) {
    return (
      <TransientNoticeProvider><StatusBarProvider><DocumentActionProvider>
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}><App /></Suspense>
      </DocumentActionProvider></StatusBarProvider></TransientNoticeProvider>
    )
  }

  return (
    <TransientNoticeProvider><StatusBarProvider><DocumentActionProvider>
      <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
        <App />
      </Suspense>
    </DocumentActionProvider></StatusBarProvider></TransientNoticeProvider>
  )
}

export default function Root() {
  return <BackendStatusFrame><RootContent /></BackendStatusFrame>
}
