-- Sprint 3 notification core: generic scheduled push notifications
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL DEFAULT 'manual',  -- manual | trip_reminder | birthday | debt
  message      text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at      timestamptz,
  line_user_id text,   -- null = broadcast to all users
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON notifications (scheduled_at)
  WHERE sent_at IS NULL;
