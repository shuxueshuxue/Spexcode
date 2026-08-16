import { mainCheckout, runtimeRoot } from '@spexcode/spec-core'
import { rotateCodexCurrentGeneration } from './codex-runtime-generations.js'
import { codexBinary, defaultLauncher, resolveLauncher, sessionIdentityEnvVars } from './harness.js'
import { commandHelp } from './help.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'

type RotateArgs = Readonly<{ launcher: string | null }>

function usageError(message: string): never {
  console.error(`spex runtime rotate codex: ${message}`)
  console.error('usage: spex runtime rotate codex [--launcher <name>]')
  process.exit(2)
}

function parseRotateArgs(args: string[]): RotateArgs {
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
  if (positionals.length !== 2 || positionals[0] !== 'rotate' || positionals[1] !== 'codex')
    usageError('expected rotate codex')
  return { launcher }
}

export async function runRuntimeRotate(args: string[]): Promise<void> {
  if (!args.length) {
    console.log(commandHelp('runtime'))
    return
  }
  const parsed = parseRotateArgs(args)
  const project = mainCheckout()
  const root = runtimeRoot()
  const launcherName = parsed.launcher ?? defaultLauncher(project)
  const launcher = resolveLauncher(launcherName, project)
  if (launcher.harness !== 'codex' && launcher.harness !== 'codex-headless') {
    usageError(`launcher '${launcher.name}' uses ${launcher.harness}; select a configured Codex launcher with --launcher`)
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
  console.log(`rotated Codex runtime ${rotation.previous.id} -> ${rotation.current.id} (launcher ${launcher.name})`)
}
