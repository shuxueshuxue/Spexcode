import { useEffect, useState } from 'react'

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
