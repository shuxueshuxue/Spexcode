import { useEffect, useState } from 'react'

// @@@ useIsMobile - the ONE switch that decides which interface App renders. A phone gets the touch-first
// MobileApp (drill-down list + tabs); anything wider keeps the desktop board (the React Flow canvas + its
// keyboard/mouse model, which a thumb can't drive). A media query, not a user-agent sniff: it's honest
// about the constraint that matters (viewport width) and flips live when the window crosses the breakpoint
// (rotate / resize), so the same tab can move between the two without a reload.
const MOBILE_Q = '(max-width: 640px)'

export function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_Q).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_Q)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
