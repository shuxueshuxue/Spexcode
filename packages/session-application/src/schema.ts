import type { ComponentMigration } from '@spexcode/session-protocol'

export const SESSION_APPLICATION_MIGRATIONS: readonly ComponentMigration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE session_application_state (
  session_id         TEXT    NOT NULL PRIMARY KEY REFERENCES protocol_sessions(session_id),
  status             TEXT    NOT NULL,
  parent_session_id  TEXT    REFERENCES protocol_sessions(session_id),
  updated_at_ms      INTEGER NOT NULL,
  CHECK (length(status) BETWEEN 1 AND 64),
  CHECK (status NOT GLOB '*[^0-9A-Za-z._:-]*'),
  CHECK (updated_at_ms >= 0),
  CHECK (parent_session_id IS NULL OR parent_session_id <> session_id)
) STRICT;

CREATE INDEX session_application_state_parent
  ON session_application_state (parent_session_id, session_id);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE session_application_state ADD COLUMN proposal TEXT;
ALTER TABLE session_application_state ADD COLUMN note TEXT;
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE session_follow_cursors (
  watcher_session_id TEXT NOT NULL REFERENCES protocol_sessions(session_id),
  subject_session_id TEXT NOT NULL REFERENCES protocol_sessions(session_id),
  event_seq         INTEGER NOT NULL,
  PRIMARY KEY (watcher_session_id, subject_session_id),
  CHECK (event_seq >= 0)
) STRICT;
`,
  },
  {
    version: 4,
    sql: `
INSERT INTO session_follow_cursors (watcher_session_id, subject_session_id, event_seq)
SELECT edge.from_session_id,
       edge.to_session_id,
       COALESCE(MAX(event.event_seq), 0)
  FROM topology_edges AS edge
  LEFT JOIN session_events AS event
    ON event.subject_session_id=edge.to_session_id
 WHERE edge.removed_at_ms IS NULL
   AND edge.relation_type IN ('parent', 'watch', 'watch:parent', 'watch:manual')
 GROUP BY edge.from_session_id, edge.to_session_id
ON CONFLICT(watcher_session_id, subject_session_id) DO UPDATE
 SET event_seq=MAX(session_follow_cursors.event_seq, excluded.event_seq);
`,
  },
]
