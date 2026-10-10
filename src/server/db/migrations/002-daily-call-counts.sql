-- Daily model-call caps (AC-003.13, AC-003.14, NFR-012). Additive: no existing table changes.
-- One row per UTC day and scope ('all' or 'player:<id>'); kept in the DB so restarts don't
-- reset the counts.
CREATE TABLE daily_call_counts (
  day TEXT NOT NULL, -- UTC YYYY-MM-DD
  scope TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n >= 0),
  PRIMARY KEY (day, scope)
) STRICT;
