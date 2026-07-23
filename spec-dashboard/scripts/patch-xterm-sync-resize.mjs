import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../node_modules/@xterm/xterm/', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

if (pkg.version !== '6.0.0') {
  throw new Error(`xterm synchronized-resize patch requires 6.0.0, found ${pkg.version}`)
}

const patches = [
  {
    file: 'src/browser/services/RenderService.ts',
    from: `    if (this._coreService.decPrivateModes.synchronizedOutput) {
      this._syncOutputHandler.bufferRows(start, end);
      return;
    }

    const buffered = this._syncOutputHandler.flush();`,
    to: `    if (this._coreService.decPrivateModes.synchronizedOutput) {
      this._syncOutputHandler.bufferRows(start, end);
      return;
    }

    this._pausedResizeTask.flush();
    const buffered = this._syncOutputHandler.flush();`,
  },
  {
    file: 'src/browser/services/RenderService.ts',
    from: `    if (this._isPaused) {
      this._pausedResizeTask.set(() => this._renderer.value?.handleResize(cols, rows));`,
    to: `    if (this._isPaused || this._coreService.decPrivateModes.synchronizedOutput) {
      this._pausedResizeTask.set(() => this._renderer.value?.handleResize(cols, rows));`,
  },
  {
    file: 'lib/xterm.mjs',
    from: 'if(this._coreService.decPrivateModes.synchronizedOutput){this._syncOutputHandler.bufferRows(e,i);return}let n=this._syncOutputHandler.flush();',
    to: 'if(this._coreService.decPrivateModes.synchronizedOutput){this._syncOutputHandler.bufferRows(e,i);return}this._pausedResizeTask.flush();let n=this._syncOutputHandler.flush();',
  },
  {
    file: 'lib/xterm.mjs',
    from: 'this._isPaused?this._pausedResizeTask.set(()=>this._renderer.value?.handleResize(e,i)):this._renderer.value.handleResize(e,i)',
    to: '(this._isPaused||this._coreService.decPrivateModes.synchronizedOutput)?this._pausedResizeTask.set(()=>this._renderer.value?.handleResize(e,i)):this._renderer.value.handleResize(e,i)',
  },
  {
    file: 'lib/xterm.js',
    from: 'if(this._coreService.decPrivateModes.synchronizedOutput)return void this._syncOutputHandler.bufferRows(e,t);const s=this._syncOutputHandler.flush();',
    to: 'if(this._coreService.decPrivateModes.synchronizedOutput)return void this._syncOutputHandler.bufferRows(e,t);this._pausedResizeTask.flush();const s=this._syncOutputHandler.flush();',
  },
  {
    file: 'lib/xterm.js',
    from: 'this._isPaused?this._pausedResizeTask.set((()=>this._renderer.value?.handleResize(e,t))):this._renderer.value.handleResize(e,t)',
    to: '(this._isPaused||this._coreService.decPrivateModes.synchronizedOutput)?this._pausedResizeTask.set((()=>this._renderer.value?.handleResize(e,t))):this._renderer.value.handleResize(e,t)',
  },
  {
    file: 'src/browser/renderer/dom/DomRendererRowFactory.ts',
    from: `          cellAmount++;
          continue;`,
    to: `          charElement.style.width = \`\${parseFloat(charElement.style.width) + width * cellWidth}px\`;
          cellAmount++;
          continue;`,
  },
  {
    file: 'src/browser/renderer/dom/DomRendererRowFactory.ts',
    from: `      if (spacing !== this.defaultSpacing) {
        charElement.style.letterSpacing = \`\${spacing}px\`;
      }

      elements.push(charElement);`,
    to: `      if (spacing !== this.defaultSpacing) {
        charElement.style.letterSpacing = \`\${spacing}px\`;
      }
      charElement.style.display = 'inline-block';
      charElement.style.width = \`\${width * cellWidth}px\`;
      charElement.style.overflow = 'hidden';
      charElement.style.verticalAlign = 'top';

      elements.push(charElement);`,
  },
  {
    file: 'lib/xterm.mjs',
    from: 'x.isInvisible()?R+=we:R+=ze,A++;continue',
    to: 'x.isInvisible()?R+=we:R+=ze,f.style.width=`${parseFloat(f.style.width)+T*a}px`,A++;continue',
  },
  {
    file: 'lib/xterm.mjs',
    from: 'Ke!==this.defaultSpacing&&(f.style.letterSpacing=`${Ke}px`),d.push(f)',
    to: 'Ke!==this.defaultSpacing&&(f.style.letterSpacing=`${Ke}px`),f.style.display="inline-block",f.style.width=`${T*a}px`,f.style.overflow="hidden",f.style.verticalAlign="top",d.push(f)',
  },
  {
    file: 'lib/xterm.js',
    from: 'F.isInvisible()?w+=o.WHITESPACE_CELL_CHAR:w+=j,y++;continue',
    to: 'F.isInvisible()?w+=o.WHITESPACE_CELL_CHAR:w+=j,b.style.width=`${parseFloat(b.style.width)+C*c}px`,y++;continue',
  },
  {
    file: 'lib/xterm.js',
    from: 'M!==this.defaultSpacing&&(b.style.letterSpacing=`${M}px`),m.push(b)',
    to: 'M!==this.defaultSpacing&&(b.style.letterSpacing=`${M}px`),b.style.display="inline-block",b.style.width=`${C*c}px`,b.style.overflow="hidden",b.style.verticalAlign="top",m.push(b)',
  },
  // Pointer belongs to the browser, wheel belongs to tmux. Plain drag always makes a LOCAL selection
  // even while the pane application owns mouse-report mode: button events never become reports (the
  // dashboard's copy gesture stays modifier-free), while wheel reports still flow to tmux, whose
  // rebinds route them to copy-mode history — the agent TUI receives no mouse events at all (mouse
  // input is what stalls claude's repaint loop for ~10s, the frozen-timer bug's true root).
  {
    file: 'src/browser/services/SelectionService.ts',
    from: `  public shouldForceSelection(event: MouseEvent): boolean {
    if (Browser.isMac) {
      return event.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection;
    }

    return event.shiftKey;
  }`,
    to: `  public shouldForceSelection(event: MouseEvent): boolean {
    return true; // spexcode: pointer is always the browser's — buttons never become mouse reports
  }`,
  },
  {
    file: 'lib/xterm.mjs',
    from: 'shouldForceSelection(e){return Zt?e.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:e.shiftKey}',
    to: 'shouldForceSelection(e){return!0}',
  },
  {
    file: 'lib/xterm.js',
    from: 'shouldForceSelection(e){return c.isMac?e.altKey&&this._optionsService.rawOptions.macOptionClickForcesSelection:e.shiftKey}',
    to: 'shouldForceSelection(e){return!0}',
  },
]

const changed = new Set()
for (const patch of patches) {
  const path = new URL(patch.file, root)
  let source = readFileSync(path, 'utf8')
  if (source.includes(patch.to)) continue
  const occurrences = source.split(patch.from).length - 1
  if (occurrences !== 1) {
    throw new Error(`xterm patch source mismatch in ${join('@xterm/xterm', patch.file)} (${occurrences} matches)`)
  }
  source = source.replace(patch.from, patch.to)
  writeFileSync(path, source)
  changed.add(patch.file)
}

console.log(changed.size ? `patched xterm terminal invariants: ${[...changed].join(', ')}` : 'xterm terminal invariants already patched')
