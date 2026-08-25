// [[diff-document]]'s changed-file panel is a DIRECTORY TREE, not a list of paths, because in this repo a
// path is a bad label twice over. Truncating the tail hides the only part that differs — thirty rows all
// read `.spec/spexcode/spec-cli/se…` — and keeping only the leaf is no better, since the spec graph names
// every node's file `spec.md`. What actually identifies a changed file here is the DIRECTORY it sits in, so
// the panel factors the shared prefix into the tree and lets each row carry the one segment it owns.
//
// Single-child chains collapse into one row (`spexcode/spec-cli/sessions`), the way VS Code's explorer and
// GitHub's file tree do it: a directory that holds nothing but one more directory is not a level a reader
// has to walk, and un-collapsed it would push every leaf a dozen indents to the right.

/** Build a compressed directory tree from a flat file list. Pure: same input, same output. */
export function buildDiffTree(files) {
  const root = { name: '', dirs: new Map(), files: [] }
  for (const file of files) {
    const segments = String(file.path || '').split('/').filter(Boolean)
    const leaf = segments.pop()
    if (!leaf) continue
    let node = root
    for (const segment of segments) {
      if (!node.dirs.has(segment)) node.dirs.set(segment, { name: segment, dirs: new Map(), files: [] })
      node = node.dirs.get(segment)
    }
    node.files.push(file)
  }
  return collapse(root).children
}

// A directory whose whole content is ONE subdirectory is joined to it (`a` + `b` -> `a/b`) and the pair
// becomes a single row. Applied bottom-up, so a chain of any length lands as one segment string.
function collapse(node) {
  const children = []
  for (const dir of node.dirs.values()) {
    let folded = collapse(dir)
    while (!folded.files.length && folded.children.length === 1 && folded.children[0].kind === 'dir') {
      const only = folded.children[0]
      folded = { ...only, name: `${folded.name}/${only.name}` }
    }
    children.push(folded)
  }
  children.sort((a, b) => a.name.localeCompare(b.name))
  const leaves = [...node.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({ kind: 'file', name: file.path.split('/').pop(), file }))
  // directories first, then files — the shape every file explorer trains a reader to expect
  return { kind: 'dir', name: node.name, files: node.files, children: [...children, ...leaves] }
}

/** Every directory row's key, for the panel's default-open state: a review wants the whole tree visible. */
export function treeDirKeys(children, prefix = '') {
  const keys = []
  for (const child of children) {
    if (child.kind !== 'dir') continue
    const key = prefix ? `${prefix}/${child.name}` : child.name
    keys.push(key, ...treeDirKeys(child.children, key))
  }
  return keys
}

// The sticky header names the file the reader is IN, so it spends the width on the leaf and lets the
// directories in front of it be the part that gives: dimmed, and dropped from the FRONT when the room runs
// out, since a path's tail is what identifies it. The full path stays on the element's tooltip either way.
export function splitPath(path) {
  const segments = String(path || '').split('/')
  const name = segments.pop() || ''
  return { dir: segments.join('/'), name, dirSegments: segments }
}
