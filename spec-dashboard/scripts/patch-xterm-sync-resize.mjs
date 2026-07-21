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

console.log(changed.size ? `patched xterm synchronized resize: ${[...changed].join(', ')}` : 'xterm synchronized resize already patched')
