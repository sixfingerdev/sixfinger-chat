-- Code commit atıfı: ajan ortak yazar olarak eklensin mi, oturum bağlantısı yazılsın mı (ortam başına).
alter table code_environments add column commit_coauthor boolean not null default true;
alter table code_environments add column commit_session_link boolean not null default false;
