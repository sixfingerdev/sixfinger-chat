-- Kullanıcının skill'leri (Agent Skills biçimi: SKILL.md gövdesi + ek metin dosyaları) ve ortam başına kapatılan skill'ler.
create table code_skills (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,
  description   text not null,
  body          text not null,
  triggers      text[] not null default '{}',
  -- Ek dosyalar: {"references/api.md": "metin", "scripts/run.py": "..."} (yalnızca metin).
  files         jsonb not null default '{}',
  -- Bağlantıyla paylaşım: token'ı bilen herkes (giriş yapmış) kendi hesabına içe aktarabilir.
  share_token   text unique,
  imported_from text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, name)
);

alter table code_environments add column skills_off text[] not null default '{}';
