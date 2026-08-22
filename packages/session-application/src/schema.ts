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
]
