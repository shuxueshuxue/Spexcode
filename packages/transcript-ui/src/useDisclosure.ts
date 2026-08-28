import { useCallback, useState } from 'react'

// one disclosure set per rendered payload: what the reader opened stays open across live refreshes of the
// same interval, because ids are the transcript's own (tool ids, turn ids), not render positions
export function useDisclosure(): [ReadonlySet<string>, (id: string) => void] {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback((id: string) => setOpenIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])
  return [openIds, toggle]
}
