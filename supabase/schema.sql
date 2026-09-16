create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique not null,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  paid_by text not null,
  amount numeric(10,2) not null,
  description text not null,
  category text default 'other',
  split_mode text default 'half' check (split_mode in ('half', 'none', 'custom', 'per_head')),
  num_people int,
  is_cleared boolean default false,
  slip_url text,
  created_at timestamptz default now()
);

create table if not exists expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid references expenses(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  amount numeric(10,2) not null
);

create table if not exists monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  month text,
  total_paid numeric(10,2),
  total_owed numeric(10,2),
  cleared_at timestamptz default now()
);

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  name text,
  destination text,
  start_date date,
  end_date date,
  created_at timestamptz default now()
);
