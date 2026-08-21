import type { ComponentMigration } from '@spexcode/session-protocol'

export const SESSION_EVENTS_MIGRATION_SQL = `
CREATE TABLE session_events (
  subject_session_id  TEXT    NOT NULL REFERENCES protocol_sessions(session_id),
  event_seq           INTEGER NOT NULL,
  event_id            TEXT    NOT NULL UNIQUE,
  event_type          TEXT    NOT NULL,
  schema_version      INTEGER NOT NULL,
  ignorable           INTEGER NOT NULL,
  payload              BLOB    NOT NULL,
  occurred_at_ms      INTEGER NOT NULL,
  PRIMARY KEY (subject_session_id, event_seq),
  CHECK (event_seq >= 1),
  CHECK (length(event_id) = 32 AND event_id NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(event_type) BETWEEN 1 AND 128),
  CHECK (event_type NOT GLOB '*[^0-9A-Za-z._:-]*'),
  CHECK (schema_version >= 1),
  CHECK (ignorable IN (0, 1)),
  CHECK (length(payload) <= 1048576),
  CHECK (occurred_at_ms >= 0)
) STRICT;

CREATE INDEX session_events_subject_history
  ON session_events (subject_session_id, event_seq);

CREATE TRIGGER session_events_append_only_update
BEFORE UPDATE ON session_events
BEGIN
  SELECT RAISE(ABORT, 'session_events is append-only');
END;

CREATE TRIGGER session_events_append_only_delete
BEFORE DELETE ON session_events
BEGIN
  SELECT RAISE(ABORT, 'session_events is append-only');
END;
`

export const SESSION_EVENTS_MIGRATIONS: readonly ComponentMigration[] = [
  { version: 1, sql: SESSION_EVENTS_MIGRATION_SQL },
]
