import test from 'node:test'
import assert from 'node:assert/strict'
import { renderRichText } from './RichText.js'

test('renders compact agent Markdown and both inline and display math', () => {
  const html = renderRichText([
    '# Result',
    '',
    '**bold** and ~~old~~ with $E = mc^2$ and \\(a+b\\).',
    '',
    '| x | y |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '$$\\int_0^1 x^2 dx$$',
    '',
    '\\[\\frac{1}{2}\\]',
    '',
    '```js',
    "const price = '$5'",
    '```',
  ].join('\n'))

  assert.match(html, /<h1>Result<\/h1>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<s>old<\/s>/)
  assert.match(html, /<table>/)
  assert.match(html, /class="katex"/)
  assert.match(html, /class="katex-block"/)
  assert.match(html, /<pre><code class="language-js">const price = '\$5'/)
})

test('renders Markdown images while keeping unsafe markup and invalid math readable', () => {
  const html = renderRichText([
    '<img src=x onerror="globalThis.pwned=1">',
    '',
    '[unsafe](javascript:globalThis.pwned=1)',
    '',
    '![unsafe image](javascript:globalThis.pwned=1)',
    '',
    '![remote](https://example.test/render.svg "preview")',
    '',
    '$\\definitelyNotACommand{$',
  ].join('\n'))

  assert.doesNotMatch(html, /href="javascript:/i)
  assert.doesNotMatch(html, /src="javascript:/i)
  assert.match(html, /&lt;img src=x onerror=&quot;globalThis\.pwned=1&quot;&gt;/)
  assert.match(html, /<img src="https:\/\/example\.test\/render\.svg" alt="remote" title="preview">/)
  assert.match(html, /katex-error/)
  assert.match(html, /definitelyNotACommand/)
})

test('preserves soft line breaks and does not parse math inside code', () => {
  const html = renderRichText([
    'first',
    'second',
    '',
    '`$x^2$`',
    '',
    '```math',
    '\\frac{1}{2}',
    '```',
  ].join('\n'))

  assert.match(html, /first<br>\nsecond/)
  assert.match(html, /<code>\$x\^2\$<\/code>/)
  assert.match(html, /<pre><code class="language-math">/)
  assert.equal((html.match(/class="katex"/g) || []).length, 0)
})

test('keeps currency, shell variables in code, and escaped dollars out of math', () => {
  const html = renderRichText('Cost is $5 and $10 today. Use `$HOME` or \\$PATH outside code.')

  assert.match(html, /Cost is \$5 and \$10 today/)
  assert.match(html, /<code>\$HOME<\/code>/)
  assert.match(html, /\$PATH outside code/)
  assert.equal((html.match(/class="katex"/g) || []).length, 0)
})

test('does not let unmatched math cross code spans, line breaks, or display delimiters', () => {
  const html = renderRichText([
    'An unmatched $price before `$HOME` stays text.',
    'A newline does not close it: $x',
    'and neither does this$.',
    '',
    'Inline $$x^2$$ remains literal.',
  ].join('\n'))

  assert.match(html, /unmatched \$price before <code>\$HOME<\/code>/)
  assert.match(html, /\$x<br>\nand neither does this\$\./)
  assert.match(html, /Inline \$\$x\^2\$\$ remains literal/)
  assert.equal((html.match(/class="katex"/g) || []).length, 0)
})

test('requires display math to close and leaves malformed blocks readable', () => {
  const html = renderRichText([
    '$$',
    '\\sum_{i=1}^n i',
    '$$',
    '',
    '\\[',
    '\\frac{a}{b}',
    '\\]',
    '',
    '$$',
    'never closed',
  ].join('\n'))

  assert.equal((html.match(/class="katex-block"/g) || []).length, 2)
  assert.match(html, /\$\$<br>\nnever closed/)
})

test('renders math through Markdown nesting without treating code as a formula', () => {
  const html = renderRichText([
    '> Inline \\(x+1\\)',
    '>',
    '> $$y^2$$',
    '',
    '- \\(z\\)',
    '- `$not_math$`',
  ].join('\n'))

  assert.match(html, /<blockquote>/)
  assert.match(html, /<ul>/)
  assert.equal((html.match(/class="katex"/g) || []).length, 3)
  assert.match(html, /<code>\$not_math\$<\/code>/)
})
