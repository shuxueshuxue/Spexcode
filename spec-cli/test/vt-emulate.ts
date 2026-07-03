// A minimal VT emulator: just enough of cursor motion + line/display erase to detect a DOUBLED frame in a
// bridge byte stream (used by the live-view repaint proofs). It is deliberately small — it models the handful
// of sequences a repaint frame and an Ink-style relative redraw emit, and treats everything else (SGR, DEC
// private modes) as a no-op. Returns the visible rows, right-trimmed.
export function emulate(bytes: Buffer, cols: number, rows: number): string[] {
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(' '))
  let r = 0, c = 0
  const clampR = () => { if (r < 0) r = 0; if (r > rows - 1) r = rows - 1 }
  const scroll = () => { grid.shift(); grid.push(Array(cols).fill(' ')) }
  const s = bytes
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === 0x1b) {
      if (s[i + 1] === 0x5d) { // OSC \x1b] … terminated by BEL or ST(\x1b\\)
        i += 2; while (i < s.length && !(s[i] === 0x07 || (s[i] === 0x1b && s[i + 1] === 0x5c))) i++
        if (s[i] === 0x1b) i++ // consume the backslash of ST
        continue
      }
      if (s[i + 1] === 0x5b) { // CSI \x1b[
        let j = i + 2, params = ''
        while (j < s.length && !((s[j] >= 0x40 && s[j] <= 0x7e))) { params += String.fromCharCode(s[j]); j++ }
        const final = String.fromCharCode(s[j]); i = j
        const nums = params.replace(/^\?/, '').split(';').map((x) => parseInt(x || '0', 10))
        const n0 = nums[0] || 0
        if (params.startsWith('?')) continue // DEC private mode set/reset — ignore
        switch (final) {
          case 'H': case 'f': r = (nums[0] || 1) - 1; c = (nums[1] || 1) - 1; clampR(); break
          case 'A': r -= (n0 || 1); clampR(); break
          case 'B': r += (n0 || 1); clampR(); break
          case 'C': c += (n0 || 1); break
          case 'D': c -= (n0 || 1); if (c < 0) c = 0; break
          case 'G': c = (n0 || 1) - 1; break
          case 'J': { // erase in display: 0=below,1=above,2=all
            if (n0 === 2) { for (let y = 0; y < rows; y++) grid[y].fill(' ') }
            else if (n0 === 0) { for (let x = c; x < cols; x++) grid[r][x] = ' '; for (let y = r + 1; y < rows; y++) grid[y].fill(' ') }
            else { for (let y = 0; y < r; y++) grid[y].fill(' '); for (let x = 0; x <= c; x++) grid[r][x] = ' ' }
            break
          }
          case 'K': { // erase in line
            if (n0 === 2) grid[r].fill(' ')
            else if (n0 === 0) { for (let x = c; x < cols; x++) grid[r][x] = ' ' }
            else { for (let x = 0; x <= c; x++) grid[r][x] = ' ' }
            break
          }
          default: break // SGR 'm' and everything else: ignore
        }
        continue
      }
      i++; continue // other ESC (stray ST, ESC 7/8): skip the next byte
    }
    if (ch === 0x0d) { c = 0; continue }
    if (ch === 0x0a) { r++; if (r > rows - 1) { r = rows - 1; scroll() } continue }
    if (ch === 0x08) { if (c > 0) c--; continue }
    if (ch < 0x20) continue
    if (c < cols) { grid[r][c] = String.fromCharCode(ch); c++ } // printable; the ASCII marker's count is unaffected by wide-char cells
  }
  return grid.map((row) => row.join('').replace(/\s+$/, ''))
}
