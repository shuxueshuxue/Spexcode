#!/usr/bin/env node
// digest.mjs — locate a dead session's transcript on disk and print a compact markdown digest.
// Usage: node digest.mjs <session-id | path/to/transcript.jsonl>
// Read-only: never resumes, prompts, or mutates the session. Exit 1 (loud) when no transcript is found.
//
// Harness coverage: claude (projects/<enc-cwd>/<id>.jsonl) and codex (sessions/YYYY/MM/DD/rollout-*<id>.jsonl).
// The digest keeps the high-signal stream — user prompts in full, assistant text, tool calls as one-liners,
// error results — and drops the bulk (tool outputs, attachments, sidechains, reasoning).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const arg = process.argv[2]
if (!arg) { console.error('usage: digest.mjs <session-id | transcript.jsonl>'); process.exit(1) }

const TRUNC = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n) + ` …[+${s.length - n} chars]` : s }

// ---- locate -------------------------------------------------------------
const claudeRoots = () => {
  const roots = []
  if (process.env.CLAUDE_CONFIG_DIR) roots.push(process.env.CLAUDE_CONFIG_DIR)
  for (const e of readdirSync(homedir(), { withFileTypes: true }))
    if (e.isDirectory() && e.name.startsWith('.claude')) roots.push(join(homedir(), e.name))
  return roots
}
const findClaude = (id) => {
  for (const root of claudeRoots()) {
    const proj = join(root, 'projects')
    if (!existsSync(proj)) continue
    for (const d of readdirSync(proj)) {
      const f = join(proj, d, `${id}.jsonl`)
      if (existsSync(f)) return f
    }
  }
  return null
}
const findCodex = (id) => {
  const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
  if (!existsSync(root)) return null
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(join(dir, e.name))
      else if (e.name.startsWith('rollout-') && e.name.includes(id) && e.name.endsWith('.jsonl')) return join(dir, e.name)
    }
  }
  return null
}
const file = arg.endsWith('.jsonl') ? arg : (findClaude(arg) || findCodex(arg))
if (!file || !existsSync(file)) { console.error(`no transcript found for "${arg}" (searched claude projects/ and codex sessions/)`); process.exit(1) }

// ---- parse --------------------------------------------------------------
const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
const out = []
const meta = { cwd: null, branch: null, first: null, last: null }
const filesTouched = new Set()
let errors = 0
const seen = new Set()

// harness-injected preamble arrives typed as "user" (system-reminders, AGENTS.md folds, codex permission/skill
// blocks) — it is noise to a digest, and real human prompts essentially never open with these markers.
const isInjected = (t) => /^(<|# AGENTS\.md instructions|Caveat: The messages below)/.test(t.trimStart())
const userBlock = (t) => { t = String(t ?? '').trim(); return t && !isInjected(t) ? `\n## user\n${t}` : null }

const toolLine = (name, input = {}) => {
  if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && input.file_path) filesTouched.add(input.file_path)
  const hint = input.description || input.file_path || input.command || input.prompt || input.query || input.pattern || ''
  return `→ ${name}${hint ? ` · ${TRUNC(hint, 160)}` : ''}`
}

for (const raw of lines) {
  let l; try { l = JSON.parse(raw) } catch { continue }
  const ts = l.timestamp
  if (ts) { meta.first ||= ts; meta.last = ts }
  if (l.cwd) meta.cwd ||= l.cwd
  if (l.gitBranch && l.gitBranch !== 'HEAD') meta.branch ||= l.gitBranch

  // claude shape: {type: user|assistant, message:{content}, isSidechain}
  if (l.type === 'user' || l.type === 'assistant') {
    if (l.isSidechain) continue // subagent noise
    const c = l.message?.content
    if (typeof c === 'string') { const u = userBlock(c); if (u) out.push(u); continue }
    for (const item of c || []) {
      if (item.type === 'text' && item.text?.trim()) {
        if (l.type === 'user') { const u = userBlock(item.text); if (u) out.push(u) }
        else out.push(TRUNC(item.text, 2000))
      }
      else if (item.type === 'tool_use') out.push(toolLine(item.name, item.input))
      else if (item.type === 'tool_result' && item.is_error) {
        errors++
        const t = Array.isArray(item.content) ? item.content.map((x) => x.text || '').join(' ') : item.content
        out.push(`⚠ tool error: ${TRUNC(t, 400)}`)
      }
    }
    continue
  }

  // codex shape: {type: session_meta|response_item|event_msg, payload:{...}}. The same message is logged
  // BOTH as a response_item and an event_msg (version-dependent which exists) — dedupe on the text.
  const p = l.payload
  if (!p) continue
  if (l.type === 'session_meta') { meta.cwd ||= p.cwd; continue }
  const pushMsg = (role, text) => {
    text = String(text ?? '').trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    if (role === 'user') { const u = userBlock(text); if (u) out.push(u) }
    else if (role === 'assistant') out.push(TRUNC(text, 2000)) // developer/system roles are harness plumbing
  }
  if (l.type === 'event_msg' && (p.type === 'user_message' || p.type === 'agent_message'))
    pushMsg(p.type === 'user_message' ? 'user' : 'assistant', p.message)
  else if (l.type === 'response_item') {
    if (p.type === 'message') {
      pushMsg(p.role, (p.content || []).map((x) => x.text || '').join('\n'))
    } else if (p.type === 'function_call') {
      let input = {}; try { input = JSON.parse(p.arguments || '{}') } catch {}
      out.push(toolLine(p.name, input))
    } else if (p.type === 'function_call_output' && /error/i.test(String(p.output).slice(0, 200))) {
      errors++
      out.push(`⚠ tool error: ${TRUNC(p.output, 400)}`)
    }
  }
}

// ---- emit ---------------------------------------------------------------
const kb = Math.round(statSync(file).size / 1024)
console.log(`# transcript digest — ${arg}`)
console.log(`- file: ${file} (${kb} KB, ${lines.length} lines)`)
if (meta.first) console.log(`- span: ${meta.first} → ${meta.last}`)
if (meta.cwd) console.log(`- cwd: ${meta.cwd}`)
if (meta.branch) console.log(`- branch: ${meta.branch}`)
console.log(out.join('\n'))
console.log(`\n---\n- tool errors seen: ${errors}`)
if (filesTouched.size) console.log(`- files edited:\n${[...filesTouched].map((f) => `  - ${f}`).join('\n')}`)
