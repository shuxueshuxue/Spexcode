import type { ComponentMigration } from '@spexcode/session-protocol'

export const TOPOLOGY_MIGRATION_SQL = `
CREATE TABLE topology_edges (
  edge_id          TEXT    NOT NULL PRIMARY KEY,
  from_session_id  TEXT    NOT NULL REFERENCES protocol_sessions(session_id),
  to_session_id    TEXT    NOT NULL REFERENCES protocol_sessions(session_id),
  relation_type    TEXT    NOT NULL,
  created_at_ms    INTEGER NOT NULL,
  removed_at_ms    INTEGER,
  CHECK (length(edge_id) = 32 AND edge_id NOT GLOB '*[^0-9a-f]*'),
  CHECK (from_session_id <> to_session_id),
  CHECK (length(relation_type) BETWEEN 1 AND 64),
  CHECK (relation_type NOT GLOB '*[^0-9A-Za-z._:-]*'),
  CHECK (created_at_ms >= 0),
  CHECK (removed_at_ms IS NULL OR removed_at_ms >= 0)
) STRICT;

CREATE UNIQUE INDEX topology_active_edge
  ON topology_edges (from_session_id, to_session_id, relation_type)
  WHERE removed_at_ms IS NULL;

CREATE INDEX topology_active_to
  ON topology_edges (to_session_id, relation_type, from_session_id)
  WHERE removed_at_ms IS NULL;
`

export const TOPOLOGY_MIGRATIONS: readonly ComponentMigration[] = [
  { version: 1, sql: TOPOLOGY_MIGRATION_SQL },
]
