-- Ajan, tur sonunda commit'i GitHub'a itip PR açsın mı (varsayılan açık) ve oturumun PR'ı.
alter table code_environments add column auto_pr boolean not null default true;
alter table code_sessions add column pr_number integer;
alter table code_sessions add column pr_url text;
