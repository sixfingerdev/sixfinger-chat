-- Code oturumunun son bağlam doluluğu (tahmini token): başlıktaki halka.
alter table code_sessions add column context_tokens integer not null default 0;
