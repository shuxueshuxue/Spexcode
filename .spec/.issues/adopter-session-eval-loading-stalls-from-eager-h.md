---
concern: Adopter session/eval loading stalls from eager historical session work
by: human
status: open
nodes: session-console, session-eval, evals-view
created: 2026-07-24T03:50:29.820Z
---

Spec: [[session-console]] [[session-eval]] [[evals-view]]

YATU evidence (2026-07-24): local :5173 and zcode :100.99.97.58:5173 both mounted hidden TimelineChat/session layers while opening #/evals. Each headless row immediately fetched timeline + session detail; zcode had 4 hidden chats and the local board had 2. At adopter scale this is hundreds of reads plus 8s timers. After the bounded mount fix, a fresh Evals route issued zero session timeline/detail requests; selecting one headless row mounted one conversation, and leaving it stopped its timer.

Separate cold-path evidence: /api/graph is the global boot gate and /api/evals + /api/evals/detail await getBoard(); local cold builds measured 1.5-4.0s with graph budget warnings and zcode has seen multi-second cold responses. The projection cache also scheduled every session summary and scoped demand waited on global idle, so retained CR history could block one selected eval. This patch makes offline summaries demand-only and keeps live summary batching.

Residual follow-up: decouple route shell/eval detail from cold graph and add explicit bounded timeout/error states for review requests; do not change zcode production data.
