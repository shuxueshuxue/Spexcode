---
concern: Product output is half Chinese on an English machine; the dashboard follows the locale but the CLI and backend do not /tmp/lang-issue.md
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: landed
created: 2026-09-03T03:48:52.875Z
---

(no detail given — Product output is half Chinese on an English machine; the dashboard follows the locale but the CLI and backend do not /tmp/lang-issue.md)

<!-- reply: 8bb006f2-ff07-46c9-a216-83c6e32f7777 @ 2026-09-03T15:08:39.229Z -->
The body of this thread was lost at filing — I passed a non-existent `--body-file` flag, which `spex issue open` silently absorbed (see spex-issue-open-silently-absorbs-an-unknown-flag), so the path landed in the concern line and the report became "(no detail given)". The intended body, verbatim:

The product's own strings should be one language, chosen by the machine, not a mix.

The dashboard already follows the OS locale: [[i18n]]'s picker reads `localStorage['spexcode.lang']`
first and otherwise maps `navigator.language` (zh* -> zh, else en), so on an English Mac the desktop
app and the project-management hub both render English — measured in the packaged app
(`document.documentElement.lang = en`, `navigator.language = en-US`).

What is NOT locale-aware is the text the CLI and the backend emit. Those strings are hardcoded, and
some of them are Chinese, so an English machine still gets Chinese sentences out of the same product.
Two in the project-setup path are now English (the initial commit message and the config-moved
warning in [[host-gateway]]). Three coupled sites remain, and each needs a decision rather than a
blind translation:

- `packages/spec-core/src/layout.ts` — the config-migration warning [[portable-layout]]. It is the
  string the backend actually prints; `config-layout.test.ts` asserts on its Chinese text, and the
  package is consumed from its built `dist`, so changing it touches a build a live backend runs.
- `spec-cli/src/cli.ts` — three notices [[cli-surface]]. One of them is matched by a regex on its
  Chinese wording (`/仅 ack\/eval，正文未变 \(empty=true\)/u`), so the string and its consumer move together.
- `spec-cli/src/flat.ts` — the Flatcode page [[flat]] is deliberately Chinese; it is authored content,
  not UI chrome, and probably should stay as it is.

The shape of the fix worth deciding first: whether CLI/backend output joins the dashboard's locale
mechanism (a real message catalogue keyed on the host locale), or whether product output is simply
English everywhere and Chinese is reserved for authored content like the Flatcode page. Half-changing
the strings — the state this issue records — is the outcome to avoid.

Spec: portable-layout, cli-surface, flat
