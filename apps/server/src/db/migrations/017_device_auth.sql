-- Cihaz (CLI) girişi: cihaz kodu akışı. Kullanıcı tarayıcıda kodu onaylar, CLI jeton alır.
create table if not exists device_auth (
  device_hash text primary key,
  user_code text not null unique,
  client text not null default 'SixFinger Code',
  status text not null default 'pending' check (status in ('pending', 'approved', 'consumed')),
  user_id uuid references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists device_auth_expires_idx on device_auth (expires_at);
