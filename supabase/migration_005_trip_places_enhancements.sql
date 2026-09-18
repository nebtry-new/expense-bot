-- Sprint 2: enhance trip_places with status, category, maps_url
ALTER TABLE trip_places ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending' CHECK (status IN ('pending', 'visited'));
ALTER TABLE trip_places ADD COLUMN IF NOT EXISTS category text DEFAULT 'other';
ALTER TABLE trip_places ADD COLUMN IF NOT EXISTS maps_url text;
