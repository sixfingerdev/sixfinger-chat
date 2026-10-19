-- Code oturumunun başlangıç commit'ine göre toplam değişikliği (liste kartı ve oturum çubuğundaki +N −M çipi).
alter table code_sessions
  add column additions integer not null default 0,
  add column deletions integer not null default 0,
  add column files_changed integer not null default 0,
  add column head_sha text;
