import { randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer as createNetServer, type Server as NetServer } from 'node:net'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { spexcodeHome } from '@spexcode/spec-core'
import { readHostRecord } from './host-record.js'
import { grantPeer, revokePeer } from './gateway-auth.js'

const execFileAsync = promisify(execFile)
const PEER_VERSION = 2
const PEER_RETRY_MS = 2_000

export type MachinePeer = {
  machineId: string
  sshAddress: string
  sshOptions: string[]
  // The local port that reaches that machine's gateway. On the DIALLING side it is the listening end of an
  // `-L` forward; on the ACCEPTING side it is a port the dialler's `-R` publishes here. Either way it means
  // the same thing to every reader, which is why both sides now hold one.
  gatewayPort: number | null
  remoteGatewayPort: number | null
  remoteGatewayInstanceId: string | null
  // the credential that far machine ISSUED to this one during the accept handshake — what this machine
  // presents on that gateway's peer ingress. Absent means the far side published no ingress to reach.
  remoteGatewayCredential: string | null
  // the port THERE that our reverse forward publishes onto our own peer ingress. Only the dialler builds it.
  remoteBackPort: number | null
  owner: boolean
  state: 'connecting' | 'connected'
  createdAt: string
  lastOkAt: string | null
  lastError: string | null
}
type PeerStore = { version: typeof PEER_VERSION; machineId: string; peers: MachinePeer[] }
export type PeerGatewayFacts = { port: number; instanceId: string; credential: string }
type AcceptReply = { machineId: string; gateway: PeerGatewayFacts | null; backPort: number | null }

export const peerStorePath = (): string => join(spexcodeHome(), 'gateway', 'peers.json')
export const peerSocketPath = (): string => join(spexcodeHome(), 'gateway', 'peer.sock')

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
}
function validMachineId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
// @@@absent sshOptions is legacy, not malformed - peers minted before options existed carry none, so the
// store still loads and normalizes to an empty list instead of failing every read.
function validSshOptions(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
}
function validGatewayFacts(value: unknown): value is PeerGatewayFacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const facts = value as Record<string, unknown>
  return validPort(facts.port) && typeof facts.instanceId === 'string' && facts.instanceId.length > 0 &&
    typeof facts.credential === 'string' && facts.credential.length > 0
}
// @@@absent gateway leg is legacy, not malformed - two ordinary peers carry none: one minted before the leg
// existed, and one whose far side had not published a host record when it answered. Both load and normalize to
// "no gateway leg", the same way sshOptions normalizes to no options.
function validGatewayLeg(peer: Record<string, unknown>): boolean {
  const optionalPort = (value: unknown) => value === undefined || value === null || validPort(value)
  const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string'
  return optionalPort(peer.gatewayPort) && optionalPort(peer.remoteGatewayPort) && optionalPort(peer.remoteBackPort) &&
    optionalString(peer.remoteGatewayInstanceId) && optionalString(peer.remoteGatewayCredential)
}
function validPeer(value: unknown): value is MachinePeer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const peer = value as Record<string, unknown>
  return validMachineId(peer.machineId) && typeof peer.sshAddress === 'string' && peer.sshAddress.length > 0 &&
    validSshOptions(peer.sshOptions) && validGatewayLeg(peer) &&
    typeof peer.owner === 'boolean' && (peer.state === 'connecting' || peer.state === 'connected') &&
    typeof peer.createdAt === 'string' && (typeof peer.lastOkAt === 'string' || peer.lastOkAt === null) &&
    (typeof peer.lastError === 'string' || peer.lastError === null)
}

function readStore(): PeerStore {
  const file = peerStorePath()
  if (!existsSync(file)) return { version: PEER_VERSION, machineId: '', peers: [] }
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (error) { throw new Error(`malformed ${file}: ${(error as Error).message}`) }
  // @@@v1 peers do not survive the collapse - each one records a forward pair aimed at a per-peer listener
  // this gateway no longer runs, so carrying one forward would be a link that quietly forwards into nothing.
  // Dropping them costs one `spex peer connect` per machine and says so; keeping them would cost silence.
  const legacy = parsed as { version?: unknown; machineId?: unknown; peers?: unknown }
  if (legacy?.version === 1 && Array.isArray(legacy.peers)) {
    const dropped = legacy.peers.length
    const next: PeerStore = { version: PEER_VERSION, machineId: typeof legacy.machineId === 'string' ? legacy.machineId : '', peers: [] }
    writeStore(next)
    if (dropped) console.error(`[peer] dropped ${dropped} peer link${dropped === 1 ? '' : 's'} recorded before the single-door tunnel — run \`spex peer connect <address>\` once per machine to relink`)
    return next
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as any).version !== PEER_VERSION ||
    (typeof (parsed as any).machineId !== 'string' && (parsed as any).machineId !== undefined) || !Array.isArray((parsed as any).peers) || !(parsed as any).peers.every(validPeer)) {
    throw new Error(`malformed ${file}: expected {version:${PEER_VERSION},peers:[...]}`)
  }
  const store = parsed as Omit<PeerStore, 'machineId'>
  return {
    ...store,
    peers: store.peers.map((peer) => ({
      ...peer,
      sshOptions: peer.sshOptions ?? [],
      remoteBackPort: peer.remoteBackPort ?? null,
      gatewayPort: peer.gatewayPort ?? null,
      remoteGatewayPort: peer.remoteGatewayPort ?? null,
      remoteGatewayInstanceId: peer.remoteGatewayInstanceId ?? null,
      remoteGatewayCredential: peer.remoteGatewayCredential ?? null,
    })),
    machineId: typeof (parsed as any).machineId === 'string' ? (parsed as any).machineId : '',
  }
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

// @@@ peer sender spelling - the authenticated peer identity travels as the message's ordinary `senderSessionId`,
// so it must fit the protocol's frozen session_id grammar `[0-9A-Za-z_][0-9A-Za-z_-]*` (session-protocol §5.2:
// no `:`, no leading `-`; namespaces are encoded INTO the id). `peer_<machineId>_<sessionId>` is that encoding;
// the earlier `peer:` spelling was refused by every receiving backend with PROTOCOL_SESSION_ID_INVALID.
export function peerSenderRef(machineId: string, sessionId?: string): string {
  return sessionId && validMachineId(sessionId) ? `peer_${machineId}_${sessionId}` : `peer_${machineId}`
}

export function validPeerSender(value: unknown, machineId: string): value is string {
  if (typeof value !== 'string') return false
  const match = value.match(/^peer_([0-9a-f-]{36})(?:_([0-9a-f-]{36}))?$/i)
  return !!match && match[1] === machineId && (match[2] === undefined || validMachineId(match[2]))
}

// ssh options that take a separate value; a bare one of these swallows the token after it, so the SSH address
// is whatever is left. Attached forms (-Fpath) and repeated booleans (-vvv) need no table.
const SSH_VALUE_OPTIONS = new Set('BbcDEeFIiJLlmOopQRSWw'.split(''))

// @@@ssh options are ssh's grammar, not spex's - spex owns only its `--` flag space, so single-dash tokens pass
// through verbatim in ssh's own order. `--` ends the options for an address that would otherwise look like one.
export function splitSshOptions(tokens: readonly string[]): { sshOptions: string[]; addresses: string[] } {
  const sshOptions: string[] = []
  const addresses: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '--') { addresses.push(...tokens.slice(i + 1)); break }
    if (!token.startsWith('-') || token === '-') { addresses.push(token); continue }
    sshOptions.push(token)
    if (token.length === 2 && SSH_VALUE_OPTIONS.has(token[1])) {
      const value = tokens[i + 1]
      if (value === undefined) throw new Error(`ssh option ${token} needs a value`)
      sshOptions.push(value)
      i++
    }
  }
  return { sshOptions, addresses }
}

export function findMachinePeer(sshAddress: string): MachinePeer | null {
  return listMachinePeers().find((peer) => peer.sshAddress === sshAddress) ?? null
}

export function resolveMachinePeer(sshAddress: string): MachinePeer {
  const peer = findMachinePeer(sshAddress)
  if (!peer || peer.state !== 'connected') {
    const error = new Error(`no communication tunnel for SSH address ${JSON.stringify(sshAddress)} — run \`spex peer connect ${sshAddress}\`, then retry the unchanged command`)
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

export type PeerRpcRequest =
  | { op: 'list' }
  | { op: 'connect'; sshAddress: string; sshOptions?: string[] }
  | { op: 'accept'; sourceMachineId: string; sshAddress: string; credential?: string; instanceId?: string }
  | { op: 'disconnect'; sshAddress: string }
  | { op: 'drop'; machineId: string }
type RpcResponse = { ok: true; peer?: MachinePeer; peers?: MachinePeer[]; machineId?: string; gateway?: PeerGatewayFacts; backPort?: number } | { ok: false; error: string }

function validRpc(value: unknown): value is PeerRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (request.op === 'list') return true
  if (request.op === 'connect') return typeof request.sshAddress === 'string' && request.sshAddress.length > 0 && validSshOptions(request.sshOptions)
  if (request.op === 'disconnect') return typeof request.sshAddress === 'string' && request.sshAddress.length > 0
  if (request.op === 'drop') return validMachineId(request.machineId)
  const optionalString = (value: unknown) => value === undefined || (typeof value === 'string' && value.length > 0)
  return request.op === 'accept' && validMachineId(request.sourceMachineId) && typeof request.sshAddress === 'string' && request.sshAddress.length > 0 &&
    optionalString(request.credential) && optionalString(request.instanceId)
}

// @@@login-shell dial - PATH is per-machine config, so the remote command is resolved by the remote
// user's own login shell rather than the bare non-interactive PATH ssh hands us. The payload is
// base64url (A-Za-z0-9_-), so it carries no shell metacharacter and needs no quoting beyond this.
function remoteCommand(op: 'peer-accept' | 'peer-drop', body: object): string {
  return `exec "$SHELL" -lc 'spex internal ${op} ${Buffer.from(JSON.stringify(body)).toString('base64url')}'`
}

// @@@reply is the last line - a login shell may print profile chatter before the command runs, so the
// reply is read off the last non-empty line rather than the whole stream.
function parseRemoteReply(sshAddress: string, stdout: string, stderr: string): RpcResponse {
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  const last = lines[lines.length - 1]
  if (last?.startsWith('{')) {
    try { return JSON.parse(last) as RpcResponse } catch { /* fall through to the named failure */ }
  }
  throw new Error(`remote peer accept produced no peer reply from ${sshAddress}: spex must be on the login PATH of that ssh user (fix the remote login shell's PATH, then rerun spex peer connect). Remote output: ${lines.join(' | ') || stderr.trim() || '(none)'}`)
}

// @@@own gateway is read live, never captured - the peer service claims its control socket before
// `spex dashboard` binds and publishes the host record, so at startup there is no gateway to name yet. Reading it
// when a peer actually asks means the answer is either today's gateway or an honest absence.
// The leg targets the PEER INGRESS, never the console port: a forward into the console entry would arrive as
// a loopback socket and inherit the implicit trust this machine's own console has ([[gateway-auth]]), so a
// gateway publishing no ingress is answered as no gateway at all. The credential is minted here for the
// asking machine — the ssh login that carried this RPC is the authentication behind it.
function localGatewayFacts(machineId: string): PeerGatewayFacts | null {
  const record = readHostRecord()
  if (!record || !validPort(record.peerPort)) return null
  return { port: record.peerPort, instanceId: record.instanceId, credential: grantPeer(machineId).token }
}

// One SSH connection still has two directions, and both of them now land on a GATEWAY peer ingress rather
// than on a hand-written listener: `-L` reaches theirs, `-R` publishes ours over there. The reverse leg is
// what keeps the accepting side able to reach back at all — it opens no ssh child of its own, so the port it
// holds is one the dialler published for it.
function sshArgs(peer: MachinePeer): string[] {
  const ingress = readHostRecord()?.peerPort
  return [
    ...peer.sshOptions,
    '-N', '-o', 'ExitOnForwardFailure=yes',
    // @@@a leg is omitted, never guessed - `-L`/`-R` bind eagerly but connect lazily, so a leg built for a
    // gateway that has since died costs one refused proxy attempt and never the tunnel. A leg built for a
    // gateway that was never published would cost a wrong port, which no later reader could detect.
    ...(peer.gatewayPort && peer.remoteGatewayPort ? ['-L', `127.0.0.1:${peer.gatewayPort}:127.0.0.1:${peer.remoteGatewayPort}`] : []),
    ...(peer.remoteBackPort && validPort(ingress) ? ['-R', `127.0.0.1:${peer.remoteBackPort}:127.0.0.1:${ingress}`] : []),
    '--', peer.sshAddress,
  ]
}

// true iff something ACCEPTS a connection at this unix path; any error (ECONNREFUSED for a leftover path, ENOENT
// for a vanished one) means no live listener.
function probeUnixListener(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

export class MachinePeerGateway {
  private readonly children = new Map<string, ChildProcess>()
  private control: NetServer | null = null
  private retry: NodeJS.Timeout | null = null
  private closing = false

  // start() resolves once the control socket is claimed. With no leftover path the claim is synchronous (the
  // listener is issued before the promise settles, so callers may issue control RPCs right away); a leftover path
  // is probed first, which is the only asynchronous branch.
  start(): Promise<void> {
    return this.startControl().then(() => {
      for (const peer of listMachinePeers()) if (peer.owner) this.ensureTunnel(peer)
      this.retry = setInterval(() => {
        for (const peer of listMachinePeers()) if (peer.owner && peer.state === 'connecting') this.ensureTunnel(peer)
      }, PEER_RETRY_MS)
      this.retry.unref()
    })
  }

  // @@@ stale control socket - a killed gateway never unlinks peer.sock, so the FILE proves nothing about
  // ownership; only a connect does. A live gateway accepts the connection; a leftover path refuses it
  // (ECONNREFUSED). So a missing path is claimed at once, a refusing path is unlinked and reclaimed, and only an
  // accepting listener is "another `spex dashboard`" — the same test claude-rendezvous applies to its socket file.
  private startControl(): Promise<void> {
    const path = peerSocketPath()
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (!existsSync(path)) {
      this.listenControl(path)
      return Promise.resolve()
    }
    return probeUnixListener(path).then((live) => {
      if (live) {
        const error = new Error(`machine peer service already owns ${path} — another \`spex dashboard\` is running`)
        error.name = 'BackendError'
        throw error
      }
      rmSync(path, { force: true })
      this.listenControl(path)
    })
  }

  private listenControl(path: string): void {
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
      if (request.op === 'connect') return { ok: true, peer: await this.connect(request.sshAddress, request.sshOptions ?? []) }
      // the accepting machine answers for its OWN gateway; the caller stores it as this peer's remote gateway
      if (request.op === 'accept') {
        const gateway = localGatewayFacts(request.sourceMachineId)
        const peer = await this.accept(request)
        return {
          ok: true, peer, machineId: readPeerMachineId(),
          ...(gateway ? { gateway } : {}),
          // the port the caller's reverse forward should publish HERE, so this side gains a leg back
          ...(peer.gatewayPort ? { backPort: peer.gatewayPort } : {}),
        }
      }
      if (request.op === 'disconnect') {
        const peer = await this.disconnect(request.sshAddress)
        if (!peer) throw new Error(`no communication tunnel for SSH address ${JSON.stringify(request.sshAddress)}`)
        return { ok: true, peer }
      }
      return { ok: true, peer: await this.drop(request.machineId) ?? undefined }
    } catch (error) { return { ok: false, error: (error as Error).message } }
  }

  private ensureTunnel(peer: MachinePeer): void {
    if (this.closing || this.children.has(peer.machineId)) return
    const child = spawn('ssh', sshArgs(peer), { stdio: 'ignore' })
    this.children.set(peer.machineId, child)
    child.once('error', (error) => this.tunnelEnded(peer.machineId, child, (error as Error).message))
    child.once('exit', (code, signal) => this.tunnelEnded(peer.machineId, child, `ssh exited (${code ?? signal ?? 'unknown'})`))
    const next = { ...peer, state: 'connected' as const, lastOkAt: new Date().toISOString(), lastError: null }
    replacePeer(next)
  }

  // @@@only the CURRENT dial reports - a superseded child (its leg was rebuilt) exits after its replacement is
  // already registered, so accepting its exit would mark a live tunnel `connecting` and record a false error.
  private tunnelEnded(machineId: string, child: ChildProcess, error: string): void {
    if (this.children.get(machineId) !== child) return
    this.children.delete(machineId)
    if (this.closing) return
    const peer = listMachinePeers().find((item) => item.machineId === machineId)
    if (!peer || !peer.owner) return
    replacePeer({ ...peer, state: 'connecting', lastError: error })
  }

  // @@@connect is one code path, first link or refresh - the retry loop redials ssh with no remote RPC at
  // all, so a far gateway that restarted on a different port would keep a forward aimed at a dead instance
  // forever. Re-running `spex peer connect` IS that refresh: it re-asks the far side what it publishes now
  // and rebuilds the legs when anything moved. A refused ask leaves the recorded leg alone instead of erasing
  // it, so an offline peer can still have its tunnel kicked the way it always could.
  private async connect(sshAddress: string, sshOptions: string[]): Promise<MachinePeer> {
    const existing = findMachinePeer(sshAddress)
    if (!existing && sshAddress.startsWith('-')) throw new Error('SSH address must not begin with -')
    const options = existing?.sshOptions ?? sshOptions
    let reply: AcceptReply
    try { reply = await this.askAccept(sshAddress, options) }
    catch (error) {
      if (!existing) throw error
      this.ensureTunnel(existing)
      return existing
    }
    // @@@settled compares what would be RECORDED, not what was replied - the back port is gated by whether
    // this machine publishes an ingress at all, so comparing the raw reply would call an unchanged link
    // changed on every dial and rebuild a healthy tunnel for nothing.
    const ingress = readHostRecord()
    const backPort = ingress && validPort(ingress.peerPort) ? reply.backPort : null
    const settled = existing && existing.machineId === reply.machineId &&
      existing.remoteGatewayInstanceId === (reply.gateway?.instanceId ?? null) &&
      existing.remoteGatewayPort === (reply.gateway?.port ?? null) &&
      existing.remoteBackPort === backPort
    if (existing && settled) { this.ensureTunnel(existing); return existing }
    // @@@the credential the FAR side will verify is minted HERE - a grant only means anything to the machine
    // that issues it, so each side mints for the other and the exchange needs two calls: the first learns who
    // answered (we cannot mint for a machine we cannot yet name), the second hands over what we minted for
    // them. `accept` is idempotent so the second call refines the record the first one created.
    if (backPort) await this.tellAccept(sshAddress, options, { credential: grantPeer(reply.machineId).token, instanceId: ingress!.instanceId })
    const peer: MachinePeer = {
      machineId: reply.machineId, sshAddress, sshOptions: options,
      gatewayPort: reply.gateway ? existing?.gatewayPort ?? await freePort() : null,
      remoteGatewayPort: reply.gateway?.port ?? null,
      remoteGatewayInstanceId: reply.gateway?.instanceId ?? null,
      remoteGatewayCredential: reply.gateway?.credential ?? null,
      remoteBackPort: backPort,
      owner: true, state: 'connecting',
      createdAt: existing?.createdAt ?? new Date().toISOString(), lastOkAt: null, lastError: null,
    }
    replacePeer(peer)
    if (existing) this.dropChild(peer.machineId)
    this.ensureTunnel(peer)
    return findMachinePeer(sshAddress) ?? peer
  }

  private async askAccept(sshAddress: string, sshOptions: string[], extra: object = {}): Promise<AcceptReply> {
    const remote = await execFileAsync('ssh', [...sshOptions, '--', sshAddress, remoteCommand('peer-accept', {
      sourceMachineId: readPeerMachineId(), sshAddress, ...extra,
    })], { maxBuffer: 64 * 1024 })
    const reply = parseRemoteReply(sshAddress, remote.stdout, remote.stderr)
    if (!reply.ok) throw new Error(reply.error)
    if (!validMachineId(reply.machineId)) throw new Error('remote peer accept returned no machine identity')
    return {
      machineId: reply.machineId,
      gateway: validGatewayFacts(reply.gateway) ? reply.gateway : null,
      backPort: validPort(reply.backPort) ? reply.backPort : null,
    }
  }

  // handing over our credential must not fail the link: the outward leg is already usable without it, and the
  // far side simply holds no leg back until a later connect succeeds.
  private async tellAccept(sshAddress: string, sshOptions: string[], extra: object): Promise<void> {
    try { await this.askAccept(sshAddress, sshOptions, extra) }
    catch (error) { console.error(`[peer] ${sshAddress} did not take this machine's gateway credential: ${(error as Error).message}`) }
  }

  // Idempotent and refining: the dialler calls this twice, and a later `spex peer connect` calls it again.
  // Each call keeps the port this side already published and takes whatever new facts arrived.
  private async accept(request: Extract<PeerRpcRequest, { op: 'accept' }>): Promise<MachinePeer> {
    const existing = listMachinePeers().find((peer) => peer.machineId === request.sourceMachineId)
    const peer: MachinePeer = {
      machineId: request.sourceMachineId, sshAddress: request.sshAddress, sshOptions: existing?.sshOptions ?? [],
      // this side opens no ssh child, so its handle on that machine is a port the DIALLER publishes here
      gatewayPort: existing?.gatewayPort ?? await freePort(),
      remoteGatewayPort: null,
      remoteGatewayInstanceId: request.instanceId ?? existing?.remoteGatewayInstanceId ?? null,
      remoteGatewayCredential: request.credential ?? existing?.remoteGatewayCredential ?? null,
      remoteBackPort: null,
      owner: false, state: 'connected',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastOkAt: new Date().toISOString(), lastError: null,
    }
    replacePeer(peer)
    return peer
  }

  private dropChild(machineId: string): void {
    const child = this.children.get(machineId)
    if (!child) return
    this.children.delete(machineId)
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }

  private async drop(machineId: string): Promise<MachinePeer | null> {
    this.dropChild(machineId)
    // dropping the link destroys the generation behind any credential this machine issued to that one, so
    // an unlinked machine holds nothing that still opens this gateway's peer ingress.
    revokePeer(machineId)
    return removePeer((peer) => peer.machineId === machineId)
  }

  private async disconnect(sshAddress: string): Promise<MachinePeer | null> {
    const peer = findMachinePeer(sshAddress)
    if (!peer) return null
    const removed = await this.drop(peer.machineId)
    if (peer.owner) {
      try { await execFileAsync('ssh', [...peer.sshOptions, '--', peer.sshAddress, remoteCommand('peer-drop', { machineId: readPeerMachineId() })], { maxBuffer: 64 * 1024 }) }
      catch (error) { console.error(`[peer] remote peer cleanup failed for ${peer.sshAddress}: ${(error as Error).message}`) }
    }
    return removed
  }

  async close(): Promise<void> {
    this.closing = true
    if (this.retry) clearInterval(this.retry)
    for (const child of this.children.values()) try { child.kill('SIGTERM') } catch { /* already gone */ }
    this.children.clear()
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
