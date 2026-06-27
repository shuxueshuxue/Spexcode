import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'
import { repoRoot } from './git.js'

// @@@ slash-commands - the data behind the new-session input's `/` dropdown, computed the SAME way the
// chosen HARNESS computes its own `/` menu so the two stay in lockstep. This module is the slash surface of
// the [[harness-adapter]]: one menu builder per harness (`claudeSlashCommands` / `codexSlashCommands`), wired
// into the adapters in harness.ts. The ONLY job here: produce [{name, description, source}]. It is DECOUPLED
// from any execution — the dashboard merely inserts the chosen `/<name> ` text.
//
// The Claude list is the union of:
//   · BUILT_IN   - the large fixed set CC ships (seeded below from a live capture, see the comment there)
//   · user       - ~/.claude/commands/**/*.md          (subdirs namespace as `a:b`)
//   · project    - <repo>/.claude/commands/**/*.md
//   · skill      - ~/.claude/skills/*/SKILL.md + <repo>/.claude/skills/*/SKILL.md   (best-effort)
// Skills/plugins/MCP that aren't readable as files simply contribute nothing — we never guess.

export type SlashCommand = { name: string; description: string; source: 'built-in' | 'user' | 'project' | 'skill' }

// @@@ BUILT_IN seed - captured LIVE from `claude --dangerously-skip-permissions` v2.1.x by typing `/`
// and paging the dropdown (the built-in block, alphabetical /add-dir … /workflows). This is the one
// part that is version-specific: to refresh for a new CC version, re-capture that block and replace this
// array. Custom/user/project/skill commands are discovered from disk and need no maintenance.
const BUILT_IN: ReadonlyArray<readonly [string, string]> = [
  ['add-dir', 'Add a new working directory'],
  ['advisor', 'Let Claude consult a stronger model at key moments'],
  ['agents', 'Manage agent configurations'],
  ['autofix-pr', 'Monitor and autofix any issues with the current PR'],
  ['background', 'Send this session to the background and free the terminal'],
  ['branch', 'Create a branch of the current conversation at this point'],
  ['btw', 'Ask a quick side question without interrupting the main conversation'],
  ['chrome', 'Open Claude in Chrome (beta) settings'],
  ['clear', 'Start a new session with empty context; previous session stays on disk (resumable with /resume)'],
  ['color', 'Set the prompt bar color for this session'],
  ['compact', 'Free up context by summarizing the conversation so far'],
  ['config', 'Open settings'],
  ['context', 'Visualize current context usage as a colored grid'],
  ['copy', "Copy Claude's last response to clipboard (or /copy N for the Nth-latest)"],
  ['desktop', 'Continue the current session in Claude Desktop'],
  ['diff', 'View uncommitted changes and per-turn diffs'],
  ['doctor', 'Diagnose and verify your Claude Code installation and settings'],
  ['effort', 'Set effort level for model usage'],
  ['exit', 'Exit the CLI'],
  ['export', 'Export the current conversation to a file or clipboard'],
  ['fast', 'Toggle fast mode (Opus 4.8)'],
  ['feedback', 'Submit feedback, report a bug, or share your conversation'],
  ['focus', 'Toggle focus view: just your prompt, summary, and response'],
  ['fork', 'Spawn a background agent that inherits the full conversation'],
  ['goal', 'Set a goal Claude checks before stopping'],
  ['help', 'Show help and available commands'],
  ['hooks', 'View hook configurations for tool events'],
  ['ide', 'Manage IDE integrations and show status'],
  ['install-github-app', 'Set up Claude GitHub Actions for a repository'],
  ['install-slack-app', 'Install the Claude Slack app'],
  ['keybindings', 'Open your keyboard shortcuts file'],
  ['login', 'Sign in with your Anthropic account'],
  ['logout', 'Sign out from your Anthropic account'],
  ['mcp', 'Manage MCP servers'],
  ['memory', 'Open a memory file in your editor'],
  ['mobile', 'Show QR code to download the Claude mobile app'],
  ['model', 'Set the AI model for Claude Code'],
  ['permissions', 'Manage allow and deny tool permission rules'],
  ['plan', 'Enable plan mode or view the current session plan'],
  ['plugin', 'Manage Claude Code plugins'],
  ['powerup', 'Discover Claude Code features through quick interactive lessons'],
  ['privacy-settings', 'View and update your privacy settings'],
  ['radio', 'Listen to Claude FM lo-fi radio'],
  ['recap', 'Generate a one-line session recap now'],
  ['release-notes', 'View release notes'],
  ['reload-plugins', 'Activate pending plugin changes in the current session'],
  ['reload-skills', 'Pick up skills added or changed on disk during this session'],
  ['remote-control', 'Control this session from your phone or claude.ai/code'],
  ['remote-env', 'Choose the default environment for cloud agents'],
  ['rename', 'Rename the current conversation'],
  ['resume', 'Resume a previous conversation'],
  ['rewind', 'Restore the code and/or conversation to a previous point'],
  ['sandbox', 'Configure sandbox settings'],
  ['skills', 'List available skills'],
  ['status', 'Show Claude Code status including version, model, account, API connectivity, and tool statuses'],
  ['stickers', 'Order Claude Code stickers'],
  ['tasks', 'View and manage everything running in the background'],
  ['teleport', 'Resume a Claude Code session from claude.ai'],
  ['terminal-setup', 'Install Shift+Enter key binding for newlines'],
  ['theme', 'Change the theme'],
  ['tui', 'Set the terminal UI renderer (default | fullscreen)'],
  ['ultraplan', 'Draft an editable plan in Claude Code on the web'],
  ['ultrareview', 'Start a cloud agent that finds and verifies bugs in your branch'],
  ['upgrade', 'Upgrade to Max for higher rate limits and more Opus'],
  ['usage', 'Show session cost, plan usage, and activity stats'],
  ['usage-credits', 'Configure usage credits to keep working when you hit a limit'],
  ['voice', 'Toggle voice mode'],
  ['web-setup', 'Set up Claude Code on the web with your GitHub account'],
  ['workflows', 'Browse running and completed workflows'],
]

// @@@ description - same precedence CC uses for custom commands: a `description:` frontmatter line wins,
// else the first non-empty body line (stripped of leading `#`). Frontmatter parsing is deliberately
// tiny (one `key: value` line); we only need `description`.
function describe(src: string): string {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const fm = m ? m[1] : ''
  const body = m ? m[2] : src
  for (const line of fm.split('\n')) {
    const d = line.match(/^\s*description\s*:\s*(.+?)\s*$/)
    if (d) return d[1].replace(/^["']|["']$/g, '')
  }
  for (const line of body.split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim()
    if (t) return t
  }
  return ''
}

// walk a commands/ dir; name = path under it minus `.md`, subdirs joined `a:b` (CC's namespace syntax).
function scanCommands(root: string, source: 'user' | 'project', out: SlashCommand[]) {
  if (!existsSync(root)) return
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.md')) {
        const name = relative(root, p).replace(/\.md$/, '').split('/').join(':')
        out.push({ name, description: describe(readFileSync(p, 'utf8')), source })
      }
    }
  }
  walk(root)
}

// best-effort skills: each skill is a dir with a SKILL.md whose `name:` (or dir name) is the command.
function scanSkills(root: string, out: SlashCommand[]) {
  if (!existsSync(root)) return
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const skillFile = join(root, e.name, 'SKILL.md')
    if (e.isDirectory() && existsSync(skillFile)) {
      const src = readFileSync(skillFile, 'utf8')
      const nm = src.match(/^---\n[\s\S]*?\nname\s*:\s*(.+?)\s*\n[\s\S]*?\n---/m)
      out.push({ name: (nm ? nm[1] : e.name).trim(), description: describe(src), source: 'skill' })
    }
  }
}

// @@@ ordering - mirror what CC shows: custom (user, then project) first, then the built-in block, then
// skills; alphabetical within each group. A custom command shadows a built-in of the same name (custom
// wins) — dedupe by name keeping the higher-priority source.
const RANK: Record<SlashCommand['source'], number> = { user: 0, project: 1, 'built-in': 2, skill: 3 }

// dedupe by name keeping the higher-priority source, then sort by source rank then name.
function dedupeSort(all: SlashCommand[]): SlashCommand[] {
  const byName = new Map<string, SlashCommand>()
  for (const c of all) {
    const prev = byName.get(c.name)
    if (!prev || RANK[c.source] < RANK[prev.source]) byName.set(c.name, c)
  }
  return [...byName.values()].sort((a, b) => RANK[a.source] - RANK[b.source] || a.name.localeCompare(b.name))
}

export function claudeSlashCommands(): SlashCommand[] {
  const home = homedir()
  const repo = repoRoot()
  const all: SlashCommand[] = []
  scanCommands(join(home, '.claude', 'commands'), 'user', all)
  scanCommands(join(repo, '.claude', 'commands'), 'project', all)
  for (const [name, description] of BUILT_IN) all.push({ name, description, source: 'built-in' })
  scanSkills(join(home, '.claude', 'skills'), all)
  scanSkills(join(repo, '.claude', 'skills'), all)
  return dedupeSort(all)
}

// @@@ CODEX_BUILT_IN seed - Codex's `/` menu, taken from the codex-rs source of the pinned version
// (tui/src/slash_command.rs, codex-cli 0.142.3): the `SlashCommand` enum in PRESENTATION order with each
// `description()`. Discovered, not guessed — the same discipline as the Claude capture; to refresh for a new
// codex, re-read that enum. We drop the ones codex itself hides from a normal session: the debug-only
// (`rollout`, `test-approval`), the explicit DO-NOT-USE (`debug-m-drop`/`debug-m-update`), and the
// windows-only `sandbox-add-read-dir`. Feature-gated commands are kept (best-effort: the menu is informational).
const CODEX_BUILT_IN: ReadonlyArray<readonly [string, string]> = [
  ['model', 'choose what model and reasoning effort to use'],
  ['ide', 'include current selection, open files, and other context from your IDE'],
  ['permissions', 'choose what Codex is allowed to do'],
  ['keymap', 'remap TUI shortcuts'],
  ['vim', 'toggle Vim mode for the composer'],
  ['setup-default-sandbox', 'set up elevated agent sandbox'],
  ['experimental', 'toggle experimental features'],
  ['approve', 'approve one retry of a recent auto-review denial'],
  ['memories', 'configure memory use and generation'],
  ['skills', 'use skills to improve how Codex performs specific tasks'],
  ['import', 'import setup, this project, and recent chats from Claude Code'],
  ['hooks', 'view and manage lifecycle hooks'],
  ['review', 'review my current changes and find issues'],
  ['rename', 'rename the current thread'],
  ['new', 'start a new chat during a conversation'],
  ['archive', 'archive this session and exit'],
  ['delete', 'permanently delete this session and exit'],
  ['resume', 'resume a saved chat'],
  ['fork', 'fork the current chat'],
  ['app', 'continue this session in Codex Desktop'],
  ['init', 'create an AGENTS.md file with instructions for Codex'],
  ['compact', 'summarize conversation to prevent hitting the context limit'],
  ['plan', 'switch to Plan mode'],
  ['goal', 'set or view the goal for a long-running task'],
  ['agent', 'switch the active agent thread'],
  ['side', 'start a side conversation in an ephemeral fork'],
  ['btw', 'start a side conversation in an ephemeral fork'],
  ['copy', 'copy last response as markdown'],
  ['raw', 'toggle raw scrollback mode for copy-friendly terminal selection'],
  ['diff', 'show git diff (including untracked files)'],
  ['mention', 'mention a file'],
  ['status', 'show current session configuration and token usage'],
  ['usage', 'view account usage or use a usage limit reset'],
  ['debug-config', 'show config layers and requirement sources for debugging'],
  ['title', 'configure which items appear in the terminal title'],
  ['statusline', 'configure which items appear in the status line'],
  ['theme', 'choose a syntax highlighting theme'],
  ['pets', 'choose or hide the terminal pet'],
  ['mcp', 'list configured MCP tools; use /mcp verbose for details'],
  ['apps', 'manage apps'],
  ['plugins', 'browse plugins'],
  ['logout', 'log out of Codex'],
  ['quit', 'exit Codex'],
  ['exit', 'exit Codex'],
  ['feedback', 'send logs to maintainers'],
  ['ps', 'list background terminals'],
  ['stop', 'stop all background terminals'],
  ['clear', 'clear the terminal and start a new chat'],
  ['personality', 'choose a communication style for Codex'],
  ['subagents', 'switch the active agent thread'],
]

// @@@ codexSlashCommands - Codex's `/` menu, computed the way Codex computes its own: its built-ins (above) +
// the user's saved prompts in `$CODEX_HOME/prompts/*.md` (each filename becomes `/<name>`, codex's custom-
// prompt convention). Like the Claude builder it NEVER guesses — plugin commands that aren't readable as
// simple files contribute nothing. Presentation order: built-ins first (codex's enum order), then prompts.
export function codexSlashCommands(): SlashCommand[] {
  const all: SlashCommand[] = []
  for (const [name, description] of CODEX_BUILT_IN) all.push({ name, description, source: 'built-in' })
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  scanCommands(join(codexHome, 'prompts'), 'user', all)   // saved prompts → /<basename>
  // codex built-ins keep their enum (presentation) order; user prompts sort after, alphabetical.
  const seen = new Map<string, SlashCommand>()
  const order: string[] = []
  for (const c of all) { if (!seen.has(c.name)) order.push(c.name); if (!seen.has(c.name) || RANK[c.source] < RANK[seen.get(c.name)!.source]) seen.set(c.name, c) }
  const builtins = order.filter((n) => seen.get(n)!.source === 'built-in').map((n) => seen.get(n)!)
  const prompts = [...seen.values()].filter((c) => c.source !== 'built-in').sort((a, b) => a.name.localeCompare(b.name))
  return [...builtins, ...prompts]
}
