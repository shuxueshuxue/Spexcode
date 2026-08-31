// @@@ the code linter ([[code-lint]]) - a deliberately small ruleset, and every rule here earns its place by
// having found something. This repository already answers most of what a linter is usually bought for:
// `tsc --noEmit` is strict and clean, `spex spec lint` owns the spec-to-code graph, [[dead-words]] owns
// product vocabulary, [[import-cycles]] owns module structure. What none of them can see is a binding no one
// reads, and after three refactors moved the harness implementations around, 172 of them had accumulated.
//
// So the config is subtractive on purpose. Rules that encode a house style this codebase has not chosen —
// `no-explicit-any` (413 hits, all deliberate boundary typing), `no-useless-escape`, `no-control-regex`,
// `no-regex-spaces`, `preserve-caught-error` — stay off, because a gate nobody can get to zero is a gate
// nobody runs. What is on, is on as an error.
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import js from '@eslint/js'
import ts from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// What must not be linted is already written down once, in .gitignore: build output, vendored trees,
// generated harness files, worktrees. A second hand-kept list here is the exact shape of bug this session
// spent its afternoon on — a roster that drifts away from the thing it describes — so the ignore set is
// derived instead. .gitignore carries no negations; if one is ever added, this needs to learn about it.
const repoRoot = dirname(fileURLToPath(import.meta.url))
function gitignoreGlobs() {
  const lines = readFileSync(`${repoRoot}/.gitignore`, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (lines.some((line) => line.startsWith('!'))) {
    throw new Error('.gitignore now has a negation; teach eslint.config.mjs how to translate it')
  }
  return lines.flatMap((entry) => {
    const bare = entry.replace(/\/$/, '')
    // A pattern with an interior slash is anchored at the repository root, exactly as git reads it.
    const anchored = bare.includes('/') && !bare.startsWith('**')
    const base = anchored ? bare : `**/${bare}`
    return entry.endsWith('/') ? [`${base}/**`] : [base, `${base}/**`]
  })
}

// The tree spans Node CLIs, Node scripts and a browser dashboard, and no single environment covers it. These
// are read-only ambient names, not a claim that every file may use every one of them.
const NODE = ['console', 'process', 'Buffer', 'URL', 'URLSearchParams', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone', 'fetch', 'TextEncoder',
  'TextDecoder', 'AbortController', 'AbortSignal', '__dirname', '__filename', 'require', 'module', 'exports',
  'globalThis', 'Intl']
const BROWSER = ['window', 'document', 'localStorage', 'sessionStorage', 'location', 'navigator', 'history',
  'EventSource', 'WebSocket', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver',
  'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'matchMedia', 'crypto', 'performance', 'alert', 'confirm', 'prompt', 'Image', 'Blob', 'File', 'FileReader',
  'FormData', 'Headers', 'Request', 'Response', 'DOMParser', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
  'WheelEvent', 'FocusEvent', 'InputEvent', 'TouchEvent', 'DragEvent', 'ClipboardEvent', 'Range', 'Selection',
  'getSelection', 'Highlight', 'CSS', 'CSSStyleSheet', 'HashChangeEvent', 'XMLHttpRequest', 'ShadowRoot',
  'SVGElement', 'DOMRect', 'btoa', 'atob', 'scrollTo', 'open', 'close', 'requestIdleCallback', 'cancelIdleCallback',
  'ReadableStream', 'WritableStream', 'TransformStream', 'MessageChannel', 'BroadcastChannel', 'indexedDB',
  'caches', 'Worker', 'SharedWorker', 'Notification', 'visualViewport', 'screen', 'parent', 'top', 'self', 'origin',
  // Named by browser-context bodies handed to Playwright's page.evaluate in the dashboard e2e suites.
  'MessageEvent', 'HTMLTextAreaElement', 'NodeFilter', 'DataTransfer', 'OffscreenCanvas', 'createImageBitmap',
  'addEventListener', 'removeEventListener', 'DOMMatrix', 'innerWidth', 'innerHeight']
const globals = Object.fromEntries([...NODE, ...BROWSER].map((name) => [name, 'readonly']))

const unused = ['error', {
  args: 'after-used',
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  // A caught error is routinely named for the reader and not used; the empty-catch comment carries the intent.
  caughtErrors: 'none',
  ignoreRestSiblings: true,
}]

export default [
  {
    ignores: [...gitignoreGlobs(), '**/*.d.ts', '.spec/**', 'docs/**', 'spec-dashboard/public/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // `catch { /* why */ }` is this codebase's way of saying the failure is expected and named in prose.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': unused,
      // `do { … } while (true)` is a loop idiom, not a constant-condition bug; `if (true)` still is.
      'no-constant-condition': ['error', { checkLoops: 'none' }],
      // Style, not defect: the escapes and regex spacing below are readable as written.
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-regex-spaces': 'off',
      'preserve-caught-error': 'off',
      // 35 sites, several of them deliberate initialize-then-overwrite. Left for its own pass rather than
      // rushed inside an unrelated change.
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: ts.parser },
    plugins: { '@typescript-eslint': ts.plugin },
    rules: {
      // The TypeScript-aware versions understand type-only bindings and declaration merging; the core rules
      // report both as unused.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': unused,
    },
  },
  {
    files: ['spec-dashboard/src/**/*.{js,jsx,ts,tsx}', 'packages/*-ui/src/**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // The dashboard already carries `eslint-disable-line react-hooks/exhaustive-deps` directives written
      // for a linter that was never configured. As a warning the rule makes those directives mean something
      // again without turning 22 judgement calls into a merge blocker.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
