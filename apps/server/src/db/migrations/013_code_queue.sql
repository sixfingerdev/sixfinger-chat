-- Code oturumunda çalışırken sıraya eklenen mesajlar. Sunucuda tutulur: uygulama kapansa/yenilense de kaybolmaz ve tur bitince sunucu sıradakini kendisi başlatır.
create table code_queue (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  plan_mode boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index code_queue_chat_idx on code_queue (chat_id, created_at, id);
