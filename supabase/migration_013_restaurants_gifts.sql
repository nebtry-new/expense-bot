-- Sprint 4: ร้านอาหาร (สุ่มเลือก) + ของขวัญ (wishlist + ประวัติ กันซ้ำ)
-- owner/giver/recipient เก็บเป็น LINE userId (มีแค่ 2 คน)

CREATE TABLE IF NOT EXISTS restaurants (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  url                     text,                 -- ลิงก์ Google Maps
  lat                     double precision,
  lng                     double precision,
  added_by_line_user_id   text,
  visited_at              timestamptz,          -- ไปกินแล้ว (สุ่มรอบถัดไปจะข้ามร้านนี้ถ้ายังมีร้านที่ยังไม่ไป)
  created_at              timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_line_user_id  text NOT NULL,            -- คนที่อยากได้
  title               text NOT NULL,
  price               numeric(10,2),
  given_at            timestamptz,              -- อีกฝ่ายให้แล้ว
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gift_history (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giver_line_user_id      text NOT NULL,
  recipient_line_user_id  text NOT NULL,
  title                   text NOT NULL,
  price                   numeric(10,2),
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wishlist_open ON wishlist_items (owner_line_user_id) WHERE given_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gift_history_recipient ON gift_history (recipient_line_user_id, created_at DESC);
