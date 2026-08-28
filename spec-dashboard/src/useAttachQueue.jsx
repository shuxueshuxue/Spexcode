import { useRef, useState } from 'react'
import { Icon, IconButton } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { apiUrl } from './project.js'

// [[file-attach]]'s CLIENT HALF as one hook: every authored composer — the New Session prompt, the terminal
// Command Box, the Conversation footer — attaches a file the same three ways (paste, drop, pick), carries it
// over the one resumable `/api/uploads` stream, and is left holding the file's ABSOLUTE path spliced at its
// caret. The hook owns the per-file rows (name, bytes sent, progress, retry/cancel, the brief `attached`
// fade), the hidden `<input type=file>` its paperclip triggers, and the drop ring; the host only renders
// what it returns and wires the gestures onto its own surface. It used to live inside SessionInterface,
// routed by a `target` string, which is how the Conversation footer came to wear a paperclip that did
// nothing: an attachment path a composer cannot reach is not a shared mechanism.

const SINGLE_UPLOAD_WORKER = 1
const BYTES_PER_KIBIBYTE = 1024
const KIBIBYTES_PER_MEBIBYTE = 1024
const MEBIBYTES_PER_GIBIBYTE = 1024
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * KIBIBYTES_PER_MEBIBYTE
const BYTES_PER_GIBIBYTE = BYTES_PER_MEBIBYTE * MEBIBYTES_PER_GIBIBYTE
let nextAttachmentKey = 0
const attachmentKey = () => globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${++nextAttachmentKey}`

export const formatUploadBytes = (bytes) => {
  if (bytes < BYTES_PER_KIBIBYTE) return `${bytes} B`
  if (bytes < BYTES_PER_MEBIBYTE) return `${Math.round(bytes / BYTES_PER_KIBIBYTE)} KB`
  if (bytes < BYTES_PER_GIBIBYTE) return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`
  return `${(bytes / BYTES_PER_GIBIBYTE).toFixed(2)} GB`
}

const responseError = async (res) => {
  const body = await res.json().catch(() => null)
  return body?.error || `upload failed (HTTP ${res.status})`
}
const validUploadTransfer = (transfer, size) => transfer?.size === size &&
  Number.isSafeInteger(transfer.chunkBytes) && transfer.chunkBytes > 0 &&
  Number.isSafeInteger(transfer.concurrency) && transfer.concurrency > 0 &&
  Number.isSafeInteger(transfer.requestTimeoutMs) && transfer.requestTimeoutMs > 0 &&
  Number.isSafeInteger(transfer.retryLimit) && transfer.retryLimit >= 0 &&
  Number.isSafeInteger(transfer.retryDelayMs) && transfer.retryDelayMs >= 0 &&
  Number.isSafeInteger(transfer.offset) && transfer.offset >= 0 && transfer.offset <= size
const waitForUploadRetry = (delayMs, controller) => new Promise((resolve, reject) => {
  if (controller.signal.aborted) { reject(new Error('upload cancelled')); return }
  const timer = window.setTimeout(() => {
    controller.signal.removeEventListener('abort', abort)
    resolve()
  }, delayMs)
  const abort = () => {
    window.clearTimeout(timer)
    reject(new Error('upload cancelled'))
  }
  controller.signal.addEventListener('abort', abort, { once: true })
})
const uploadFetch = async (url, init, controller, timeoutMs) => {
  const request = new AbortController()
  const abort = () => request.abort()
  controller.signal.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(() => request.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: request.signal })
  } catch (error) {
    if (!controller.signal.aborted && request.signal.aborted) throw new Error('upload request timed out')
    throw error
  } finally {
    window.clearTimeout(timer)
    controller.signal.removeEventListener('abort', abort)
  }
}
const retryTransientUpload = async (run, transfer, controller) => {
  let retries = 0
  for (;;) {
    try {
      return await run()
    } catch (error) {
      if (controller.signal.aborted || retries >= transfer.retryLimit) throw error
      retries += 1
      await waitForUploadRetry(transfer.retryDelayMs, controller)
    }
  }
}

// splice `text` at the caret of the composer's textarea, padding with spaces so it never glues to a
// neighbouring word, then drop the caret after it. The auto-grow effects re-run on the new value. A composer
// that is no longer mounted (a Command Box closed mid-upload) still owns its draft: the path is appended to
// whatever that draft holds now, through the functional setter, rather than clobbering it with a stale copy.
const spliceAtCaret = (inputRef, setValue, text) => {
  const el = inputRef.current
  if (!el) {
    setValue((current) => { const pre = current || ''; return pre + (pre && !/\s$/.test(pre) ? ' ' : '') + text + ' ' })
    return
  }
  const value = el.value
  const start = el.selectionStart
  const end = el.selectionEnd
  const pre = value.slice(0, start)
  const insert = (pre && !/\s$/.test(pre) ? ' ' : '') + text + ' '
  setValue(pre + insert + value.slice(end))
  requestAnimationFrame(() => {
    if (!el.isConnected) return
    el.focus()
    const caret = pre.length + insert.length
    el.setSelectionRange(caret, caret)
  })
}

// `inputRef`/`setValue` name the composer the path lands in; `variant` picks the queue's row styling
// (`new` under the centered launch box, `command` inside a docked composer card); `disabled` (an offline
// or archived session) makes every gesture inert — there is no live machine to carry a file to.
export function useAttachQueue({ inputRef, setValue, variant = 'command', disabled = false }) {
  const t = useT()
  const [rows, setRows] = useState([])
  const [dragging, setDragging] = useState(false)
  const rowsRef = useRef([])
  const controllersRef = useRef(new Map())
  const busyRef = useRef(false)
  const fileRef = useRef(null)
  // the composer the file was attached FROM keeps its path even if the host re-points the hook (a session
  // switch mid-upload): each row captures the splice it will perform when it was queued.
  const spliceRef = useRef(null)
  spliceRef.current = (path) => spliceAtCaret(inputRef, setValue, path)

  const replaceRows = (next) => { rowsRef.current = next; setRows(next) }
  const patchRow = (id, patch) => replaceRows(rowsRef.current.map((item) => item.id === id ? { ...item, ...patch } : item))

  const transferAttachment = async (id, onPolicy = null) => {
    const item = rowsRef.current.find((candidate) => candidate.id === id)
    if (!item || item.phase === 'cancelled') return null
    patchRow(id, { phase: 'uploading', error: null })
    const controller = new AbortController()
    controllersRef.current.set(id, controller)
    try {
      let transferId = item.transferId
      let transfer = null
      if (transferId) {
        const resumed = await fetch(apiUrl(`/api/uploads/${transferId}`), { signal: controller.signal })
        if (resumed.ok) transfer = await resumed.json()
        else if (resumed.status !== 404) throw new Error(await responseError(resumed))
      }
      if (!transfer) {
        const created = await fetch(apiUrl('/api/uploads'), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: item.file.name || 'pasted', size: item.file.size }), signal: controller.signal,
        })
        if (!created.ok) throw new Error(await responseError(created))
        transfer = await created.json()
        transferId = transfer?.id
        if (!transferId) throw new Error('upload did not return a transfer id')
        patchRow(id, { transferId })
      }
      if (!validUploadTransfer(transfer, item.file.size)) throw new Error('upload transfer metadata is invalid')
      onPolicy?.(transfer.concurrency)
      let offset = transfer.offset
      patchRow(id, { offset })
      while (offset < item.file.size) {
        const bytes = item.file.slice(offset, Math.min(item.file.size, offset + transfer.chunkBytes))
        const sent = await retryTransientUpload(async () => {
          const response = await uploadFetch(apiUrl(`/api/uploads/${transferId}`), {
            method: 'PATCH', headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset) }, body: bytes,
          }, controller, transfer.requestTimeoutMs)
          if (response.status >= 500) throw new Error(await responseError(response))
          return response
        }, transfer, controller)
        const next = await sent.json().catch(() => null)
        if (sent.status === 409 && Number.isSafeInteger(next?.offset) && next.offset >= 0 && next.offset <= item.file.size) {
          offset = next.offset
          patchRow(id, { offset })
          continue
        }
        if (!sent.ok) throw new Error(next?.error || `upload failed (HTTP ${sent.status})`)
        if (!Number.isSafeInteger(next?.offset) || next.offset <= offset || next.offset > item.file.size) {
          throw new Error('upload did not advance its committed offset')
        }
        offset = next.offset
        patchRow(id, { offset })
      }
      const completed = await uploadFetch(apiUrl(`/api/uploads/${transferId}/complete`), { method: 'POST' }, controller, transfer.requestTimeoutMs)
      if (!completed.ok) throw new Error(await responseError(completed))
      const result = await completed.json().catch(() => null)
      if (!result?.path) throw new Error('upload did not return a path')
      const latest = rowsRef.current.find((candidate) => candidate.id === id)
      if (latest?.phase === 'cancelled') return null
      item.splice(result.path)
      patchRow(id, { phase: 'complete', offset: item.file.size, path: result.path })
      return transfer.concurrency
    } catch (error) {
      onPolicy?.(null)
      if (controller.signal.aborted) patchRow(id, { phase: 'cancelled', offset: 0, transferId: null, error: null })
      else patchRow(id, { phase: 'failed', error: error instanceof Error ? error.message : String(error) })
    } finally {
      controllersRef.current.delete(id)
    }
    return null
  }
  // The policy's default is one writer; a project may raise it, while every row retains independent resume,
  // retry, and cancellation state. The first transfer reports the policy the rest of the batch runs under.
  const runQueued = async (ids) => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const [first, ...rest] = ids
      let resolvePolicy
      const firstPolicy = new Promise((resolve) => { resolvePolicy = resolve })
      const firstTransfer = first ? transferAttachment(first, resolvePolicy) : Promise.resolve(SINGLE_UPLOAD_WORKER)
      const concurrency = first ? await firstPolicy : SINGLE_UPLOAD_WORKER
      const workerCount = Math.min(Math.max(0, (concurrency || SINGLE_UPLOAD_WORKER) - SINGLE_UPLOAD_WORKER), rest.length)
      if (workerCount === 0) {
        await firstTransfer
        for (const id of rest) await transferAttachment(id)
        return
      }
      let next = 0
      const workers = Array.from({ length: workerCount }, async () => {
        while (next < rest.length) {
          const id = rest[next]
          next += 1
          await transferAttachment(id)
        }
      })
      await Promise.all([firstTransfer, ...workers])
    } finally {
      busyRef.current = false
    }
  }
  const retry = (id) => { if (!busyRef.current) void runQueued([id]) }
  const cancel = async (id) => {
    const item = rowsRef.current.find((candidate) => candidate.id === id)
    if (!item) return
    controllersRef.current.get(id)?.abort()
    if (item.transferId) await fetch(apiUrl(`/api/uploads/${item.transferId}`), { method: 'DELETE' }).catch(() => {})
    patchRow(id, { phase: 'cancelled', offset: 0, transferId: null, error: null })
  }
  const dismiss = (id) => {
    const item = rowsRef.current.find((candidate) => candidate.id === id)
    if (!item) return
    if (item.phase !== 'complete' && item.phase !== 'cancelled') void cancel(id)
    replaceRows(rowsRef.current.filter((candidate) => candidate.id !== id))
  }
  const attachFiles = async (fileList) => {
    const files = [...(fileList || [])]
    if (!files.length || disabled || busyRef.current) return
    const splice = spliceRef.current
    const added = files.map((file) => ({ id: attachmentKey(), file, splice, phase: 'queued', offset: 0, transferId: null, error: null }))
    replaceRows([...rowsRef.current, ...added])
    await runQueued(added.map((item) => item.id))
  }

  // the three gestures. A paste carrying file(s) attaches them instead of pasting text; a plain text paste
  // has no files and falls through to the textarea's normal behaviour untouched. A drag rings the surface
  // while a file hovers and attaches on drop. The picker is the hidden input the paperclip clicks.
  const pick = () => { if (!disabled) fileRef.current?.click() }
  const onPaste = (event) => {
    const files = event.clipboardData?.files
    if (disabled || !files || !files.length) return
    event.preventDefault()
    void attachFiles(files)
  }
  const onDragOver = (event) => {
    if (disabled) return
    if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); setDragging(true) }
  }
  const onDragLeave = () => setDragging(false)
  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    void attachFiles(event.dataTransfer?.files)
  }
  const busy = rows.some((item) => item.phase === 'queued' || item.phase === 'uploading')

  const fileInput = (
    <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
      onChange={(event) => { void attachFiles(event.target.files); event.target.value = '' }} />
  )
  const queue = rows.length ? (
    <div className={`si-attach-queue ${variant}`} aria-live="polite">
      {rows.map((item) => {
        const inFlight = item.phase === 'queued' || item.phase === 'uploading'
        const status = item.phase === 'queued' ? t('session.attachQueued')
          : item.phase === 'uploading' ? `${formatUploadBytes(item.offset)} / ${formatUploadBytes(item.file.size)}`
            : item.phase === 'complete' ? t('session.attachDone') : item.phase === 'cancelled' ? t('session.attachCancelled') : item.error
        return (
          <div key={item.id} className={`si-attach-row ${item.phase}`}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && event.animationName === 'si-attach-complete-out') dismiss(item.id)
            }}>
            <span className="si-attach-name" title={item.file.name}><Icon name="paperclip" size={12} />{item.file.name}</span>
            <progress className="si-attach-progress" value={item.offset} max={item.file.size} aria-label={`${item.file.name}: ${status}`} />
            <span className="si-attach-status" role={item.phase === 'failed' ? 'alert' : 'status'}>{status}</span>
            {item.phase === 'failed' && <IconButton icon="rotate-ccw" size={13} className="si-attach-action" label={t('session.attachRetry')}
              disabled={busyRef.current} onClick={() => retry(item.id)} />}
            {(inFlight || item.phase === 'failed') && <IconButton icon="x" size={13} className="si-attach-action" label={t('session.attachCancel')}
              onClick={() => { void cancel(item.id) }} />}
            {(item.phase === 'complete' || item.phase === 'cancelled') && <IconButton icon="x" size={13} className="si-attach-action" label={t('session.attachDismiss')}
              onClick={() => dismiss(item.id)} />}
          </div>
        )
      })}
    </div>
  ) : null

  return {
    pick, busy, dragging, onPaste, fileInput, queue,
    // spread onto the surface that should ring and accept a drop
    dropProps: { onDragOver, onDragLeave, onDrop },
  }
}
