-- Code commit atfı: oturum bağlantısı commit mesajına yazılsın mı (ortam başına). Ortak yazar satırı her zaman eklenir.
alter table code_environments add column commit_session_link boolean not null default false;
