import { codexLaunchCommand } from './harness.js'

// Codex headless keeps the existing app-server bootstrap and backend-owned thread/start + first turn, but
// deliberately omits the final interactive `--remote … resume` attach. The shared app-server remains the
// durable home for the thread; follow-up delivery uses codexHarness' existing JSON-RPC transport.
export function codexHeadlessLaunchCommand(
  id: string,
  codexCmd = 'codex',
  serverCmd?: string,
  dir?: string,
): string {
  return codexLaunchCommand(id, codexCmd, serverCmd, dir, false)
}
