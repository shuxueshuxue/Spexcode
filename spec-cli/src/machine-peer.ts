import { randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer as createNetServer, type Server as NetServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { runtimeRoot, spexcodeHome } from '@spexcode/spec-core'
import { readEndpointRecord } from './host.js'

const execFileAsync = promisify(execFile)
const PEER_VERSION = 1
const PEER_RETRY_MS = 2_000
const PEER_BODY_LIMIT = 1_048_576

export type MachinePeer = {
  machineId: string
  sshAddress: string
  inboundPort: number
  outboundPort: number
  remoteInboundPort: number
  remoteOutboundPort: number
  owner: boolean
  state: 'connecting' | 'connected'
  createdAt: string
  lastOkAt: string | null
  lastError: string | null
}
type PeerStore = { version: typeof PEER_VERSION; machineId: string; peers: MachinePeer[] }

export const peerStorePath = (): string => join(spexcodeHome(), 'gateway', 'peers.json')
export const peerSocketPath = (): string => join(spexcodeHome(), 'gateway', 'peer.sock')

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
}
function validMachineId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
function validPeer(value: unknown): value is MachinePeer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const peer = value as Record<string, unknown>
  return validMachineId(peer.machineId) && typeof peer.sshAddress === 'string' && peer.sshAddress.length > 0 &&
    validPort(peer.inboundPort) && validPort(peer.outboundPort) && validPort(peer.remoteInboundPort) && validPort(peer.remoteOutboundPort) &&
    typeof peer.owner === 'boolean' && (peer.state === 'connecting' || peer.state === 'connected') &&
    typeof peer.createdAt === 'string' && (typeof peer.lastOkAt === 'string' || peer.lastOkAt === null) &&
    (typeof peer.lastError === 'string' || peer.lastError === null)
}

function readStore(): PeerStore {
  const file = peerStorePath()
  if (!existsSync(file)) return { version: PEER_VERSION, machineId: '', peers: [] }
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (error) { throw new Error(`malformed ${file}: ${(error as Error).message}`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as any).version !== PEER_VERSION ||
    (typeof (parsed as any).machineId !== 'string' && (parsed as any).machineId !== undefined) || !Array.isArray((parsed as any).peers) || !(parsed as any).peers.every(validPeer)) {
    throw new Error(`malformed ${file}: expected {version:${PEER_VERSION},peers:[...]}`)
  }
  return { ...(parsed as Omit<PeerStore, 'machineId'>), machineId: typeof (parsed as any).machineId === 'string' ? (parsed as any).machineId : '' }
}

function writeStore(store: PeerStore): void {
  const file = peerStorePath()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, file)
  } finally {
    try { rmSync(tmp) } catch { /* rename consumed it */ }
  }
}

export function listMachinePeers(): MachinePeer[] {
  return readStore().peers
}

export function readPeerMachineId(): string {
  const store = readStore()
  if (validMachineId(store.machineId)) return store.machineId
  const machineId = randomUUID()
  writeStore({ ...store, machineId })
  return machineId
}

export function peerSenderRef(machineId: string, sessionId?: string): string {
  return sessionId && validMachineId(sessionId) ? `peer:${machineId}:${sessionId}` : `peer:${machineId}`
}

function validPeerSender(value: unknown, machineId: string): value is string {
  if (typeof value !== 'string') return false
  const match = value.match(/^peer:([0-9a-f-]{36})(?::([0-9a-f-]{36}))?$/i)
  return !!match && match[1] === machineId && (match[2] === undefined || validMachineId(match[2]))
}

export function findMachinePeer(sshAddress: string): MachinePeer | null {
  return listMachinePeers().find((peer) => peer.sshAddress === sshAddress) ?? null
}

export function resolveMachinePeer(sshAddress: string): MachinePeer {
  const peer = findMachinePeer(sshAddress)
  if (!peer || peer.state !== 'connected') {
    const error = new Error(`no communication tunnel for SSH address ${JSON.stringify(sshAddress)} — run \`spex peer connect ${sshAddress}\`, then retry the unchanged send`)
    error.name = 'BackendError'
    throw error
  }
  return peer
}

function replacePeer(next: MachinePeer): void {
  const store = readStore()
  const at = store.peers.findIndex((peer) => peer.machineId === next.machineId || peer.sshAddress === next.sshAddress)
  if (at >= 0) store.peers[at] = next
  else store.peers.push(next)
  writeStore(store)
}

function removePeer(match: (peer: MachinePeer) => boolean): MachinePeer | null {
  const store = readStore()
  const peer = store.peers.find(match) ?? null
  if (!peer) return null
  writeStore({ ...store, peers: store.peers.filter((item) => item !== peer) })
  return peer
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!address || typeof address === 'string' || !validPort(address.port)) throw new Error('could not allocate loopback peer port')
  return address.port
}

function readRequest(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > PEER_BODY_LIMIT) {
        req.destroy()
        reject(new Error('peer envelope exceeds 1 MiB'))
      }
    })
    req.once('end', () => resolve(body))
    req.once('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

type PeerProject = { id: string; url: string | null; endpointConflict?: string }

// Session records live under the shared Git common-dir store, whereas a running backend publishes under
// the worktree root it serves. A direct endpoint beside the session remains the simple case; linked
// worktrees use the record's worktree_path to find their own published endpoint.
function peerProjectsForSession(sessionId: string): PeerProject[] {
  const projects = join(spexcodeHome(), 'projects')
  let ids: string[] = []
  try { ids = readdirSync(projects) } catch { return [] }
  const endpointRecords = ids.flatMap((id) => {
    const endpoint = readEndpointRecord(join(projects, id, 'backend.json'))
    return endpoint ? [{ id, endpoint }] : []
  })
  const hits: PeerProject[] = []
  for (const id of ids) {
    const root = join(projects, id)
    const record = join(root, 'sessions', sessionId, 'session.json')
    if (!existsSync(record)) continue
    const direct = readEndpointRecord(join(root, 'backend.json'))
    if (direct) { hits.push({ id, url: direct.url }); continue }
    let worktree = ''
    try {
      const parsed = JSON.parse(readFileSync(record, 'utf8'))
      if (typeof parsed?.worktree_path === 'string' && parsed.worktree_path) worktree = resolve(parsed.worktree_path)
    } catch { /* the backend gives the record's named error after routing reaches it */ }
    const exact = worktree ? endpointRecords.filter(({ endpoint }) => resolve(endpoint.root) === worktree) : []
    if (exact.length === 1) { hits.push({ id, url: exact[0].endpoint.url }); continue }
    if (exact.length > 1) {
      hits.push({ id, url: null, endpointConflict: `session ${sessionId} has ${exact.length} live backends for worktree ${worktree}` })
      continue
    }
    const common = endpointRecords.filter(({ endpoint }) => {
      try { return runtimeRoot(endpoint.root) === root } catch { return false }
    })
    if (common.length === 1) hits.push({ id, url: common[0].endpoint.url })
    else if (common.length > 1) hits.push({ id, url: null, endpointConflict: `session ${sessionId} has ${common.length} live backends in its Git project` })
    else hits.push({ id, url: null })
  }
  return hits
}

async function forwardToProject(peer: MachinePeer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const match = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})\/input$/i)
  if (!match || req.method !== 'POST') { json(res, 404, { error: 'peer accepts POST /api/sessions/<full-id>/input only' }); return }
  const sessionId = match[1]
  const projects = peerProjectsForSession(sessionId)
  if (!projects.length) { json(res, 404, { error: `no local project owns session ${sessionId}` }); return }
  if (projects.length > 1) { json(res, 409, { error: `session ${sessionId} is ambiguous across ${projects.length} local projects` }); return }
  if (projects[0].endpointConflict) { json(res, 409, { error: projects[0].endpointConflict }); return }
  if (!projects[0].url) { json(res, 502, { error: `target backend for session ${sessionId} is offline` }); return }
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(await readRequest(req))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.kind !== 'text' || typeof parsed.text !== 'string') throw new Error('input must be {kind:"text",text:"..."}')
    body = {
      kind: 'text', text: parsed.text,
      from: validPeerSender(parsed.from, peer.machineId) ? parsed.from : peerSenderRef(peer.machineId),
    }
  } catch (error) { json(res, 400, { error: (error as Error).message }); return }
  let upstream: Response
  try {
    upstream = await fetch(`${projects[0].url}/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch (error) { json(res, 502, { error: `target backend is unreachable: ${(error as Error).message}` }); return }
  const text = await upstream.text()
  res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
  res.end(text)
}

export type PeerRpcRequest =
  | { op: 'list' }
  | { op: 'connect'; sshAddress: string }
  | { op: 'accept'; sourceMachineId: string; sshAddress: string; remoteInboundPort: number; remoteOutboundPort: number }
  | { op: 'disconnect'; sshAddress: string }
  | { op: 'drop'; machineId: string }
type RpcResponse = { ok: true; peer?: MachinePeer; peers?: MachinePeer[]; machineId?: string } | { ok: false; error: string }

function validRpc(value: unknown): value is PeerRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (request.op === 'list') return true
  if (request.op === 'connect' || request.op === 'disconnect') return typeof request.sshAddress === 'string' && request.sshAddress.length > 0
  if (request.op === 'drop') return validMachineId(request.machineId)
  return request.op === 'accept' && validMachineId(request.sourceMachineId) && typeof request.sshAddress === 'string' && request.sshAddress.length > 0 &&
    validPort(request.remoteInboundPort) && validPort(request.remoteOutboundPort)
}

function remoteCommand(op: 'peer-accept' | 'peer-drop', body: object): string {
  return `spex internal ${op} ${Buffer.from(JSON.stringify(body)).toString('base64url')}`
}

function sshArgs(peer: MachinePeer): string[] {
  return [
    '-N', '-o', 'ExitOnForwardFailure=yes',
    '-L', `127.0.0.1:${peer.outboundPort}:127.0.0.1:${peer.remoteInboundPort}`,
    '-R', `127.0.0.1:${peer.remoteOutboundPort}:127.0.0.1:${peer.inboundPort}`,
    '--', peer.sshAddress,
  ]
}

export class MachinePeerGateway {
  private readonly inbound = new Map<string, HttpServer>()
  private readonly children = new Map<string, ChildProcess>()
  private control: NetServer | null = null
  private retry: NodeJS.Timeout | null = null
  private closing = false

  start(): void {
    for (const peer of listMachinePeers()) this.startInbound(peer)
    this.startControl()
    for (const peer of listMachinePeers()) if (peer.owner) this.ensureTunnel(peer)
    this.retry = setInterval(() => {
      for (const peer of listMachinePeers()) if (peer.owner && peer.state === 'connecting') this.ensureTunnel(peer)
    }, PEER_RETRY_MS)
    this.retry.unref()
  }

  private startControl(): void {
    const path = peerSocketPath()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (existsSync(path)) {
      const error = new Error(`machine peer service already owns ${path} — another \`spex dashboard\` may be running`)
      error.name = 'BackendError'
      throw error
    }
    this.control = createNetServer({ allowHalfOpen: true }, (socket) => {
      let input = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => { input += chunk })
      socket.on('end', () => void this.handleRpc(input)
        .then((reply) => socket.end(`${JSON.stringify(reply)}\n`))
        .catch((error) => socket.end(`${JSON.stringify({ ok: false, error: (error as Error).message })}\n`)))
      socket.on('error', () => socket.destroy())
    })
    this.control.listen(path)
    try { chmodSync(path, 0o600) } catch { /* platform lacks unix modes */ }
  }

  private async handleRpc(raw: string): Promise<RpcResponse> {
    let request: unknown
    try { request = JSON.parse(raw) } catch { return { ok: false, error: 'peer control request is not JSON' } }
    if (!validRpc(request)) return { ok: false, error: 'invalid peer control request' }
    try {
      if (request.op === 'list') return { ok: true, peers: listMachinePeers() }
      if (request.op === 'connect') return { ok: true, peer: await this.connect(request.sshAddress) }
      if (request.op === 'accept') return { ok: true, peer: await this.accept(request), machineId: readPeerMachineId() }
      if (request.op === 'disconnect') {
        const peer = await this.disconnect(request.sshAddress)
        if (!peer) throw new Error(`no communication tunnel for SSH address ${JSON.stringify(request.sshAddress)}`)
        return { ok: true, peer }
      }
      return { ok: true, peer: await this.drop(request.machineId) ?? undefined }
    } catch (error) { return { ok: false, error: (error as Error).message } }
  }

  private startInbound(peer: MachinePeer): void {
    if (this.inbound.has(peer.machineId)) return
    const server = createHttpServer((req, res) => void forwardToProject(peer, req, res))
    server.on('error', (error) => console.error(`[peer] ${peer.machineId} inbound port ${peer.inboundPort}: ${(error as Error).message}`))
    server.listen(peer.inboundPort, '127.0.0.1')
    this.inbound.set(peer.machineId, server)
  }

  private stopInbound(machineId: string): void {
    const server = this.inbound.get(machineId)
    if (!server) return
    this.inbound.delete(machineId)
    server.close()
  }

  private ensureTunnel(peer: MachinePeer): void {
    if (this.closing || this.children.has(peer.machineId)) return
    this.startInbound(peer)
    const child = spawn('ssh', sshArgs(peer), { stdio: 'ignore' })
    this.children.set(peer.machineId, child)
    child.once('error', (error) => this.tunnelEnded(peer.machineId, (error as Error).message))
    child.once('exit', (code, signal) => this.tunnelEnded(peer.machineId, `ssh exited (${code ?? signal ?? 'unknown'})`))
    const next = { ...peer, state: 'connected' as const, lastOkAt: new Date().toISOString(), lastError: null }
    replacePeer(next)
  }

  private tunnelEnded(machineId: string, error: string): void {
    this.children.delete(machineId)
    if (this.closing) return
    const peer = listMachinePeers().find((item) => item.machineId === machineId)
    if (!peer || !peer.owner) return
    replacePeer({ ...peer, state: 'connecting', lastError: error })
  }

  private async connect(sshAddress: string): Promise<MachinePeer> {
    const existing = findMachinePeer(sshAddress)
    if (existing) {
      if (existing.owner) this.ensureTunnel(existing)
      return existing
    }
    if (sshAddress.startsWith('-')) throw new Error('SSH address must not begin with -')
    const inboundPort = await freePort()
    const outboundPort = await freePort()
    const sourceMachineId = readPeerMachineId()
    const remote = await execFileAsync('ssh', ['--', sshAddress, remoteCommand('peer-accept', {
      sourceMachineId, sshAddress, remoteInboundPort: inboundPort, remoteOutboundPort: outboundPort,
    })], { maxBuffer: 64 * 1024 })
    let reply: RpcResponse
    try { reply = JSON.parse(remote.stdout.trim()) as RpcResponse } catch { throw new Error(`remote peer accept returned invalid JSON: ${remote.stdout.trim() || remote.stderr.trim()}`) }
    if (!reply.ok || !reply.peer || !validMachineId(reply.machineId)) throw new Error(reply.ok ? 'remote peer accept returned no machine identity' : reply.error)
    const peer: MachinePeer = {
      machineId: reply.machineId, sshAddress, inboundPort, outboundPort,
      remoteInboundPort: reply.peer.inboundPort, remoteOutboundPort: reply.peer.outboundPort,
      owner: true, state: 'connecting', createdAt: new Date().toISOString(), lastOkAt: null, lastError: null,
    }
    replacePeer(peer)
    this.startInbound(peer)
    this.ensureTunnel(peer)
    return findMachinePeer(sshAddress) ?? peer
  }

  private async accept(request: Extract<PeerRpcRequest, { op: 'accept' }>): Promise<MachinePeer> {
    const existing = listMachinePeers().find((peer) => peer.machineId === request.sourceMachineId)
    if (existing) return existing
    const peer: MachinePeer = {
      machineId: request.sourceMachineId, sshAddress: request.sshAddress,
      inboundPort: await freePort(), outboundPort: await freePort(),
      remoteInboundPort: request.remoteInboundPort, remoteOutboundPort: request.remoteOutboundPort,
      owner: false, state: 'connected', createdAt: new Date().toISOString(), lastOkAt: new Date().toISOString(), lastError: null,
    }
    replacePeer(peer)
    this.startInbound(peer)
    return peer
  }

  private async drop(machineId: string): Promise<MachinePeer | null> {
    const child = this.children.get(machineId)
    if (child) { this.children.delete(machineId); try { child.kill('SIGTERM') } catch { /* already gone */ } }
    this.stopInbound(machineId)
    return removePeer((peer) => peer.machineId === machineId)
  }

  private async disconnect(sshAddress: string): Promise<MachinePeer | null> {
    const peer = findMachinePeer(sshAddress)
    if (!peer) return null
    const removed = await this.drop(peer.machineId)
    if (peer.owner) {
      try { await execFileAsync('ssh', ['--', peer.sshAddress, remoteCommand('peer-drop', { machineId: readPeerMachineId() })], { maxBuffer: 64 * 1024 }) }
      catch (error) { console.error(`[peer] remote peer cleanup failed for ${peer.sshAddress}: ${(error as Error).message}`) }
    }
    return removed
  }

  async close(): Promise<void> {
    this.closing = true
    if (this.retry) clearInterval(this.retry)
    for (const child of this.children.values()) try { child.kill('SIGTERM') } catch { /* already gone */ }
    this.children.clear()
    for (const server of this.inbound.values()) server.close()
    this.inbound.clear()
    const control = this.control
    this.control = null
    if (control) await new Promise<void>((resolve) => control.close(() => resolve()))
    try { rmSync(peerSocketPath()) } catch { /* already removed */ }
  }
}

export async function peerRpc(request: PeerRpcRequest): Promise<RpcResponse> {
  const path = peerSocketPath()
  return await new Promise<RpcResponse>((resolve, reject) => {
    const socket = createConnection(path)
    let output = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.end(JSON.stringify(request)))
    socket.on('data', (chunk) => { output += chunk })
    socket.once('error', (error) => reject(new Error(`no host gateway peer service at ${path} — run \`spex dashboard\` (${error.message})`)))
    socket.once('end', () => {
      try { resolve(JSON.parse(output) as RpcResponse) }
      catch { reject(new Error('host gateway peer service returned invalid JSON')) }
    })
  })
}

export async function peerControlOrThrow(request: PeerRpcRequest): Promise<MachinePeer | MachinePeer[]> {
  const reply = await peerRpc(request)
  if (!reply.ok) throw new Error(reply.error)
  if (reply.peers) return reply.peers
  if (reply.peer) return reply.peer
  return []
}
