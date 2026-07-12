// The SEED extractor — the research-phase R5b heuristic (column-0 declarations, balanced-bracket class
// bodies, comment-aware range boundaries), kept ONLY so the benchmark pipeline runs before the real seam
// (spec-cli/src/anchors.ts) merges. Once run.ts wires the real extractors, this row stops being scored;
// it is the pipeline's bootstrap, not a product extractor.
export type Unit = { name: string; kind: string; start: number; end: number; typeOnly?: boolean }
export type ExtractorLike = {
  id: string
  claims(ext: string): boolean
  ready(): true | string
  extract(content: string, filename: string): Unit[]
}

const JS_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'])
const balance = (s: string) => { let n = 0; for (const ch of s) { if ('([{'.includes(ch)) n++; else if (')]}'.includes(ch)) n-- } return n }

// split a declarator-list head on top-level commas: `COLS = 220, ROWS = 50` -> [COLS, ROWS]
function declNames(head: string): string[] {
  let d = 0, seg = ''
  const segs: string[] = []
  for (const ch of head) {
    if ('([{<'.includes(ch)) d++
    else if (')]}>'.includes(ch)) d--
    if (ch === ',' && d === 0) { segs.push(seg); seg = '' } else seg += ch
  }
  segs.push(seg)
  return segs.map((s) => s.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|=|$)/)?.[1]).filter((x): x is string => !!x)
}

export const seedR5b: ExtractorLike = {
  id: 'seed-r5b',
  claims: (ext) => JS_EXTS.has(ext),
  ready: () => true,
  extract(content) {
    const lines = content.split('\n')
    const units: Unit[] = []
    let cls: string | null = null, depth = 0
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      let m: RegExpMatchArray | null
      if (cls) {
        if ((m = l.match(/^\s+(?:(?:public|private|protected|static|readonly|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/))
          && !/^(if|for|while|switch|return|catch|new|await|typeof|throw|else|do)$/.test(m[1]))
          units.push({ name: `${cls}.${m[1]}`, kind: 'method', start: i + 1, end: i + 1 })
        depth += balance(l)
        if (depth <= 0) cls = null
        continue
      }
      if ((m = l.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/))) units.push({ name: m[1], kind: 'function', start: i + 1, end: i + 1 })
      else if ((m = l.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) { units.push({ name: m[1], kind: 'class', start: i + 1, end: i + 1 }); cls = m[1]; depth = balance(l) }
      else if ((m = l.match(/^(?:export\s+)?(?:declare\s+)?(?:enum|interface|type)\s+([A-Za-z_$][\w$]*)/))) units.push({ name: m[1], kind: 'typeish', start: i + 1, end: i + 1 })
      else if ((m = l.match(/^(?:export\s+)?(?:const|let|var)\s+(.+)$/)))
        for (const name of declNames(m[1])) units.push({ name, kind: 'const', start: i + 1, end: i + 1 })
    }
    // R5b ranges: a unit ends before the next column-0 boundary line (identifier OR comment start, so a
    // trailing comment block attaches to the NEXT unit); a method is also capped by the next unit's start.
    const bset: number[] = []
    for (let i = 0; i < lines.length; i++) if (/^(?:[A-Za-z_$]|\/\/|\/\*)/.test(lines[i])) bset.push(i + 1)
    const starts = units.map((u) => u.start).sort((a, b) => a - b)
    for (const u of units) {
      const nb = bset.find((b) => b > u.start)
      let end = nb ?? lines.length + 1
      if (u.kind === 'method') { const ns = starts.find((x) => x > u.start); if (ns && ns < end) end = ns }
      u.end = Math.max(u.start, end - 1)
    }
    return units
  },
}
