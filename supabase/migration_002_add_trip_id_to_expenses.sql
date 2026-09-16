-- Link expenses to trips
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS trip_id uuid REFERENCES trips(id);
