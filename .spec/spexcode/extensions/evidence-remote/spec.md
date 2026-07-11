---
title: evidence-remote
status: pending
hue: 150
desc: A shared content-addressed evidence remote — teammates see each other's evidence bytes; the hosted instance is the commercialization seam. PENDING.
---
# evidence-remote

**Status: pending.** This node is the *intent*; the remote service will be its **own repository** (an
[[extensions]] satellite — no in-repo code here, link added once the repo exists). The thin client seam it
plugs into stays in core, governed by [[eval-core]].

## the gap it closes

SpexCode's evidence architecture is already half of git-lfs: bytes are sha256 content-addressed blobs kept
**out of git**, while the readings that reference them (by hash) are **committed** ([[eval-core]]). That
split is correct — and it means the pointers travel to every collaborator through ordinary git sync while
the bytes stay stranded on the machine that measured them. A teammate pulls the repo, sees every reading,
and gets "miss original file" for every screenshot and video. Multi-person collaboration is exactly where
evidence matters most, and it is exactly where it currently evaporates.

## the mechanism

Not a new system — the **remote tier of the store that already exists**. A team configures one `blobRemote`
URL; each member keeps running their own local SpexCode as before.

- **Deliberately dumb remote.** Content-addressed GET/PUT by hash, token-authed, stateless. Because blobs
  are immutable and self-verifying, the remote needs no coordination, no merge logic, no schema.
- **Local store becomes a cache.** Writes push through to the remote; a local miss tries the remote before
  declaring "miss original file" ([[eval-tab]]'s terminal state becomes a cache miss first). One
  mechanism, two tiers — no separate "upload" concept.
- **Opt-in and severable.** No `blobRemote` configured → behaviour today, byte-for-byte. The self-launch
  path stays the full experience; the remote only widens who can *see* evidence, never gates a feature.
- **The port pattern applies.** The client speaks a minimal driver interface, so "the remote" can be our
  hosted service, a self-hosted instance, or an object-store bucket — same seam [[port]] cut for forges.

## the commercialization direction

"Git is the database" pushed to its conclusion yields the GitHub model: **the product is open, the business
is hosting what git can't hold.** The protocol and drivers are open source (self-hosters lose nothing); the
paid offering is the hosted remote — durability, team tokens, retention, bandwidth — plus whatever cloud
data services later prove worth running centrally (evidence archives for the public read-only board, org
dashboards). Charging for *kept bytes* forks no code and withholds no feature, which is the least resented
seam an open-core project can monetize.

## what it is deliberately not

- **Not a multi-tenant SpexCode server.** Collaboration stays "everyone runs their own"; a shared server
  running permission-skipping agents for multiple users is a trust surface we refuse. [[public-mode]]'s
  shared-password fast-lane remains the only auth in core.
- **Not user identity.** Attribution stays session-based (commit trailers, the reading's `by` session). If teams later
  need human-level identity, it rides on that as a thin layer — never as accounts gating sessions.
- **Not required for the public board.** A read-only shared board is a separate consumer that merely
  becomes *good* once blobs resolve; it is not this node's contract.
