import { readFileSync } from 'node:fs'

const evidence = readFileSync(new URL('../../docs/session-architecture-concept-map.md', import.meta.url), 'utf8')
if (!evidence.includes('External ZSwarm use is unproven.')) {
  throw new Error('expected G.1 L09 evidence marker is missing')
}
process.stderr.write('no executable proof available at this base: repository has no production ZSwarm importer\n')
process.exit(77)
