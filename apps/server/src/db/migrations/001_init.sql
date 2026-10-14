-- SixFinger Chat — başlangıç şeması
create extension if not exists pgcrypto;

create table users (
  id              uuid primary key default gen_random_uuid(),
  email           text,
  password_hash   text,
  display_name    text not null default '',
  is_guest        boolean not null default false,
  email_verified_at timestamptz,
  locale          text not null default 'tr',
  role            text not null default 'user',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
create unique index users_email_uidx on users (lower(email)) where email is not null;
create index users_guest_seen_idx on users (last_seen_at) where is_guest;

create table user_settings (
  user_id         uuid primary key references users(id) on delete cascade,
  custom_name     text not null default '',
  about           text not null default '',
  instructions    text not null default '',
  default_persona text not null default 'default',
  memory_enabled  boolean not null default true
);

create table refresh_tokens (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  token_hash       text not null unique,
  -- Son dönüşümden önceki token; eşzamanlı yenilemelerde (iki sekme) kısa süre geçerli kalır.
  prev_hash        text unique,
  prev_valid_until timestamptz,
  user_agent       text,
  ip               text,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz
);
create index refresh_tokens_user_idx on refresh_tokens (user_id) where revoked_at is null;

create table email_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,
  email       text not null,
  purpose     text not null check (purpose in ('verify', 'reset')),
  code_hash   text not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index email_codes_lookup_idx on email_codes (lower(email), purpose, created_at desc);

create table chats (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  title           text not null default 'Yeni sohbet',
  title_generated boolean not null default false,
  persona_id      text not null default 'default',
  pinned          boolean not null default false,
  archived        boolean not null default false,
  leaf_id         uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz
);
create index chats_user_idx on chats (user_id, pinned desc, coalesce(last_message_at, created_at) desc);

create table messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references chats(id) on delete cascade,
  parent_id    uuid references messages(id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null default '',
  reasoning    text not null default '',
  reasoning_ms integer,
  status       text not null default 'complete' check (status in ('complete', 'streaming', 'error', 'stopped')),
  model        text,
  attachments  jsonb not null default '[]'::jsonb,
  feedback     smallint check (feedback in (-1, 1)),
  tokens_in    integer,
  tokens_out   integer,
  created_at   timestamptz not null default now(),
  seq          bigint generated always as identity
);
create index messages_chat_idx on messages (chat_id, seq);
create index messages_parent_idx on messages (parent_id);
alter table chats add constraint chats_leaf_fk foreign key (leaf_id) references messages(id) on delete set null;

-- Arama için basit ve bağımlılıksız: başlık + mesaj içeriği üzerinde trigram yerine ILIKE.
create index messages_content_search_idx on messages using gin (to_tsvector('simple', content));

create table memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);
create index memories_user_idx on memories (user_id, created_at desc);

create table shares (
  slug        text primary key,
  chat_id     uuid not null unique references chats(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  title       text not null,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now()
);

create table usage_daily (
  user_id  uuid not null references users(id) on delete cascade,
  day      date not null,
  messages integer not null default 0,
  primary key (user_id, day)
);

-- Misafir hesap farmını engellemek için IP başına günlük sayaç
create table usage_ip (
  ip       text not null,
  day      date not null,
  messages integer not null default 0,
  primary key (ip, day)
);
