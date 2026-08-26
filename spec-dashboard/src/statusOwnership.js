// View contributions are document facts, not a second shell chrome surface.
//
// The SIDE is the whole ownership rule. A view's fact belongs to the focused-document group and nowhere
// else; the left group is the workspace's and stays the frame's.
//
// Markup used to be banned here with one page allowed through by name, which is not a rule — it is the
// current usage written down. The frame already accepts a document's markup through its OTHER registry:
// [[document-actions]] renders a document-supplied `node` inside the frame's own chrome, and nothing about
// the status bar makes that less safe. What actually bounds a contribution is the same in both registries —
// the frame owns the wrapper, the position, the lifetime, and the reader's power to hide it — so the two
// registries state one rule instead of two, and a second view needing a glance no longer needs a second
// name on an allow-list.
export function assertStatusOwnership(item, owner = null) {
  if (!owner || owner.kind !== 'view') return item
  if (item?.side !== 'right') throw new TypeError(`view status item must use the right group: ${String(item?.id)}`)
  return item
}
