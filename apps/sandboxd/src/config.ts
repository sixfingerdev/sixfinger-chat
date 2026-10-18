import { z } from 'zod';

const int = (def: number, min = 1) => z.coerce.number().int().min(min).default(def);

const schema = z.object({
  PORT: int(8791),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  /** Ana uygulamanın Authorization: Bearer ile göndereceği anahtar. */
  SANDBOXD_TOKEN: z.string().min(24, 'SANDBOXD_TOKEN en az 24 karakter olmalı'),

  /** docker: gerçek yalıtım. local-unsafe: YALNIZCA geliştirme/test (ana makinede çalıştırır, güvenli DEĞİL). */
  SANDBOX_RUNTIME: z.enum(['docker', 'local-unsafe']).default('docker'),
  SANDBOX_IMAGE: z.string().default('sixfinger-sandbox:latest'),
  /** none: internet yok. restricted: yalnızca 80/443 + DNS (ana makinede güvenlik duvarı kuralları şart, bkz. docs/sandbox.md). */
  SANDBOX_NETWORK: z.enum(['none', 'restricted']).default('none'),
  SANDBOX_NETWORK_NAME: z.string().default('sixfinger-sandbox'),
  SANDBOX_SUBNET: z.string().default('172.30.0.0/24'),
  SANDBOX_DNS: z.string().default('1.1.1.1,9.9.9.9'),
  /** Anlık görüntüler (boştaki sandbox'ların /work içeriği). SD kart yerine harici diske taşımak için bunu değiştir. */
  SANDBOX_DATA_DIR: z.string().default('/var/lib/sixfinger-sandbox'),

  MAX_CONTAINERS: int(6),
  MAX_CONCURRENT_EXEC: int(4),
  MAX_QUEUE: int(12, 0),
  IDLE_SECONDS: int(300, 5),
  MEM_MB: int(320, 64),
  CPUS: z.coerce.number().min(0.1).default(0.5),
  PIDS: int(64, 8),
  WORK_MB: int(64, 4),
  TMP_MB: int(32, 4),
  SNAPSHOT_MAX_MB: int(16, 1),
  EXEC_DEFAULT_SECONDS: int(30, 1),
  EXEC_MAX_SECONDS: int(120, 1),
  OUTPUT_MAX_BYTES: int(65_536, 1024),
  FILE_MAX_BYTES: int(1_000_000, 1024),
});

export type Config = z.infer<typeof schema> & { dnsServers: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Geçersiz ortam değişkenleri:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const c = parsed.data;
  if (c.SANDBOX_RUNTIME === 'local-unsafe' && env.NODE_ENV === 'production') {
    throw new Error('SANDBOX_RUNTIME=local-unsafe üretimde kullanılamaz.');
  }
  return { ...c, dnsServers: c.SANDBOX_DNS.split(',').map((s) => s.trim()).filter(Boolean) };
}
