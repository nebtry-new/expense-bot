-- Sprint 2: trip notes (free-form per-trip reference info)
CREATE TABLE IF NOT EXISTS trip_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid REFERENCES trips(id) ON DELETE CASCADE,
  content    text NOT NULL,
  created_at timestamptz DEFAULT now()
);
