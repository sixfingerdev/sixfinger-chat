-- Uzaktan CLI köprüsü: kullanıcının cihazındaki SixFinger Code oturumları site/uygulamadan izlenir ve yönetilir.
create table if not exists linked_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  platform text not null default '',
  version text not null default '',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists linked_sessions (
  device_id uuid not null references linked_devices(id) on delete cascade,
  remote_id text not null,
  title text not null default '',
  directory text not null default '',
  status text not null default 'idle' check (status in ('idle', 'busy', 'waiting')),
  updated_at timestamptz not null default now(),
  -- son mesajlar (kırpılmış) ve bekleyen izin/soru istekleri
  snapshot jsonb not null default '[]'::jsonb,
  pending jsonb not null default '[]'::jsonb,
  primary key (device_id, remote_id)
);

-- Uzaktan komutlar: cihaz bir sonraki eşitlemede alır; 2 dakikadan eskisi çalıştırılmaz.
create table if not exists link_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references linked_devices(id) on delete cascade,
  remote_id text not null,
  kind text not null check (kind in ('prompt', 'abort', 'permission', 'question')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'expired')),
  created_at timestamptz not null default now()
);
create index if not exists link_commands_pending_idx on link_commands (device_id, status, created_at);
