-- Sıradaki Code mesajının model tercihi: fast (hız öncelikli) ya da deep (güç öncelikli).
alter table code_queue add column mode text not null default 'deep';
