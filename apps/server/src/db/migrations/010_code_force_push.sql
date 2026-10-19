-- Geri sarma sonrası uzak branch commit'lerimizden ilerideyse bir sonraki push zorla (--force) yapılır (branch bize aittir).
alter table code_sessions add column force_push boolean not null default false;
