import { ensurePendingWhileLocked, enqueue, senderDeliveryRevoked, withDeliveryLocks, type PendingMessage } from './delivery-queue.js'
import { appendSent, sentDispatchReceipt, type SentDispatchReceipt } from './session-timeline.js'
import { withSessionRecordLocks } from './record-lock.js'

export type MessageIdempotency = SentDispatchReceipt
export type PreparedMessage = { text: string; replyVia?: 'note' }
export type AcceptMessageOptions = {
  target: string
  text: string
  from?: string
  idempotency?: MessageIdempotency
  validate?: () => Promise<void>
  prepare: () => Promise<PreparedMessage>
}

export class MessageKeyConflict extends Error {
  readonly code = 'dispatch_key_reused'
  constructor(operation: string) {
    super(`idempotency key is already bound to another ${operation} payload`)
    this.name = 'MessageKeyConflict'
  }
}

const keyedPending = (receipt: SentDispatchReceipt, mid: string, delivery: NonNullable<SentDispatchReceipt['delivery']>): PendingMessage => ({
  mid,
  text: delivery.text,
  from: delivery.from,
  dispatch: { operation: receipt.operation, requestDigest: receipt.requestDigest },
})

// The durable acceptance boundary. Product validation and prompt composition run while the record fence is
// held, but the package alone owns append + debt publication and keyed crash recovery.
export async function acceptMessage(options: AcceptMessageOptions): Promise<{ mid: string; replayed: boolean }> {
  const from = options.from ?? null
  let result: { mid: string; replayed: boolean } | null = null
  await withSessionRecordLocks([options.target, ...(from ? [from] : [])], async () => {
    if (from && senderDeliveryRevoked(from)) throw new Error(`sender session ${from} is closed; prompt NOT delivered`)
    await options.validate?.()
    const accept = async () => {
      if (options.idempotency) {
        const prior = sentDispatchReceipt(options.target, options.idempotency.operation, options.idempotency.requestDigest)
        if (prior) {
          if (prior.payloadHash !== options.idempotency.payloadHash) throw new MessageKeyConflict(options.idempotency.operation)
          if (prior.delivery && !prior.delivered) ensurePendingWhileLocked(options.target, keyedPending(options.idempotency, prior.mid, prior.delivery))
          result = { mid: prior.mid, replayed: true }
          return
        }
      }
      const prepared = await options.prepare()
      const receipt = options.idempotency
        ? { ...options.idempotency, delivery: { text: prepared.text, from } }
        : undefined
      const { mid } = appendSent(options.target, options.text, from, prepared.replyVia, receipt)
      enqueue(options.target, receipt ? keyedPending(receipt, mid, receipt.delivery!) : { mid, text: prepared.text, from })
      result = { mid, replayed: false }
    }
    if (options.idempotency) await withDeliveryLocks([options.target], accept)
    else await accept()
  })
  return result!
}
