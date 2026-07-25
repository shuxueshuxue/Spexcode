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

The supported language is compact agent Markdown: headings, emphasis, links, blockquotes, ordered and unordered
lists, fenced and inline code, tables, strikethrough, and soft line breaks. KaTeX renders inline and display math
written with `$...$` / `$$...$$` or `\(...\)` / `\[...\]`. Math inside code stays code. An invalid expression
stays visibly readable rather than blanking the message or throwing through React. Inline math never crosses a
code span or line break, so ordinary currency, shell variables, and escaped dollar signs remain prose.

The renderer treats conversation text as untrusted. Source HTML is disabled, unsafe link schemes never become
anchors, KaTeX trust is off, and no agent-authored script/event attribute can execute. Generated HTML has one
audited insertion point inside `RichText`; callers never use `dangerouslySetInnerHTML` themselves.

Layout remains chat-dense. Markdown blocks remove browser-default outer margins, code preserves whitespace and
scrolls horizontally, tables and display equations scroll within the message instead of widening the session
pane, and long unbroken prose still wraps. KaTeX's stylesheet rides the lazy TimelineChat module, so graph and
review pages do not download math styling. No syntax highlighter, HTML sanitizer, general math plugin, Markdown
editor, or second message model is added.
