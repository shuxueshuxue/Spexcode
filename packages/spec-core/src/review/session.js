export const sessionPresent = (sessions, id) => {
  const session = id ? (sessions || []).find((item) => item.id === id) : null
  return session || null
}

export const sessionHeadline = (session) =>
  session?.title || session?.headline || session?.name || session?.activity || session?.note
  || session?.promptPreview || session?.raw?.title || session?.branch || session?.id

export const sessionHandle = (session) =>
  session?.label || session?.name || session?.title || session?.branch || session?.id

export const sessionTitle = sessionHeadline
