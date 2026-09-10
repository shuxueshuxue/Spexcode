#!/usr/bin/env node
// Builds the atlas plugin — plugins/atlas, in the layout both Claude Code and ZCode install — and this repository's
// marketplace manifest, from the atlas skill preset that `spex init` also seeds ([[atlas-plugin]]). The preset is
// the one source: the plugin adds only what a repository without SpexCode needs first, the install and adopt
// steps. `--check` fails when the committed files are stale (a preset edit, a version bump).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProjection } from './sync-init-plugins.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
// While the line is a prerelease, the diagram verbs exist only under npm's `next` tag.
const install = version.includes('-') ? 'spexcode@next' : 'spexcode'

// The same projection the init templates are written from, so the plugin says exactly what adopters are seeded.
const preset = buildProjection().get(join('skills', 'atlas', 'spec.md'))
if (!preset) throw new Error('.spec/spexcode/.plugins/skills/atlas/spec.md is missing')
const [, frontmatter, body] = preset.content.toString('utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? []
const trigger = frontmatter?.match(/^desc:\s*(.+)$/m)?.[1]?.trim()
if (!trigger || !body) throw new Error('the atlas preset needs a desc: line and a body')
// The skill's own title stays first; the install steps sit between it and the campaign.
const [, title, rest] = body.trimStart().match(/^(# [^\n]+)\n([\s\S]*)$/) ?? []
if (!title) throw new Error('the atlas preset body must open with its # title')

const description = 'Draw a spec atlas for a repository: choose the spec nodes worth a picture and draw each one\'s diagram with SpexCode, checked until it passes.'
const repository = 'https://github.com/shuxueshuxue/spexcode'
const homepage = 'https://spexcode.net'
const bootstrap = `## Before you start

This skill draws with SpexCode's command line.

- Run \`spex --version\`. If there is no \`spex\`, install it once: \`npm i -g ${install}\` (Node 22 or newer).
- If the repository has no \`.spec/\` tree yet, adopt it: \`spex init --harness <your harness>\` (claude, zcode, codex,
  …). Then describe the project in its root \`spec.md\` and grow the child nodes worth drawing — a diagram draws a
  node's children, so the tree comes first.
- \`spex guide diagram\` is the manual for the format and the loop; read it once.

`
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const files = new Map([
  ['plugins/atlas/.claude-plugin/plugin.json', json({
    name: 'atlas', displayName: 'SpexCode Atlas', version, description,
    author: { name: 'SpexCode', url: homepage }, homepage, repository, license: 'MIT',
    keywords: ['spec', 'architecture', 'diagram', 'spexcode'],
  })],
  ['plugins/atlas/.zcode-plugin/plugin.json', json({
    name: 'atlas', version, description, author: { name: 'SpexCode', url: homepage }, homepage, repository,
    license: 'MIT', skills: 'skills',
  })],
  ['plugins/atlas/skills/atlas/SKILL.md', `---\nname: atlas\ndescription: ${JSON.stringify(trigger)}\n---\n\n${title}\n\n${bootstrap}${rest.trimStart()}`],
  ['.claude-plugin/marketplace.json', json({
    name: 'spexcode',
    description: 'SpexCode\'s agent skills, packaged for Claude Code and ZCode.',
    owner: { name: 'SpexCode', url: homepage },
    plugins: [{ name: 'atlas', source: './plugins/atlas', description }],
  })],
])

if (process.argv.includes('--check')) {
  const stale = [...files].filter(([path, content]) => !existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== content)
  if (stale.length) {
    console.error(`atlas plugin is stale (${stale.map(([path]) => path).join(', ')}) — run npm run build:atlas-plugin`)
    process.exit(1)
  }
} else {
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  console.log(`atlas plugin: wrote ${files.size} files at ${version}`)
}
