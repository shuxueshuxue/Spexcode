---
title: rich conversation
status: active
hue: 268
desc: TimelineChat renders agent-authored prose as safe, compact Markdown with KaTeX mathematics through one small renderer boundary.
code:
  - spec-dashboard/src/RichText.js
related:
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/richText.test.mjs
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/rich-conversation.e2e.mjs
  - spec-dashboard/package.json
  - spec-dashboard/package-lock.json
---

# rich conversation

## raw source

The terminal-free conversation should render the formats coding agents naturally write: Markdown for structured
answers and LaTeX for mathematics. Rich output must remain readable and safe when the agent emits malformed,
hostile, or very large content, without turning `TimelineChat` into a second rendering framework.

## expanded spec

One `RichText` component is the whole rendering boundary. `TimelineChat` sends every human-authored prose field
through it: the originating prompt, sent messages, and authored status notes. One module-scoped parser handles
them all; the timeline never constructs a parser per row and never grows its own Markdown branches.

The supported language is compact agent Markdown: headings, emphasis, links, images (including remote image
URLs), blockquotes, ordered and unordered lists, fenced and inline code, tables, strikethrough, and soft line
breaks. KaTeX renders inline and display math written with `$...$` / `$$...$$` or `\(...\)` / `\[...\]`. Math
inside code stays code. An invalid expression stays visibly readable rather than blanking the message or throwing
through React. Inline math never crosses a code span or line break, so ordinary currency, shell variables, and
escaped dollar signs remain prose.

The renderer keeps markdown-it and KaTeX's default untrusted-source behavior: source HTML is text and unsafe URL
schemes do not become active content. It adds no sanitizer, image allowlist, remote-content policy, or other custom
content filter. Generated HTML has one audited insertion point inside `RichText`; callers never use
`dangerouslySetInnerHTML` themselves.

Rendered mathematics remains ordinary selectable conversation content. KaTeX's accessibility and visual DOM
representations identify one owning math token. A selection intersecting any portion of that token copies the
formula atomically as its complete authored TeX source exactly once, rather than exposing a glyph-level rule tied
to KaTeX internals or concatenating MathML, annotation, and visual fallback text.
All non-math portions keep the browser Range's native text serialization, so this does not become a second prose
parser or change the conversation's focus-preserving custom-highlight selection model.

Layout remains chat-dense. Markdown blocks remove browser-default outer margins, images shrink to the message
width while retaining their aspect ratio, code preserves whitespace and scrolls horizontally, tables and display
equations scroll within the message instead of widening the session pane, and long unbroken prose still wraps.
KaTeX's stylesheet rides the lazy TimelineChat module, so graph and review pages do not download math styling. No
syntax highlighter, HTML sanitizer, general math plugin, Markdown editor, or second message model is added.
