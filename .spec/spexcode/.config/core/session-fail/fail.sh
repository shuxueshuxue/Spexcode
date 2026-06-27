#!/usr/bin/env bash
# Mark the session errored when a turn ends on an API failure (StopFailure).
exec ${SPEX:-spex} session fail
