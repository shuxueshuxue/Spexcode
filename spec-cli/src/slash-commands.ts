import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'
import { repoRoot } from './git.js'

// the `/` dropdown data: the union of BUILT_IN + ~/.claude & repo .claude commands (subdirs namespace `a:b`)
// + skills, computed like Claude Code's own `/` menu. Insert-only — nothing here executes; unreadable
// skills/plugins/MCP contribute nothing rather than being guessed.

export type SlashCommand = { name: string; description: string; source: 'built-in' | 'user' | 'project' | 'skill' }

// captured live from `claude --dangerously-skip-permissions` v2.1.x by typing `/` and paging the dropdown;
// version-specific — re-capture this block to refresh for a new CC version (the disk-discovered sources don't).
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

// describe precedence (mirrors CC): a `description:` frontmatter line wins, else the first non-empty body
// line (leading `#` stripped). Frontmatter parsing is intentionally one `key: value` line.
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

// ordering mirrors CC: custom (user, then project), then built-in, then skills; alphabetical within each
// group. A same-named custom command shadows a built-in — dedupe keeps the higher-priority source.
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
