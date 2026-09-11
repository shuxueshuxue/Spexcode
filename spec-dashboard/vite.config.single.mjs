import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.js'

// The public shell as ONE file ([[public-spec-graph]]): `spex graph --public --html` embeds a payload into it,
// and the page is opened from wherever that file lands — often a disk path, where a browser loads nothing
// beside it. So every chunk, stylesheet and font goes inside: dynamic imports fold into the entry chunk, assets
// become data URLs, and the entry script and stylesheet are written into index.html itself.
const inlineIntoHtml = () => ({
  name: 'spexcode-inline-into-html',
  enforce: 'post',
  // `order: 'post'` runs this after Vite's own generateBundle, which is where the preload markers inside the
  // chunk code are filled in — inlining before that would ship an unresolved `__VITE_PRELOAD__`.
  generateBundle: { order: 'post', handler(_options, bundle) {
    const html = Object.values(bundle).find((file) => file.type === 'asset' && file.fileName === 'index.html')
    if (!html) throw new Error('single-file build: no index.html in the bundle')
    let text = String(html.source)
    for (const file of Object.values(bundle)) {
      if (file === html) continue
      const ref = `./${file.fileName}`
      if (file.type === 'chunk' && file.isEntry) {
        const tag = new RegExp(`<script type="module" crossorigin src="${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></script>`)
        if (!tag.test(text)) throw new Error(`single-file build: entry ${file.fileName} is not referenced by index.html`)
        // `</script` inside the code would end the element early; `<\/script` is the same string to JS.
        text = text.replace(tag, () => `<script type="module">${file.code.replaceAll('</script', '<\\/script')}</script>`)
        delete bundle[file.fileName]
      } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
        const tag = new RegExp(`<link rel="stylesheet" crossorigin href="${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`)
        if (!tag.test(text)) throw new Error(`single-file build: stylesheet ${file.fileName} is not referenced by index.html`)
        text = text.replace(tag, () => `<style>${String(file.source).replaceAll('</style', '<\\/style')}</style>`)
        delete bundle[file.fileName]
      }
    }
    const left = Object.keys(bundle).filter((name) => name !== 'index.html')
    if (left.length) throw new Error(`single-file build: ${left.length} file(s) would still sit beside the page: ${left.slice(0, 5).join(', ')}`)
    html.source = text
  } },
})

export default mergeConfig(base, defineConfig({
  plugins: [inlineIntoHtml()],
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
}))
