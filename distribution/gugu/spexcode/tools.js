// SpexCode's program inside gugu ([[gugu-app]]). Two reads for the tab, and one tool for agents: `share`, which puts
// the tree into a chat's files for the people there. Nothing else for agents: an agent already has a shell and the
// skills this App gives it, so it runs `spex` itself. The tab cannot — its sandbox has no process and
// no git — so the tab asks here, and here runs the `spex` this App version pins (spex-command.js), in the working
// copy gugu stamps on the call: the one of the task the tab sits beside, on the computer that task runs on (a tab
// beside a task on another computer has its call run THERE, and knows no path of that computer). Every export of
// this file is one tool (gugu's tools.js rule); helpers stay unexported.
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPEX } from './spex-command.js'

// npx runs from this App's own folder, never from the working copy (see spex-in.mjs, which then runs spex there).
const BUNDLE = dirname(fileURLToPath(import.meta.url))

const PAGE_ONLY = { ui: { visibility: ['app'] } }

function workingCopy(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('This call came with no working copy: SpexCode reads the spec tree of the task a call comes from — the one its tab sits beside, or the agent\'s — and gugu names that task\'s working copy.')
  return resolve(root)
}

function spex(root, args) {
  // The command line holds constants only. On Windows npx is npx.cmd, which only a shell resolves, and a shell splits
  // and interprets what it is given: the App's folder (`咕咕 Beta` has a space) or a working copy named `a & b` would
  // break it or run as a command. So the helper is named relative to the folder npx runs in, and the working copy
  // travels in the environment.
  const argv = [...SPEX.args, 'node', 'spex-in.mjs', ...args]
  return new Promise((done, fail) => {
    execFile(SPEX.command, argv, { cwd: BUNDLE, env: { ...process.env, SPEXCODE_APP_ROOT: root }, maxBuffer: 256 << 20, timeout: 180_000, shell: process.platform === 'win32' }, (error, stdout, stderr) => {
      if (!error) return done(stdout)
      const said = String(stderr || '').trim().split('\n').slice(-6).join('\n')
      if (error.code === 'ENOENT') return fail(new Error(`SpexCode runs through ${SPEX.command}, which is not on this computer's PATH. Install Node.js 22 or newer (it brings ${SPEX.command}), then refresh.`))
      fail(new Error(`spex ${args.join(' ')} failed in ${root} (spexcode@${SPEX.version} through ${SPEX.command}):\n${said || error.message}`))
    })
  })
}

const exists = (path) => access(path).then(() => true, () => false)

async function readTree(dir) {
  const payload = JSON.parse(await spex(dir, ['graph', '--json']))
  const nodes = await Promise.all(payload.nodes.map(async (n) => ({
    id: n.id,
    parent: n.parent,
    path: n.path,
    title: n.title,
    desc: n.desc,
    code: n.code,
    status: n.status,
    drift: n.drift,
    driftFiles: n.driftFiles,
    version: n.version,
    diagram: await exists(join(dir, dirname(n.path), 'diagram.json')),
  })))
  return { title: payload.identity?.title ?? null, spex: SPEX.version, nodes }
}

async function readNode(dir, path) {
  const file = resolve(dir, String(path))
  const rel = relative(join(dir, '.spec'), file)
  if (rel.startsWith('..') || isAbsolute(rel) || !file.endsWith(`${sep}spec.md`)) throw new Error(`${path} is not a spec.md under ${dir}/.spec`)
  const text = await readFile(file, 'utf8')
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const diagramFile = join(dirname(file), 'diagram.json')
  const diagram = (await exists(diagramFile)) ? await readFile(diagramFile, 'utf8') : null
  return { body, diagram }
}

export const graph = {
  description: 'The spec tree of a working copy as `spex graph --json` assembles it — each node with its drift — for the SpexCode tab.',
  _meta: PAGE_ONLY,
  inputSchema: { type: 'object', properties: {} },
  async run(_, { workspaceRoot }) { return readTree(workingCopy(workspaceRoot)) },
}

export const node = {
  description: 'One spec node\'s body and diagram, read from the working copy, for the SpexCode tab.',
  _meta: PAGE_ONLY,
  inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
  async run({ path }, { workspaceRoot }) { return readNode(workingCopy(workspaceRoot), path) },
}

// The file the people of a chat open SpexCode on (the manifest's snapshot tab claims the suffix): the tree as the tab
// reads it and every node's body and diagram, so it draws with no program, no working copy and no git — in a chat's
// side panel and on a phone. Its own suffix and type keep it a stored file whatever its size: a `.json` under 1 MB
// would become a live document in gugu, one over it a stored file, and the page would need two ways to read one thing.
export const share = {
  description: 'Put a read-only snapshot of the spec tree of the working copy you work in — every node with its drift, body and diagram — into a gugu chat\'s files. The people there open it with SpexCode, on their computers and phones. Sharing again gives that chat\'s snapshot of this project its next version.',
  _meta: { ui: { visibility: ['model'] } },
  inputSchema: { type: 'object', required: ['chat'], properties: { chat: { type: 'string', format: 'gugu-chat', description: 'The chat (a group) to put the snapshot in.' } } },
  async run({ chat }, { workspaceRoot }) {
    const dir = workingCopy(workspaceRoot)
    const tree = await readTree(dir)
    if (!tree.nodes.length) throw new Error(`${dir} has no spec tree to share yet: draw the atlas first.`)
    const documents = Object.fromEntries(await Promise.all(tree.nodes.map(async (n) => [n.id, await readNode(dir, n.path)])))
    const name = `${tree.title ?? basename(dir)}.spexcode`
    const content = new Blob([JSON.stringify({ schema: 'spexcode.gugu-snapshot/v1', ...tree, documents })], { type: 'application/octet-stream' })
    const earlier = (await gugu.files.list({ chat, folder: '' })).find((entry) => entry.type !== 'folder' && entry.name === name)
    if (earlier) await gugu.files.replace(earlier, content, { expectedVersion: earlier.version })
    else await gugu.files.upload({ chat }, new File([content], name, { type: content.type }))
    return { file: name, newVersion: Boolean(earlier), nodes: tree.nodes.length, bytes: content.size }
  },
}
