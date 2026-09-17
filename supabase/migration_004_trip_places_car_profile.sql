-- Sprint 2: trip_places + car_profile

CREATE TABLE IF NOT EXISTS trip_places (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid REFERENCES trips(id) ON DELETE CASCADE,
  name       text NOT NULL,
  notes      text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS car_profile (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_range_km  int NOT NULL,
  updated_at    timestamptz DEFAULT now()
);
