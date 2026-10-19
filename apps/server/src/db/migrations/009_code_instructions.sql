-- Ortama bağlı kalıcı talimatlar (Claude Code'daki CLAUDE.md gibi): her turun sistem istemine eklenir.
alter table code_environments add column instructions text not null default '';
