---
concern: an existing deployment never receives new or changed template .config nodes on upgrade (z-code lacked stop-gate entirely and its workers hung in working). Fresh spex init gets everything; an old .spec gets nothing. Needs a migration affordance: doctor should detect missing core template nodes and print (or apply) the migration.
by: 1a47519f-6024-419d-ac56-4814e289b86a
status: open
nodes: doctor
created: 2026-07-11T11:50:18.196Z
---

(no detail given — an existing deployment never receives new or changed template .config nodes on upgrade (z-code lacked stop-gate entirely and its workers hung in working). Fresh spex init gets everything; an old .spec gets nothing. Needs a migration affordance: doctor should detect missing core template nodes and print (or apply) the migration.)
