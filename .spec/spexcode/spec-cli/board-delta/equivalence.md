# board-delta — equivalence with full refetch

The claim: a dashboard consuming the delta stream renders, at every step, exactly what a full `/api/board`
refetch at that moment would have given it. This document is the argument; `boardDelta.test.ts` sweeps its
lemmas with randomized property tests.

## Model

A **board** is a JSON value `B = { nodes: N[], sessions: S[], ...meta }` where every element of `nodes` and
`sessions` carries a string `id`.

**Unitization** `U(B)` is the finite map:

```
U(B) = { "node:"+n.id ↦ n        | n ∈ B.nodes }
     ∪ { "sess:"+s.id ↦ s        | s ∈ B.sessions }
     ∪ { "nodes#order" ↦ [n.id]  (in array order) }
     ∪ { "sess#order"  ↦ [s.id]  (in array order) }
     ∪ { "meta" ↦ B \ {nodes, sessions} }
```

**Precondition P(B)**: `nodes` and `sessions` are arrays and their ids are non-empty strings, unique within
their array. `unitize` *reports* P (`ok`) rather than assuming it.

**Reconstruction** `R(M)` rebuilds `{ ...M("meta"), nodes: M("nodes#order").map(id ↦ M("node:"+id)),
sessions: likewise }`.

**Diff** and **apply** over unit maps:

```
diff(M, M')  = ( set = { k ↦ M'(k) | k ∈ dom M', M(k) ≠ M'(k) or k ∉ dom M },
                 del = { k | k ∈ dom M, k ∉ dom M' } )
apply(M, (set, del)) = (M restricted to dom M \ del) overridden by set
```

Value equality is JSON-serialization equality. That is conservative in exactly the safe direction: equal
strings imply equal values, so `diff` may at worst re-send an unchanged unit (a key-order difference between
builds), never miss a changed one.

**Tag** `t(M)`: a digest over the sorted `(key, hash(serialized value))` pairs. Assumption (A1): the digest
is collision-free over the snapshots a deployment ever produces — the standard content-hash assumption,
shared with git itself.

## Lemma 1 (reconstruction). If P(B) then R(U(B)) = B.

`meta` restores every top-level field other than the two arrays, by construction. For `nodes`:
`U(B)("nodes#order")` is exactly the id sequence of `B.nodes` in order, and by P each id keys exactly one
`node:` unit holding that element, so the map over the order list reproduces the array element-wise, in
order. Likewise `sessions`. ∎

(Without P, two same-id elements collapse into one unit and R loses one — which is why P gates the chain:
see Invariant below.)

## Lemma 2 (round trip). apply(U(B), diff(U(B), U(B'))) = U(B').

Pointwise over keys `k`. If `k ∈ del`: `k ∉ dom U(B')` and apply removes it — agree. If `k ∈ set`: apply
yields `U(B')(k)` — agree. Otherwise `k ∈ dom U(B) ∩ dom U(B')` with equal serialization, so
`U(B)(k) = U(B')(k)` — agree. Domains: apply's domain is `(dom U(B) \ del) ∪ dom set = dom U(B')`. ∎

## Invariant (per connection). After the client processes its i-th non-ping event, its unit map M_i and tag
τ_i satisfy: **M_i = U(B_i) and τ_i = t(U(B_i)) for some snapshot B_i the server actually built, with P(B_i).**

Induction over one SSE connection's event sequence — which TCP delivers ordered and lossless; a drop ends
the connection and restarts the induction at its reconnect's `board-full`.

*Base*: the first event is `board-full {to, board}` (sent on every connect). The client sets
M = U(board), τ = to; the server computed `to = t(U(board))` from the same decomposition. The server only
anchors a chain on snapshots where P held (a P-violating build broadcasts fulls and clears the anchor), and
a full send re-establishes the invariant regardless.

*Step*: the event is `board-delta {from, to, set, del}`. The server built it as
`diff(U(B_prev), U(B_next))` where `t(U(B_prev)) = from`, `t(U(B_next)) = to`, and P held for both (a
P-violating B_next is never sent as a delta; a P-violating B_prev cleared the anchor, so no delta chains
from it). The client applies only when `τ_i = from`; by (A1), `U(B_i) = U(B_prev)`, so by Lemma 2 the
applied map is exactly `U(B_next)` and the new tag `to` matches it. On `τ_i ≠ from` (a full-fetch raced the
stream, or state predates a server restart) the client applies nothing and reopens the stream — bounded,
explicit recovery to the base case. ∎

## Theorem (observational equivalence). Every board the delta client renders is R(M_i) = B_i — a true, whole
server snapshot (Lemma 1 + the invariant). The rendered sequence is therefore a subsequence of the server's
snapshot sequence, exactly as for a full-refetch poller; staleness is bounded by the push debounce + one
build on the hot path and by the cold tick period on the cold path, the same bound class as the fallback
poll it replaces. No client ever renders a state that mixes two snapshots.

## Corollary (guaranteed win). The server ships `min(|delta|, |full|)` by explicit comparison, so per change
a delta subscriber transfers no more than a refetching one (up to the ~100-byte envelope), and strictly less
whenever any unit survives unchanged; an unchanged tag ships nothing. Worst case degrades to exactly the
status quo, never below it.

## Trust boundary

The client does not re-verify hashes; it trusts the server's `from`/`to` bookkeeping (they run the same
audited pure module, and the property tests pin the algebra). The failure mode of a hypothetical server-side
diff bug is a wrongly-rendered board *until the next full* (reconnect, resync, or cold-path full send) — it
cannot persist, because every full re-establishes the invariant unconditionally.
