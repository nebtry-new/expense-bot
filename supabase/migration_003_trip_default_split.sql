-- Add default split mode to trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS default_split_mode text DEFAULT 'half' CHECK (default_split_mode IN ('half', 'none', 'per_head'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS default_num_people int;
