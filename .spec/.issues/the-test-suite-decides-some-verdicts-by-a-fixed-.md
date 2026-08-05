---
concern: the test suite decides some verdicts by a fixed wall-clock budget, which a loaded box can flip on its own
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: taste
created: 2026-08-05T17:51:42.425Z
---

Measured on trunk 8966f1085, spec-cli suite, Node 22, /proc/loadavg ~11.6:

    not ok 481 - session new uses lightweight instance authority and falls back only for
                 explicit connection refusal
    failureType: 'testTimeoutFailure'   error: 'test timed out after 20000ms'

The evidence that this is the box and not the code is its immediate neighbour in the same
file, which PASSED while taking 38.9 seconds:

    ok 482 - public session create is bounded, rollback-clean, idempotent, and publishes
             exact Git state        duration_ms: 38947

A 20s budget cannot separate "the fallback path is wrong" from "this machine is busy", so
under load the suite reports a behavioural failure for a scheduling fact.

This is the same rule [[taste]] 22 states for measurement, now pointing at our own tests: on
a loaded box a fixed wall-clock threshold is not a claim. The repair direction is the one that
worked there — anchor the assertion on something load-independent (was a connection actually
refused? how many child processes were spawned?) and let duration be a symptom, not the
verdict. Recording it rather than acting on it now; it is not tonight's lane.
