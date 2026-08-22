---
concern: codex launch readiness intermittently times out: native identity / first-turn rollout receipt never arrives; session stuck queued/idle silently (hit 4x on 2026-08-22: 07e9b824 + 049b7dd5 both ALSO refuse close with 'unbound: launch or recovery still in progress'; 4e1d8537 recovered by a plain send; 12a22ee3 cleared by kill+redispatch). Demands: (1) readiness timeout -> loud terminal state with reason on the record, never silent queued; (2) close must work for provably-dead unbound sessions; (3) launch recovery around backend restarts must complete or terminalize, not limbo. Spec: listener-readiness
by: ded4b563-50b9-4146-b860-e98e0d073700
status: open
nodes: listener-readiness
created: 2026-08-22T14:30:58.141Z
---

(no detail given — codex launch readiness intermittently times out: native identity / first-turn rollout receipt never arrives; session stuck queued/idle silently (hit 4x on 2026-08-22: 07e9b824 + 049b7dd5 both ALSO refuse close with 'unbound: launch or recovery still in progress'; 4e1d8537 recovered by a plain send; 12a22ee3 cleared by kill+redispatch). Demands: (1) readiness timeout -> loud terminal state with reason on the record, never silent queued; (2) close must work for provably-dead unbound sessions; (3) launch recovery around backend restarts must complete or terminalize, not limbo. Spec: listener-readiness)
