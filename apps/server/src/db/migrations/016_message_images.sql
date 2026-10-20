-- Mesajlara eklenen görseller. Baytlar ayrı tabloda tutulur: sohbet listesi/ayrıntısı hafif kalır, görsel ayrı uçtan (GET /api/images/:id) alınır.
create table message_images (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null default 'gorsel',
  mime text not null,
  data bytea not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index message_images_message_idx on message_images (message_id, position);
