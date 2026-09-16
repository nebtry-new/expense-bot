-- Add soft-delete support to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
