import { mainCheckout, runtimeRoot } from '@spexcode/spec-core'
import { rotateCodexCurrentGeneration } from './codex-runtime-generations.js'
import { codexBinary } from './codex-harness.js'
import { defaultLauncher, resolveLauncher, sessionIdentityEnvVars } from './harness.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'

type AppServerRepairArgs = Readonly<{ launcher: string | null }>

function usageError(message: string): never {
  console.error(`spex doctor repair app-server: ${message}`)
  console.error('usage: spex doctor repair app-server [--launcher <name>]')
  process.exit(2)
}

function parseAppServerRepairArgs(args: string[]): AppServerRepairArgs {
  const positionals: string[] = []
  let launcher: string | null = null
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--launcher') {
      const value = args[++index]
      if (!value || value.startsWith('--')) usageError('--launcher requires a configured launcher name')
      if (launcher !== null) usageError('--launcher may appear only once')
      launcher = value
    } else if (arg.startsWith('--')) usageError(`unknown flag ${arg}`)
    else positionals.push(arg)
  }
  if (positionals.length !== 2 || positionals[0] !== 'repair' || positionals[1] !== 'app-server')
    usageError('expected repair app-server')
  return { launcher }
}

export async function runDoctorRepairAppServer(args: string[]): Promise<number> {
  const parsed = parseAppServerRepairArgs(args)
  const project = mainCheckout()
  const root = runtimeRoot()
  const launcherName = parsed.launcher ?? defaultLauncher(project)
  const launcher = resolveLauncher(launcherName, project)
  if (launcher.harness !== 'codex' && launcher.harness !== 'codex-headless') {
    usageError(`launcher '${launcher.name}' does not provide a switchable app-server; select a configured Codex launcher with --launcher`)
  }
  const command = process.env.SPEXCODE_CODEX_SERVER_CMD || codexBinary(launcher.cmd)
  const env = { ...process.env }
  for (const key of sessionIdentityEnvVars()) delete env[key]
  const rotation = await rotateCodexCurrentGeneration(root, async (candidate) => {
    await spawnDetachedRuntime({
      cwd: root,
      logFile: candidate.logFile,
      pidFile: candidate.pidFile,
      receiptFile: candidate.receiptFile,
      command,
      args: ['app-server', '--listen', `unix://${candidate.socketPath}`],
      env,
    })
  })
  console.log(`switched app-server ${rotation.previous.id} -> ${rotation.current.id} (launcher ${launcher.name})`)
  return 0
}
