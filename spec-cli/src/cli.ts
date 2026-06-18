// @@@ spex - the SpexCode CLI. `spex lint` checks the spec<->code graph; `spex serve` runs the API.
export {} // make this a module so top-level await is allowed
const cmd = process.argv[2]

if (cmd === undefined || cmd === 'serve') {
  await import('./index.js')
} else if (cmd === 'lint') {
  const { specLint } = await import('./lint.js')
  const findings = specLint()
  const errors = findings.filter((f) => f.level === 'error')
  for (const f of findings) console.error(`  ${f.level === 'error' ? '✗' : '•'} ${f.rule}: ${f.msg}`)
  console.error(`spex lint: ${errors.length} error(s), ${findings.length - errors.length} warning(s)`)
  process.exit(errors.length ? 1 : 0)
} else {
  console.error(`spex: unknown command '${cmd}' (try: lint, serve)`)
  process.exit(2)
}
