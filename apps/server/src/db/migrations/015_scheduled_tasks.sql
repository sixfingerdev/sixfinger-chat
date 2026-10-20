-- Zamanlanmış görevler: belirli zamanlarda bir istemi çalıştırıp sonucu yeni bir sohbet olarak bırakır.
create table scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  prompt text not null,
  mode text not null default 'balanced' check (mode in ('fast', 'balanced', 'deep')),
  schedule jsonb not null,
  timezone text not null default 'Europe/Istanbul',
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_chat_id uuid,
  last_status text check (last_status in ('ok', 'error', 'skipped')),
  last_error text,
  run_count integer not null default 0,
  source text not null default 'user' check (source in ('user', 'agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scheduled_tasks_user_idx on scheduled_tasks (user_id, created_at);
create index scheduled_tasks_due_idx on scheduled_tasks (next_run_at) where enabled and next_run_at is not null;

alter table chats add column task_id uuid references scheduled_tasks(id) on delete set null;
create index chats_task_idx on chats (task_id, created_at desc) where task_id is not null;
