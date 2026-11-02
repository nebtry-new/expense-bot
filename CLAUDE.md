# expense-bot — CLAUDE.md

Context file สำหรับ Claude Code อ่านไฟล์นี้ก่อนทำงานทุกครั้ง

---

## โปรเจกต์คืออะไร

LINE Chatbot สำหรับคู่รัก ใช้บันทึกค่าใช้จ่ายร่วมกันและคำนวณว่าใครต้องจ่ายให้ใครเท่าไหร่
ใช้งานจริงแค่ 2 คน (เจ้าของกับแฟน)

---

## Tech Stack

| ส่วน | เครื่องมือ |
|---|---|
| Runtime | Node.js (JavaScript) |
| Framework | Express.js |
| LINE SDK | @line/bot-sdk v9 |
| AI / Vision | Claude API (claude-sonnet-4-6) |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway (deployed ✅) |
| ทดสอบ | `npm test` (in-memory, `DEVELOPMENT_MODE=true`) + ทดสอบบน env ที่ deploy แล้ว (ไม่ใช้ ngrok/localtunnel แล้ว) |

---

## File Structure

```
expense-bot/
├── CLAUDE.md                 ← ไฟล์นี้
├── .env / .env.example
├── package.json
├── assets/richmenu/          ← รูป Rich menu: main.png, more.png (2500×1686 ≤1MB สร้างด้วย scripts/richmenu-art.js) + guide-*.png (ภาพช่วยวาง)
├── docs/richmenu-design.md   ← สเปกออกแบบ Rich menu
├── scripts/
│   ├── richmenu.js           ← `npm run richmenu:setup|list|delete` จัดการ Rich menu ผ่าน LINE API
│   ├── richmenu-guide.js     ← สร้างภาพ guide จาก definitions (ต้องมี rsvg-convert)
│   ├── golden-runner.js      ← รันประโยคตัวอย่างผ่าน handleTextMessage แล้วตรวจผล
│   └── eval-nl.js            ← `npm run eval:nl` ประเมินโมเดลจริง (ใช้เครดิต API)
├── supabase/                 ← schema.sql + migration_001…015
├── test/
│   ├── golden/nl-sentences.json  ← ประโยคตัวอย่าง + ผลที่ควรได้ (เพิ่มที่นี่ก่อนแก้บั๊ก NL)
│   └── *.test.js
└── src/
    ├── index.js              ← Express server + LINE webhook + /internal/run-notifications
    ├── handlers/
    │   ├── text.js           ← route ข้อความ → command + pipeline บันทึกค่าใช้จ่าย + help
    │   ├── state.js          ← pending state ต่อ user (slip, ev, ลบ, datetime ฯลฯ) — ถูกล้างเมื่อข้อความถัดไปไม่ใช่คำตอบ
    │   └── commands/         ← expense, slip, settlement, summary, trip, ev, notifications, menu (postback จาก Rich menu), nl-dispatch
    ├── richmenu/definitions.js ← โครงเมนู 2 แท็บ (พิกัด/ปุ่ม/alias) — แก้ปุ่มที่นี่ที่เดียว
    ├── services/
    │   ├── db.js             ← Supabase queries ทั้งหมด (+ in-memory เมื่อ DEVELOPMENT_MODE=true)
    │   ├── claude.js         ← Claude Vision อ่าน slip
    │   ├── nl-intent.js      ← NL layer: ตีความประโยค → รายการค่าใช้จ่าย (ยืม/คืนเงินตัดสินด้วยโค้ด)
    │   ├── places.js         ← Google Places/Directions สำหรับ EV
    │   ├── notifications.js  ← ส่งแจ้งเตือนที่ถึงเวลา
    │   └── ocm.js            ← (ไม่ได้ใช้แล้ว) Open Charge Map
    └── utils/
        ├── parser.js         ← parse text → split mode
        ├── balance.js        ← คำนวณยอดค้าง
        ├── billing.js        ← เลือกรายการที่เข้ารอบเรียกเก็บ (ทริปที่ปิดแล้ว/ยังไม่ปิด)
        ├── thai-numbers.js   ← "สามร้อย" → 300
        ├── date-phrases.js   ← "เมื่อวาน" → createdAt ย้อนหลัง
        └── format.js, parse-date.js, fetch-title.js
```

---

## Database Schema (Supabase / PostgreSQL)

```sql
-- ผู้ใช้งาน (ควรมีแค่ 2 rows ตลอด)
users (
  id            uuid PK,
  line_user_id  text UNIQUE,   -- LINE userId
  display_name  text,
  created_at    timestamptz
)

-- ค่าใช้จ่ายแต่ละรายการ
expenses (
  id          uuid PK,
  paid_by     uuid FK → users,
  trip_id     uuid FK → trips (nullable),
  amount      decimal(10,2),
  description text,
  category    text default 'other',
  split_mode  text CHECK (split_mode IN ('half','none','custom','per_head')),
  num_people  int (nullable — ใช้เฉพาะ per_head),
  is_cleared  boolean default false,
  slip_url    text (nullable),
  created_at  timestamptz
)

-- รายละเอียด split สำหรับ custom และ per_head
expense_splits (
  id          uuid PK,
  expense_id  uuid FK → expenses ON DELETE CASCADE,
  user_id     uuid FK → users,
  amount      decimal(10,2)
)

-- สถานที่ในทริป (Sprint 2 — รัน migration_004 ก่อน deploy)
trip_places (
  id         uuid PK,
  trip_id    uuid FK → trips ON DELETE CASCADE,
  name       text NOT NULL,
  notes      text (nullable),
  created_at timestamptz
)

-- โปรไฟล์รถ EV (Sprint 2 — รัน migration_004 ก่อน deploy)
car_profile (
  id            uuid PK,
  max_range_km  int,
  updated_at    timestamptz
)

-- archive รายเดือน (Sprint 5 — ยังไม่ได้สร้าง table)
monthly_summaries (
  id          uuid PK,
  user_id     uuid FK → users,
  month       text,            -- เช่น "2026-09"
  total_paid  decimal(10,2),
  total_owed  decimal(10,2),
  cleared_at  timestamptz
)

-- ข้อความที่ NL layer ตีความไม่ได้ (migration_009) — ดูด้วยคำสั่ง "ข้อความที่ไม่เข้าใจ"
unrecognized_messages (
  id           uuid PK,
  line_user_id text,
  text         text,
  reason       text,           -- เช่น unknown, amount_not_in_text, api_error
  created_at   timestamptz
)

-- log ทุกข้อความที่ผ่าน NL layer (migration_010) — export ด้วย `npm run export:nl-log > nl-log.jsonl`
nl_message_log (
  id uuid PK, line_user_id text, text text,
  route text,        -- code | model | none
  model text, outcome text,   -- saved | failed | rejected
  reason text, interpreted jsonb,
  expense_ids text[],         -- id หายจาก expenses ภายหลัง = ถูกลบ (ตีความผิด)
  has_date boolean, latency_ms int, created_at timestamptz
)

-- รอเจ้าหนี้ยืนยันรับเงิน (migration_011) — confirmed_at NULL = ยังรอ
payment_confirmations (
  id uuid PK, creditor_line_user_id text, debtor_line_user_id text,
  creditor_name text, debtor_name text, amount numeric(10,2),
  scope jsonb,              -- { tripId, expenseIds } ขอบเขตที่จะเคลียร์
  requested_at timestamptz, last_reminded_at timestamptz, confirmed_at timestamptz
)

-- งบรายเดือนต่อหมวด (migration_014) — category = key ใน utils/categories.js
category_budgets ( category text PK, monthly_limit numeric(10,2), updated_at timestamptz )

-- ข้อเสนอเรียกเก็บที่ส่งให้ลูกหนี้แล้ว ไว้เตือนค้างชำระ (migration_015) — resolved_at NULL = ยังค้าง
billing_requests (
  id uuid PK, debtor_line_user_id text, creditor_line_user_id text,
  debtor_name text, creditor_name text, amount numeric(10,2), scope jsonb,
  requested_at timestamptz, reminded_3_at timestamptz, reminded_7_at timestamptz, resolved_at timestamptz
)

-- ทริปท่องเที่ยว
trips (
  id                  uuid PK,
  name                text,
  default_split_mode  text default 'half',
  default_num_people  int (nullable),
  is_billable         boolean default false,  -- true = รวมใน "สรุป" ทั่วไป (ปิดทริปแล้ว)
  created_at          timestamptz
)
```

---

## Split Mode Logic

| split_mode | ความหมาย | trigger keyword | expense_splits |
|---|---|---|---|
| `half` | หาร 2 เท่ากัน (default) | ไม่มี keyword | ไม่สร้าง |
| `none` | ส่วนตัว ไม่หาร | "ส่วนตัว", "ไม่หาร" ("ของขวัญ" ไม่ใช่ keyword — ไม่ระบุให้ใช้หารครึ่ง) | ไม่สร้าง |
| `custom` | ระบุจำนวนเอง | "ฉัน X แฟน Y" | สร้าง 2 rows |
| `per_head` | หารตามจำนวนคน | "หาร X คน" | สร้าง 2 rows |

---

## การระบุเจ้าของรายการ

1. ใครส่ง message → LINE API บอก `userId` → บันทึกเป็นคนจ่าย (อัตโนมัติ)
2. พิมพ์ระบุชื่อ เช่น "แฟนออกค่าที่พัก 1200" → parse จาก text
3. ถ้า userId ไม่ match → bot ถาม "ใครจ่ายคะ?"

---

## Backlog

### Sprint 1 — MVP ✅ เสร็จแล้ว

| # | Item | Status |
|---|---|---|
| 1 | ส่งรูป slip → อ่านยอดด้วย Claude Vision → บันทึก half อัตโนมัติ | ✅ done |
| 2 | พิมพ์บันทึกค่าใช้จ่าย + parse split mode ทุกแบบ | ✅ done |
| 3 | สรุปยอดและคำนวณส่วนแบ่งตาม split mode | ✅ done |

**เพิ่มเติมจาก Sprint 1 (done):**
- ✅ Settlement flow — จ่ายแล้ว / รับแล้ว + debtor guard
- ✅ Trip system — สร้างทริป, default split mode, #tag, สรุปทริป + เรียกเก็บเงิน
  - `สรุปทริป X` แจกแจงทุกรายการของทริป (ทั้งที่เคลียร์แล้ว ✓ และยังไม่เคลียร์): ยอดรวม · ช่วงวันที่ · จ่ายไปคนละเท่าไหร่ · แยกหมวด · ทุกรายการพร้อมวันที่/คนจ่าย/ส่วนตัว (`utils/trip-report.js`, ตัดท้ายถ้ายาวเกินขีดจำกัดข้อความ LINE); ยอดเรียกเก็บ/ปุ่มเรียกเก็บยังคิดจากรายการที่ยังไม่เคลียร์เท่านั้น
  - `ทริป` (ลิสต์) และเมนูทริปใน Rich menu แสดงสถานะ + ยอดใช้จ่ายรวม + จำนวนรายการของแต่ละทริป จึงดูทริปเก่าที่ปิดแล้วได้
- ✅ Multi-line batch expense + shared #tag propagation
- ✅ Slip override — หาร N, ฉัน X แฟน Y, ไม่หาร
- ✅ User management — ลงทะเบียน, เปลี่ยนชื่อ, ผู้ใช้, ป้องกันชื่อซ้ำ
- ✅ Deploy บน Railway

**รัน SQL migrations ใน Supabase ก่อน deploy ครั้งต่อไป:**
- `supabase/migration_001_add_soft_delete.sql`
- `supabase/migration_002_add_trip_id_to_expenses.sql`
- `supabase/migration_003_trip_default_split.sql`
- `supabase/migration_004_trip_places_car_profile.sql` ← Sprint 2
- `supabase/migration_011_payment_confirmations.sql` ← สถานะรอยืนยันรับเงิน (จ่ายแล้ว → รับแล้ว) + เตือนทุกวัน 09:00 (**ต้องรันก่อน deploy** ไม่งั้น `จ่ายแล้ว` จะแจ้ง error)
- `supabase/migration_010_nl_message_log.sql` ← log ทุกข้อความที่ผ่าน NL layer (route/outcome/ผลตีความ/expense_ids) ไว้วิเคราะห์
- `supabase/migration_009_unrecognized_messages.sql` ← log ข้อความที่ตีความไม่ได้ (คำสั่ง `ข้อความที่ไม่เข้าใจ`)
- `supabase/migration_008_trip_billable.sql` ← trips.is_billable (ทริปใหม่ไม่รวมใน สรุป จนกว่าจะ ปิดทริป)
- `supabase/migration_012_events_todos.sql` ← Sprint 3: special_events + todos
- `supabase/migration_013_restaurants_gifts.sql` ← Sprint 4: restaurants + wishlist_items + gift_history
- `supabase/migration_014_category_budgets.sql` ← Sprint 5: งบรายเดือนต่อหมวด (ไม่รันก็ใช้อย่างอื่นได้ แต่ ตั้งงบ/ดูงบ จะ error)
- `supabase/migration_015_billing_requests.sql` ← Sprint 5: เตือนลูกหนี้ค้างจ่าย 3/7 วัน (ไม่รัน = ไม่มีเตือน การเรียกเก็บยังปกติ)

### Sprint 2 — Trip Assistant ✅ เสร็จแล้ว

- **Trip notebook** — บันทึกสถานที่ที่อยากไปต่อท้าย trip (`เพิ่มที่`, `ไปแล้ว`, `ที่เที่ยว`, `เส้นทางทริป`) + โน้ตทริป (`โน้ตทริป`, `โน้ต`)
- **EV charging route** — บอก A → B + % แบตที่เหลือ → แนะนำจุดชาร์จระหว่างทาง พร้อมลิงก์ Google Maps
  - ใช้ **Google Places API (searchNearby) + Directions API** (`src/services/places.js`, ต้องมี `GOOGLE_PLACES_API_KEY`) ไม่ใช้ Open Charge Map / web_search แล้ว
  - รับ input 2 แบบ: ส่ง Maps directions link แล้วบอกแบต % หรือแชร์ตำแหน่งปัจจุบัน → ปลายทาง → แบต %
  - เลือกจุดชาร์จที่อยู่ใกล้เส้นทางจริง (≤ 5 กม.), rating ≥ 3.0, วางแผนแบบ greedy ตามระยะที่วิ่งได้
  - **ช่องว่างที่รู้แล้ว (ยังไม่ได้แก้):** ยังไม่เผื่อแบตสำรอง 20% ตามสเปก, คิดว่าชาร์จเต็ม 100% หลังแวะ, เทียบระยะเส้นตรงกับระยะวิ่งได้ (ประเมินเกินจริง), ไม่กรองหัวชาร์จเร็ว/จำนวนตู้, ไม่มี timeout ที่ fetch ภายนอก

### NL Layer — ตีความภาษาธรรมชาติ (กำลังทำเป็นเฟส)

- **Phase 1 ✅ บันทึกค่าใช้จ่าย**: `src/services/nl-intent.js` — ถ้า parser เดิมหาจำนวนเงินไม่เจอ หรือมีคำอย่าง ออกให้/เลี้ยง/แฟนออก → Claude (`NL_MODEL`, default claude-haiku-5-5) คืนข้อมูลโครงสร้าง → ตรวจ (ยอดต้องอยู่ในข้อความ, ผลรวม custom ต้องตรง, ทริปต้องมีจริง) → บันทึกทันที + บอกวิธีลบ
- ตัดสินด้วยโค้ดเอง (ไม่เรียกโมเดล): ยืม (`ปิ๊กยืมแจม 500`, `แจมให้ยืม 500`), คืนเงิน (`คืนแจม 500`), เลขไทย (`สามร้อย`, `สองพันห้า`), วันที่ย้อนหลัง (`เมื่อวาน`, `3 วันก่อน`, `วันเสาร์ที่แล้ว`), หลายรายการในประโยคเดียว (`ข้าว 100 กาแฟ 50`)
- ชุดประโยคตัวอย่าง: `test/golden/nl-sentences.json` — `npm test` รันส่วนที่ตัดสินด้วยโค้ด, `npm run eval:nl` รันส่วนที่ต้องใช้โมเดลจริง (ใช้เครดิต) — เจอประโยคที่ผิดให้เพิ่มเข้าไฟล์นี้ก่อนแก้
- quirk เดิมของ parser: ชื่อรายการที่ลงท้าย "แฟน" ติดตัวเลข (เช่น `ค่าของขวัญแฟน 800`) ถูกอ่านเป็น "แฟน 800" = ส่วนของแฟน 800 บาท (แฟนจ่ายคืนเต็ม)
- **เก็บข้อมูลไว้วิเคราะห์ (Phase next):** ทุกข้อความที่ผ่าน NL layer ถูกบันทึกใน `nl_message_log` — เฟสถัดไปให้ export (`npm run export:nl-log`) แล้ว: (1) นับประโยค `route=model` ที่ซ้ำบ่อยที่สุด → ย้ายเป็นกฎในโค้ด (ประหยัดเครดิต/แม่นกว่า) (2) ดู `deleted_after_save` + `outcome=failed/rejected` → หาประโยคที่ตีความผิด เพิ่มเข้า `test/golden/nl-sentences.json` ก่อนแก้
- **Phase 2 ✅ คำสั่งอื่นด้วยภาษาธรรมชาติ**: โมเดลเลือก `command.name` จาก whitelist (`COMMAND_NAMES` ใน nl-intent.js) → `nl-dispatch.js` map เป็นคำสั่งเดิมแล้วรันผ่าน `handleTextMessage` — คำสั่งอ่านอย่างเดียว/มีขั้นตอนยืนยันของตัวเองรันทันที (สรุป, ลบรายการ, ทริป ฯลฯ); คำสั่งที่กระทบเงิน/สถานะ (`จ่ายแล้ว`, `รับแล้ว`, `เรียกเก็บเงิน`, `ปิดทริป`, `เปิดทริป`) ต้องตอบ `ใช่` ก่อน (`nlCommandState`, หมดอายุ 10 นาที, ข้อความอื่นคั่นกลางจะยกเลิก)
- **Phase 3 ✅ แจ้งเตือนแบบพูด**: `src/utils/relative-time.js` (โค้ดล้วน ไม่ใช้โมเดล) อ่าน "พรุ่งนี้บ่ายสาม", "อีก 2 ชั่วโมง", "วันศุกร์หน้า 9 โมงเช้า", "20.30", "สองทุ่มครึ่ง" ใช้ได้กับ `เตือน…` และ `แจ้งเตือน…`; ประโยคที่ไม่ขึ้นต้นด้วยเตือนให้โมเดลส่ง `reminder.when_local` แล้วโค้ดตรวจว่าเป็นอนาคตก่อนตั้ง
- **Phase 4 ✅ ถามตอบข้อมูล**: โมเดลแปลคำถามเป็น `{kind, period, keywords, payer, trip_name}` (kind: total / balance / recent / trip_total) แล้ว `src/services/queries.js` คำนวณคำตอบจากข้อมูลจริง — ตัวเลขทุกตัวมาจากโค้ด ไม่ใช่โมเดล; ประโยคคำถามที่มีตัวเลข ("ใช้ไป 3 ครั้งไหม") ถูกส่งให้โมเดลก่อน ไม่ตกไปเป็นรายการค่าใช้จ่าย
- หลักการ: Claude ไม่เขียน DB เอง, parser เดิมเป็นทางหลัก, ล้มเหลวต้องถอยกลับพฤติกรรมเดิม

### Rich menu (LINE) ✅ โค้ด + รูปเสร็จ — เหลือติดตั้งต่อ environment

- 2 แท็บ: **หน้าหลัก** (บันทึกค่าใช้จ่าย · สรุปยอด · จ่าย/รับเงิน · ลบรายการ · ทริป · ถามข้อมูล) และ **เพิ่มเติม** (แจ้งเตือน · งาน · วันสำคัญ(+ของขวัญ) · หาจุดชาร์จ EV (มีปุ่ม ตั้งค่ารถ ข้างใน) · ร้านอาหาร · วิธีใช้) — แถบแท็บอยู่บนสุด สลับด้วย `richmenuswitch` + alias `expense-bot-main/more`
- ปุ่มเป็น "ทางลัดเข้า flow เดิม": ปุ่มคำสั่งส่งข้อความเดิม (`สรุป`, `ลบรายการ`, `help` …); ปุ่มที่ต้องมีขั้นต่อ (`action=menu_money|trip|ask|ev|notify|todo|events|restaurant`) → `handlers/commands/menu.js` ตอบข้อความ + quick reply (ตัวเลือกเป็นข้อความคำสั่งเดิม จึงผ่านขั้นตอนยืนยัน `ใช่` เหมือนเดิม); ปุ่มที่ต้องพิมพ์ต่อใช้ postback `inputOption: openKeyboard` + `fillInText`
- ปุ่ม ✈️ ทริป มีหลายชั้น (postback `menu_trip*`, ทุกชั้นมีปุ่ม ← กลับ): ลิสต์ทริปจริง (≤8) → เมนูทริป (สรุป · 📝 โน้ต · 📍 ที่เที่ยว · เส้นทาง · ปิด/เปิดทริป) → โน้ต (แสดง + ➕ เพิ่มโน้ต) / ที่เที่ยว (แสดง + ➕ เพิ่ม · ✓ ไปแล้ว · 🗑 ลบที่ — เลือกจากปุ่มรายชื่อ, ลบมีขั้นยืนยัน, อ้างที่ด้วย id ไม่ใช่ชื่อ) ปุ่ม ➕ ใช้ #แท็ก จึงไม่มีสำหรับชื่อทริปที่มีช่องว่าง
- **ทุกเมนูย่อย (quick reply) มีปุ่ม ✖ ยกเลิก เป็นปุ่มสุดท้ายเสมอ** — เมนูจาก Rich menu: เพิ่มอัตโนมัติใน `withQuickReplies` (menu.js); หน้าที่เกิดจากการกดปุ่มแล้วรันคำสั่ง (ชั้นลึก เช่น ลิสต์งาน/ร้าน/วันสำคัญ/ของขวัญ): `toReplyPayload` (utils/quick-reply.js ← index.js) เติมให้ ยกเว้นหน้าที่มีปุ่มปฏิเสธอยู่แล้ว (ยกเลิก/ไม่เอา/ยังก่อน/ไม่ลบ) และข้อความ push จากตัวเตือนไม่เติม จึงเหลือที่ให้ปุ่มอื่นได้ 12 ปุ่ม; กดแล้ว postback `action=menu_cancel` ตอบว่าไม่ทำอะไรต่อ + ล้างลิสต์/คำขอยืนยันที่ค้าง (ลบรายการ, งาน, วันสำคัญ, ร้าน, wishlist, แจ้งเตือน, คำสั่งที่ AI ตีความรอยืนยัน) — ไม่แตะ flow เรื่องเงิน/สลิป/EV. เมนูใหม่ที่สร้างผ่าน `withQuickReplies` ได้ปุ่มนี้เองโดยไม่ต้องเขียนซ้ำ
- วลีของปุ่ม "ถามข้อมูล" (`เดือนนี้ใช้ไปเท่าไหร่` ฯลฯ) ตอบตรงด้วย `queries.js` โดยไม่เรียกโมเดล — ใช้ได้แม้เครดิต AI หมด
- ติดตั้ง: รูป `assets/richmenu/main.png`, `more.png` สร้างด้วย `node scripts/richmenu-art.js` (ปรับสี/ชื่อปุ่มแล้วรันซ้ำได้) แล้วรัน `npm run richmenu:setup` **แยกทีละ environment** (dev/prod คนละ LINE channel) — `-- --dry-run` ตรวจก่อนได้
- ต้องทดสอบบนมือถือจริง: ปุ่ม `fillInText` (เปิดคีย์บอร์ดพร้อมข้อความ) และ OA ที่เคยตั้ง Rich menu ผ่าน LINE OA Manager อาจชนกับเมนูจาก API

### Sprint 3 — Reminders & To-Do ✅ เสร็จแล้ว (ต้องรัน migration_012 ก่อน deploy)

- **ทำแล้ว: แจ้งเตือนแบบตั้งเอง** — `แจ้งเตือนใหม่` (เลือกจากปฏิทิน) / `แจ้งเตือน 25 ธ.ค. 09:00 ข้อความ` / `ดูแจ้งเตือน` / `ยกเลิกแจ้งเตือน [เลข]` (`notifications.js`, ตาราง `notifications`)
  - **ตัวรันแจ้งเตือน:** `startNotificationScheduler()` ใน `src/index.js` รันทุก 60 วิในตัวเซิร์ฟเวอร์ (ปิดด้วย `NOTIFICATION_POLL_MS=0`; endpoint `POST /internal/run-notifications` ยังใช้ได้ ไม่ส่งซ้ำเพราะจอง atomic) — ส่งไม่สำเร็จจะไม่ถูก mark ว่าส่งแล้ว ลองใหม่สูงสุด 5 ครั้งแล้วยอมแพ้ (log `NOTIFICATION_GAVE_UP`); `ดูแจ้งเตือน`/`ยกเลิกแจ้งเตือน` เห็นเฉพาะของตัวเอง + ของทั้งคู่
  - **เตือนยืนยันรับเงิน:** ลูกหนี้พิมพ์ `จ่ายแล้ว` แต่เจ้าหนี้ยังไม่กด `รับแล้ว` → ตัวรันเดียวกันนี้ push เตือนเจ้าหนี้ **09:00 (เวลาไทย) ของวันถัดไป แล้วซ้ำทุกวัน 09:00** พร้อมปุ่ม รับแล้ว จนกว่าจะยืนยัน (`src/services/payment-reminders.js`, ปรับชั่วโมงด้วย `PAYMENT_REMINDER_HOUR`) — สถานะอยู่ในตาราง `payment_confirmations` (migration_011) จึงรอดการรีสตาร์ท; `รับแล้ว` ยืนยันแบบ atomic กดซ้ำไม่เคลียร์ซ้ำ
  - ยังเหลือ: ไม่มีงานลบแจ้งเตือนเก่า, ถ้าเซิร์ฟเวอร์ดับนานแจ้งเตือนที่เลยเวลาจะถูกส่งทีเดียวตอนกลับมา
- **ทำแล้ว: วันสำคัญ (วนทุกปี)** — `เพิ่มวันสำคัญ วันเกิดแฟน 15 ก.ค. 2536` (ปีไม่ใส่ก็ได้) / `วันสำคัญ` / `ลบวันสำคัญ [เลข]` (`commands/planner.js`, ตาราง `special_events`, migration_012) — เตือนทั้งคู่ล่วงหน้า 7 วัน / 1 วัน / วันจริง เวลา 09:00 (`EVENT_REMINDER_HOUR`) ข้อความวันจริงให้โมเดลเขียนให้น่ารัก (`NL_MODEL`) มี fallback เป็นข้อความสำเร็จรูปเสมอ; ใส่ปีจะบอกอายุ/ครบกี่ปี; 29 ก.พ. ปีไม่มีวัน → เตือน 28 ก.พ.
- **ทำแล้ว: To-Do ร่วมกัน** — `เพิ่มงาน จองโรงแรม 25 ธ.ค.` (วันที่: พรุ่งนี้/วันศุกร์หน้า/อีก N วัน/D เดือน/D/M — อ่านด้วยโค้ดใน `utils/planner-dates.js`) / `งาน` / `เสร็จ [เลข…]` / `ลบงาน [เลข]` (ตาราง `todos`) — ใครก็ทำเสร็จ/ลบได้, เลขอ้างอิงลิสต์ที่เพิ่งแสดง (`todoListState`), ทำเสร็จแบบ atomic; งานที่มีกำหนดเตือนทั้งคู่ 1 วันก่อนและวันครบกำหนด
  - ตัวส่ง: `services/planner-reminders.js` ต่อกับตัวรัน 60 วิเดิมใน `index.js`; กันส่งซ้ำด้วย `reminded_keys` (รอดรีสตาร์ท); ส่งไม่สำเร็จไม่นับว่าเตือนแล้ว; ถ้ายังไม่รัน migration_012 ตัวรันจะ log `PLANNER_REMINDERS_FAILED` แล้วข้าม ไม่กระทบแจ้งเตือนอื่น
  - NL: ถามด้วยประโยคได้เฉพาะ "ดูวันสำคัญ/ดูงาน" (`list_events`, `list_todos`) — การ *เพิ่ม* ยังต้องใช้คำสั่ง
  - ยังเหลือ: ยังไม่มีรอบเตือนงานเลยกำหนด (เห็นได้ใน `งาน` เท่านั้น), ไม่มีแก้ไขวันสำคัญ/งาน (ลบแล้วเพิ่มใหม่), ไม่ได้ทดสอบข้อความโมเดลจริง/push จริงบน LINE

### Sprint 4 — Discovery & Gifts ✅ เสร็จแล้ว (ต้องรัน migration_013 ก่อน deploy)

- **สุ่มร้านอาหาร** (`commands/restaurants.js`, ตาราง `restaurants`) — `เพิ่มร้าน [ลิงก์ Google Maps]` (บอตตามลิงก์สั้นไปอ่านชื่อ/พิกัดจาก URL เต็ม ไม่ใช้ API key; อ่านชื่อไม่ได้ให้ระบุเอง: `เพิ่มร้าน ชื่อ [ลิงก์]`) / `ร้านอาหาร` / `สุ่มร้าน [คำค้น]` / `ไปกินแล้ว` (ร้านที่สุ่มล่าสุด) / `ร้านไปแล้ว [เลข]` / `ลบร้าน [เลข]` — สุ่มจากร้านที่ยังไม่ไป ไม่ซ้ำร้านเดิมที่เพิ่งได้ ไปครบทุกร้านแล้วสุ่มจากทั้งหมด
  - **ต้องมีคำว่า เพิ่มร้าน นำหน้า** เพราะลิงก์ Maps เปล่าๆ ใช้ใน flow หาจุดชาร์จ EV (`ev.js`)
  - `utils/maps-place.js` — อ่านชื่อ/พิกัดจาก `/maps/place/ชื่อ/@lat,lng` · `!3d!4d` · `?q=lat,lng`
- **ของขวัญ** (`commands/gifts.js`, ตาราง `wishlist_items`, `gift_history`) — `อยากได้ หูฟัง 3500` / `ของที่อยากได้` / `ลบของที่อยากได้ [เลข]` / `ของขวัญแฟน` (wishlist ของแฟน + ที่เคยให้) / `ให้ของขวัญแฟน นาฬิกา 2500` หรือ `ให้ของขวัญแฟน [เลข]` / `ประวัติของขวัญ`
  - **ยืนยันก่อนบันทึกเสมอ**: `ให้ของขวัญแฟน …` แสดงตัวอย่าง (ให้ใคร/ของอะไร/ราคา/รายการ wishlist ที่จะปิด) แล้วรอพิมพ์ `ใช่` (`giftConfirmState` → `handleConfirmGift` ผ่านทาง `ใช่` เดิมใน settlement.js) — `ยกเลิก`/ข้อความอื่นคั่น/อีกคนพิมพ์ ใช่ = ไม่บันทึก
  - กันซ้ำ: ให้ของที่ชื่อคล้ายของเดิม (ชื่อหนึ่งอยู่ในอีกชื่อ ยาว ≥ 3 ตัว) → ตัวอย่างมีบรรทัด ⚠️ เคยให้ …; ให้แล้วปิดรายการ wishlist ที่ตรงกันให้อัตโนมัติ
  - ตัวเลขท้ายชื่อนับเป็นราคาเมื่อมี บาท/฿ หรือ ≥ 100 ("iPhone 15" ไม่ใช่ราคา)
  - **ไม่สร้างรายการค่าใช้จ่ายเอง** (เรื่องเงินต้องผู้ใช้สั่ง) — ตอบแนะนำ `ค่าของขวัญ 1200 ส่วนตัว`
  - **hint ก่อนวันสำคัญ** (`runGiftHints` ใน `planner-reminders.js`): 7 และ 1 วันก่อน ส่งให้ "อีกฝ่าย" (ไม่ส่งให้เจ้าของวันเกิด) พร้อม wishlist + ของที่เคยให้; รู้เจ้าของวันสำคัญจากชื่อผู้ใช้ในชื่อวันสำคัญ / คำว่า แฟน (แฟนของคนที่เพิ่ม) / ฉัน-ผม-หนู — วันครบรอบ (ของทั้งคู่) ไม่ส่ง hint
- **Rich menu**: ปุ่ม 🎉 วันสำคัญ กลายเป็นปุ่มเลือกซ้อน (ดู/เพิ่มวันสำคัญ · ของขวัญแฟน · ของที่อยากได้ · อยากได้… · ให้ของขวัญแฟน · ประวัติ); ปุ่ม 🍽 ร้านอาหาร (แท็บเพิ่มเติม แทนปุ่ม สรุปเดือนนี้) เป็นปุ่มเลือกซ้อน: สุ่มร้าน · เพิ่มร้าน · ร้านทั้งหมด — ไม่อยู่ใต้ปุ่มทริป
- **NL**: ถามด้วยประโยคได้เฉพาะ `random_restaurant` (สุ่มร้าน) และ `partner_gifts` (ดู wishlist แฟน) — การเพิ่ม/ให้ ต้องใช้คำสั่ง
- ยังเหลือ: ไม่มีแก้ไขร้าน/wishlist (ลบแล้วเพิ่มใหม่), สุ่มยังไม่คิดระยะทาง/เวลาเปิด-ปิด, ไม่ได้ทดสอบกับลิงก์ Maps จริงและ push จริงบน LINE

### Sprint 5 — Data & Automation ✅ เสร็จแล้ว (ต้องรัน migration_014 และ 015 ก่อน deploy)

- **แยกหมวดค่าใช้จ่าย** — จัดอัตโนมัติทุกครั้งที่บันทึก (`addExpense` เรียก `classifyByRules` ใน `utils/categories.js`: keyword ตามลำดับ เจาะจงมาก่อน เช่น ค่าน้ำมัน→เดินทาง ก่อน ค่าน้ำ→บิล) ที่กฎจัดไม่ได้เป็น `other` → `services/categorize.js` ให้ Claude จัดเป็นชุด (เห็นแค่ชื่อรายการ เลือกได้เฉพาะ key ใน whitelist ไม่แน่ใจต้องตอบ other ไม่ถามซ้ำต่อโปรเซส ล้มเหลวข้ามเงียบๆ) เรียกอัตโนมัติตอน `สรุปเดือนนี้` หรือสั่งเองด้วย `จัดหมวด` (กฎก่อน → โมเดลเฉพาะที่เหลือ; ครอบรายการเก่าที่เป็น other ด้วย)
- **สรุปเดือนนี้แยกหมวด + งบ** — `สรุปเดือนนี้` แสดงยอดแต่ละหมวดเรียงมาก→น้อยพร้อมเทียบงบ (เดือนนับตามเวลาไทย); `ตั้งงบ อาหาร 5000` / `ดูงบ` / `ลบงบ อาหาร` (`commands/category.js`, ตาราง `category_budgets` migration_014, งบของทั้งคู่ร่วมกัน นับยอดเต็มของรายการ); เตือนตอนบันทึกรายการที่ทำให้ยอดเดือนนี้ **ข้าม 80%** และ **ข้าม 100%** ของงบ (เตือนครั้งเดียวต่อเส้น ไม่เตือนซ้ำทุกรายการ; `services/budgets.js` ต่อท้ายคำตอบของทุกทางที่บันทึก: พิมพ์ปกติ/หลายบรรทัด/NL/slip)
- **เตือนค้างชำระ** — หลังเจ้าหนี้ตอบ `ใช่` (เรียกเก็บ) ระบบบันทึกลง `billing_requests` (migration_015) แล้วตัวรัน 60 วิเดิมเตือน**ลูกหนี้** 09:00 น. (เวลาไทย) ของวันที่ 3 และวันที่ 7 พร้อมปุ่ม จ่ายแล้ว (`services/billing-reminders.js`) — ก่อนเตือนตรวจซ้ำว่ายังมียอดค้างจริง (ถ้าไม่มีแล้ว ปิดเรื่องเงียบๆ), ลูกหนี้กด `จ่ายแล้ว` = หยุดเตือน (ต่อด้วยเตือนยืนยันรับเงินของเจ้าหนี้), ถ้าเซิร์ฟเวอร์ดับข้ามทั้งสองวันส่งครั้งเดียว (ข้อความ 7 วัน), ส่งไม่สำเร็จลองใหม่รอบหน้า; ถ้ายังไม่รัน migration_015 การเรียกเก็บยังใช้ได้ปกติ แค่ไม่มีเตือน (log `BILLING_REQUEST_SAVE_FAILED`)

### Sprint 6 — Nice to have (ยังไม่เริ่ม)

- **ฟีเจอร์ความสัมพันธ์** — จำรายละเอียดของแฟน (เช่น ไม่ทานถั่วงอก), แนะนำกิจกรรม, สถานที่ที่แฟนอยากไป, ดูดวง
- **บิลรายเดือนร่วมกัน**

---

## Environment Variables (.env)

```
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=        ← sb_secret_... (ไม่ใช่ publishable key)
GOOGLE_PLACES_API_KEY=      ← EV route (places.js)
NL_MODEL=claude-haiku-5-5   ← โมเดลของ NL layer (ไม่ตั้งก็ใช้ค่านี้)
CRON_SECRET=                ← ป้องกัน POST /internal/run-notifications
DEVELOPMENT_MODE=true       ← ใช้ in-memory แทน Supabase (ใช้ตอนรัน npm test / local เท่านั้น)
PORT=3000
```

> ANTHROPIC_API_KEY ใช้ทั้งอ่าน slip และ NL layer — ถ้าเครดิตหมด slip จะอ่านไม่ได้ และประโยคที่ต้องใช้ AI จะตอบว่า "AI ใช้ไม่ได้" (คำสั่งปกติ + ประโยคยืม/คืนเงินที่โค้ดอ่านเองยังใช้ได้)

---

## วิธีทดสอบ / Run

ไม่ใช้ tunnel (ngrok/localtunnel) แล้ว:

```bash
npm test            # ชุดทดสอบทั้งหมด (in-memory ไม่แตะ DB จริง ไม่เรียก Claude API)
npm run eval:nl     # ประเมินประโยคที่ต้องใช้โมเดลจริง (ใช้เครดิต API)
```

ทดสอบกับ LINE จริงทำบน env ที่ deploy แล้ว (Railway) — รัน migration ใน Supabase ก่อน deploy ทุกครั้ง

---

## วิธีทดสอบด้วยมือบน LINE (ลำดับนี้)

```
1. ทั้งคู่พิมพ์ "ลงทะเบียน ชื่อ" ก่อน
2. พิมพ์ "ค่าอาหาร 350" → ดูว่าบันทึกได้
3. ส่งรูป slip → ดูว่าอ่านยอดได้
4. พิมพ์ "สรุป" → ดูยอดรวม
```

---

## Decisions ที่ตัดสินใจไปแล้ว (ห้าม revert)

- ใช้ JavaScript ไม่ใช่ TypeScript (เหตุผล: timeline สั้น 2 สัปดาห์)
- ใช้ Supabase ไม่ใช่ Firebase (เหตุผล: schema เป็น relational ต้องการ JOIN และ SUM)
- `is_cleared` flag ใช้ manual clear ก่อน (Sprint 1) ระบบ confirm อัตโนมัติทำใน Sprint 2
- slip ที่ส่งมาโดยไม่มีข้อความเพิ่ม → default `split_mode = half` เสมอ
- ถ้าพิมพ์ text เพิ่มพร้อม slip → ส่งให้ parser.js จัดการเหมือน text ปกติ
- ระบบ settlement (จ่ายแล้ว/รับแล้ว) ทำเสร็จแล้วใน Sprint 1
