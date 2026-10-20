-- Uzaktan kontrol (RC) sağlamlaştırma: protokol/yetenek bildirimi, onaylı komut teslimi, tekrar gönderim ve idempotency.
alter table linked_devices
  add column if not exists protocol int not null default 1,
  add column if not exists capabilities jsonb not null default '[]'::jsonb;

-- Sunucu komut türlerini bilmez (CLI'da sunucuda olmayan araçlar/komutlar olabilir): tür kısıtı kalkar, yalnızca biçim doğrulanır.
alter table link_commands drop constraint if exists link_commands_kind_check;
alter table link_commands drop constraint if exists link_commands_status_check;
alter table link_commands
  add column if not exists attempts int not null default 0,
  add column if not exists sent_at timestamptz,
  add column if not exists result jsonb,
  add column if not exists idem text;
alter table link_commands add constraint link_commands_status_check check (status in ('pending', 'sent', 'done', 'failed', 'expired'));
create unique index if not exists link_commands_idem_idx on link_commands (device_id, idem) where idem is not null;
