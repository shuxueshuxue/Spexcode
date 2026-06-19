import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'
import { repoRoot } from './git.js'

// @@@ slash-commands - the data behind the dashboard input's `/` dropdown, computed the SAME way Claude
// Code computes its own `/` menu so the two stay in lockstep. This is the ONLY job here: produce
// [{name, description, source}]. It is DECOUPLED from any execution — the dashboard merely inserts the
// chosen `/<name> ` text. The list is the union of:
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

export function slashCommands(): SlashCommand[] {
  const home = homedir()
  const repo = repoRoot()
  const all: SlashCommand[] = []
  scanCommands(join(home, '.claude', 'commands'), 'user', all)
  scanCommands(join(repo, '.claude', 'commands'), 'project', all)
  for (const [name, description] of BUILT_IN) all.push({ name, description, source: 'built-in' })
  scanSkills(join(home, '.claude', 'skills'), all)
  scanSkills(join(repo, '.claude', 'skills'), all)

  const byName = new Map<string, SlashCommand>()
  for (const c of all) {
    const prev = byName.get(c.name)
    if (!prev || RANK[c.source] < RANK[prev.source]) byName.set(c.name, c)
  }
  return [...byName.values()].sort((a, b) => RANK[a.source] - RANK[b.source] || a.name.localeCompare(b.name))
}
