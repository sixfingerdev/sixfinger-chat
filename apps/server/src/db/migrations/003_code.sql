-- SixFinger Code: GitHub bağlantısı, ortamlar ve oturumlar.
-- Bir Code oturumu, `kind = 'code'` olan bir sohbettir (mesajlar, arka plan üretimi ve akış aynen paylaşılır).
alter table chats add column kind text not null default 'chat' check (kind in ('chat', 'code'));
create index chats_kind_idx on chats (user_id, kind);

create table github_connections (
  user_id    uuid primary key references users(id) on delete cascade,
  github_id  bigint not null,
  login      text not null,
  avatar_url text not null default '',
  -- AES-256-GCM ile şifreli erişim token'ı (CODE_SECRET_KEY).
  token_enc  text not null,
  scope      text not null default '',
  created_at timestamptz not null default now()
);

create table code_environments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  name            text not null,
  network         text not null default 'trusted' check (network in ('none', 'trusted', 'full', 'custom')),
  allowed_domains text[] not null default '{}',
  -- Şifreli JSON: {"ANAHTAR": "değer"}
  env_vars_enc    text not null default '',
  setup_script    text not null default '',
  disk_mb         integer not null default 512 check (disk_mb between 128 and 1536),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index code_environments_name_uidx on code_environments (user_id, lower(name));

create table code_sessions (
  chat_id        uuid primary key references chats(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  repo           text not null,
  base_branch    text not null,
  work_branch    text not null,
  environment_id uuid references code_environments(id) on delete set null,
  status         text not null default 'idle' check (status in ('idle', 'running', 'error')),
  disk_used_mb   integer not null default 0,
  created_at     timestamptz not null default now()
);
create index code_sessions_user_idx on code_sessions (user_id, created_at desc);

-- Günlük Code kredisi (model + sandbox süresi + disk). Bkz. packages/shared/src/code-credits.ts
create table code_credit_daily (
  user_id uuid not null references users(id) on delete cascade,
  day     date not null,
  credits numeric(12, 3) not null default 0,
  primary key (user_id, day)
);
