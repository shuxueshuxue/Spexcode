// SpexCode's program inside gugu ([[gugu-app]]). Two reads for the tab, nothing for agents: an agent already has a
// shell and the skills this App gives it, so it runs `spex` itself. The tab cannot — its sandbox has no process and
// no git — so the tab asks here, and here runs the `spex` this App version pins (spex-command.js), in the working
// copy the tab names. Every export of this file is one tool (gugu's tools.js rule); helpers stay unexported.
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPEX } from './spex-command.js'

// npx runs from this App's own folder, never from the working copy (see spex-in.mjs, which then runs spex there).
const BUNDLE = dirname(fileURLToPath(import.meta.url))

const PAGE_ONLY = { ui: { visibility: ['app'] } }

function workingCopy(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error(`root must be the working copy as an absolute path, got ${JSON.stringify(root)}`)
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

export const graph = {
  description: 'The spec tree of a working copy as `spex graph --json` assembles it — each node with its drift — for the SpexCode tab.',
  _meta: PAGE_ONLY,
  inputSchema: { type: 'object', required: ['root'], properties: { root: { type: 'string' } } },
  async run({ root }) {
    const dir = workingCopy(root)
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
  },
}

export const node = {
  description: 'One spec node\'s body and diagram, read from the working copy, for the SpexCode tab.',
  _meta: PAGE_ONLY,
  inputSchema: { type: 'object', required: ['root', 'path'], properties: { root: { type: 'string' }, path: { type: 'string' } } },
  async run({ root, path }) {
    const dir = workingCopy(root)
    const file = resolve(dir, String(path))
    const rel = relative(join(dir, '.spec'), file)
    if (rel.startsWith('..') || isAbsolute(rel) || !file.endsWith(`${sep}spec.md`)) throw new Error(`${path} is not a spec.md under ${dir}/.spec`)
    const text = await readFile(file, 'utf8')
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '')
    const diagramFile = join(dirname(file), 'diagram.json')
    const diagram = (await exists(diagramFile)) ? await readFile(diagramFile, 'utf8') : null
    return { body, diagram }
  },
}
