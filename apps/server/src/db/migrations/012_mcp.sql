-- MCP bağlayıcıları: kullanıcının uzak MCP sunucuları (araç listesi önbellekli) ve yazan araçlar için onay kayıtları.
create table mcp_servers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  -- Araç adlarında kullanılan kısa ad: mcp__<name>__<araç>
  name         text not null,
  label        text not null,
  url          text not null,
  preset       text,
  auth_kind    text not null default 'none' check (auth_kind in ('none', 'headers', 'oauth')),
  -- Şifreli (secretbox) JSON: {headers:{…}} ya da OAuth {client, tokens, verifier, discovery}.
  auth_enc     text not null default '',
  header_names text[] not null default '{}',
  enabled      boolean not null default true,
  scopes       text[] not null default '{chat,code}',
  auto_approve boolean not null default false,
  allow_tools  text[] not null default '{}',
  -- Önbellek: [{name, description, inputSchema, readOnly}]
  tools        jsonb not null default '[]',
  tools_at     timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, name)
);

create table mcp_approvals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  chat_id     uuid not null references chats(id) on delete cascade,
  server_id   uuid not null references mcp_servers(id) on delete cascade,
  tool        text not null,
  args_hash   text not null,
  args        jsonb not null default '{}',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index mcp_approvals_lookup on mcp_approvals (user_id, chat_id, server_id, tool, args_hash);
