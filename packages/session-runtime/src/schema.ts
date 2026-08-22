import type { ComponentMigration } from '@spexcode/session-protocol'

export const RUNTIME_BINDINGS_MIGRATIONS: readonly ComponentMigration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE session_runtime_bindings (
  namespace             TEXT    NOT NULL,
  protocol_session_id   TEXT    NOT NULL REFERENCES protocol_sessions(session_id),
  runtime_kind          TEXT    NOT NULL,
  native_session_id     TEXT    NOT NULL,
  native_start_token    TEXT    NOT NULL,
  binding_generation    INTEGER NOT NULL,
  status                TEXT    NOT NULL,
  bound_at_ms           INTEGER NOT NULL,
  unbound_at_ms         INTEGER,
  metadata_json         TEXT    NOT NULL,
  PRIMARY KEY (namespace, protocol_session_id),
  CHECK (length(namespace) BETWEEN 1 AND 128),
  CHECK (namespace NOT GLOB '*[^0-9A-Za-z._:/-]*'),
  CHECK (length(runtime_kind) BETWEEN 1 AND 64),
  CHECK (runtime_kind NOT GLOB '*[^0-9A-Za-z._:-]*'),
  CHECK (length(native_session_id) BETWEEN 1 AND 512),
  CHECK (length(native_start_token) BETWEEN 1 AND 512),
  CHECK (binding_generation >= 1),
  CHECK (status IN ('bound', 'unbound')),
  CHECK (bound_at_ms >= 0),
  CHECK (unbound_at_ms IS NULL OR unbound_at_ms >= bound_at_ms),
  CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  CHECK (length(metadata_json) <= 8192),
  CHECK ((status = 'bound' AND unbound_at_ms IS NULL)
      OR (status = 'unbound' AND unbound_at_ms IS NOT NULL))
) STRICT;

CREATE INDEX session_runtime_bindings_native
  ON session_runtime_bindings (runtime_kind, native_session_id, status);
`,
  },
]
