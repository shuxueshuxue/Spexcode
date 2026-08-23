import { Suspense, lazy, useEffect, useState } from 'react'
import { TransientNoticeProvider } from './TransientNotice.jsx'
import { StatusBarProvider } from './StatusBar.jsx'
import { DocumentActionProvider } from './documentActions.jsx'
import { useRoute } from './route.js'
import { useT } from './i18n/index.jsx'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'
import { BackendStatusFrame } from './BackendStatus.jsx'
import ReviewSurface from './ReviewSurface.jsx'
import { surfaceFor } from './views.jsx'

const App = lazy(() => import('./App.jsx'))
function RootContent() {
  const t = useT()
  const { page, param, query } = useRoute()
  const surface = surfaceFor(page)
  const coldReviewRoute = surface === 'review'

  const [boardStarted, setBoardStarted] = useState(() => !coldReviewRoute)
  useEffect(() => {
    if (!coldReviewRoute) setBoardStarted(true)
  }, [coldReviewRoute])
  const lightweight = coldReviewRoute && !boardStarted

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
        {lightweight
          ? <ReviewSurface page={page} param={param} query={query} />
          : <App surface={surface} />}
      </Suspense>
    </DocumentActionProvider></StatusBarProvider></TransientNoticeProvider>
  )
}

export default function Root() {
  return <BackendStatusFrame><RootContent /></BackendStatusFrame>
}
