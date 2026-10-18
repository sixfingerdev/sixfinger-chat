-- Asistan mesajının sıralı parçaları (metin + araç çağrıları). Eski mesajlarda boş kalır.
alter table messages add column parts jsonb not null default '[]'::jsonb;
