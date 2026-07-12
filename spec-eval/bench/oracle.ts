// The truth generator: parse each frozen corpus snapshot with the TypeScript compiler AST (JSX-aware)
// and enumerate anchorable units with exact start/end lines -> truth.json. Corpus and truth are frozen
// TOGETHER — regenerate only when the corpus itself changes (a new language sample, a deliberate refresh),
// never against live files (they evolve and the scores would drift).
// Run: npx tsx spec-eval/bench/oracle.ts
// Non-JS languages need no oracle: their truth entries may be hand-labeled and merged into truth.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const BENCH = dirname(fileURLToPath(import.meta.url))
const ts = createRequire(join(BENCH, '../package.json'))('typescript')

export type TruthUnit = { name: string; kind: string; start: number; end: number; typeOnly?: boolean; tier?: string }

export function oracleUnits(text: string, fileName: string): { units: TruthUnit[]; parseErrors: number } {
  const kind = fileName.endsWith('.jsx') ? ts.ScriptKind.JSX
    : fileName.endsWith('.tsx') ? ts.ScriptKind.TSX
    : fileName.endsWith('.ts') ? ts.ScriptKind.TS
    : ts.ScriptKind.JS
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const units: TruthUnit[] = []
  // start at the declaration's own start (after leading comments/trivia); end at the node end
  const push = (name: string, ukind: string, node: any, extra: Partial<TruthUnit> = {}) =>
    units.push({ name, kind: ukind, start: line(node.getStart(sf)), end: line(node.end), ...extra })
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st)) {
      push(st.name ? st.name.text : '(default)', 'function', st)
    } else if (ts.isClassDeclaration(st)) {
      const cname = st.name ? st.name.text : '(default)'
      push(cname, 'class', st)
      for (const m of st.members) {
        if ((ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) && m.body) {
          const mname = ts.isConstructorDeclaration(m) ? 'constructor' : (m.name && ts.isIdentifier(m.name) ? m.name.text : '(computed)')
          push(`${cname}.${mname}`, 'method', m, { tier: 'method' })
        }
      }
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue // destructuring — not anchorable by one name
        const fn = d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        // range = the whole statement; multi-declarator lines co-move, each name shares the range
        units.push({ name: d.name.text, kind: fn ? 'const-fn' : 'const-data', start: line(st.getStart(sf)), end: line(st.end) })
      }
    } else if (ts.isEnumDeclaration(st)) push(st.name.text, 'enum', st)
    else if (ts.isInterfaceDeclaration(st)) push(st.name.text, 'interface', st, { typeOnly: true })
    else if (ts.isTypeAliasDeclaration(st)) push(st.name.text, 'type', st, { typeOnly: true })
  }
  return { units, parseErrors: sf.parseDiagnostics?.length ?? 0 }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const manifest = JSON.parse(readFileSync(join(BENCH, 'corpus/manifest.json'), 'utf8'))
  const out = []
  for (const { snap, file, cls } of manifest.entries) {
    const text = readFileSync(join(BENCH, 'corpus', snap), 'utf8')
    let { units, parseErrors } = oracleUnits(text, file)
    // negative controls (shell/html) parse as garbage under a JS grammar — ground truth is ZERO
    // anchorable units; parseErrors stays recorded as the tell an extractor must gate on.
    if (cls === 'control') units = []
    out.push({ file, cls, nLines: text.split('\n').length, parseErrors, units })
    const methods = units.filter((u) => u.tier === 'method').length
    console.log(`${file} [${cls}] parseErr=${parseErrors}: ${units.length - methods} top-level units, ${methods} methods`)
  }
  writeFileSync(join(BENCH, 'truth.json'), JSON.stringify(out, null, 1))
  console.log('\nwrote truth.json')
}
