// View contributions are document facts, not a second shell chrome surface.
export function assertStatusOwnership(item, owner = null) {
  if (!owner || owner.kind !== 'view') return item
  if (item?.side !== 'right') throw new TypeError(`view status item must use the right group: ${String(item?.id)}`)
  if (item?.node != null && owner.page !== 'graph') {
    throw new TypeError(`view status item cannot mount markup: ${String(item?.id)}`)
  }
  return item
}
