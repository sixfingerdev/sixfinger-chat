import { loadConfig } from './config.ts';
import { DockerRuntime } from './runtime/docker.ts';
import { LocalRuntime } from './runtime/local.ts';
import { buildServer } from './server.ts';
import { SandboxService } from './service.ts';

const cfg = loadConfig();
const bootLog = { info: (o: object, m: string) => console.log(m, o), warn: (o: object, m: string) => console.warn(m, o), error: (o: object, m: string) => console.error(m, o) };

let runtime;
if (cfg.SANDBOX_RUNTIME === 'local-unsafe') {
  console.warn('⚠️  SANDBOX_RUNTIME=local-unsafe: komutlar YALITIM OLMADAN ana makinede çalışır. Yalnızca geliştirme içindir.');
  runtime = new LocalRuntime();
} else {
  const docker = new DockerRuntime(cfg, bootLog);
  const h = await docker.health();
  if (!h.ok) throw new Error(`Docker'a ulaşılamıyor: ${JSON.stringify(h.details)}`);
  if (docker.networkMode === 'restricted') {
    // Güvenlik duvarı kuralları olmadan internet vermek ağı ana makineye açar: önce sına, geçemezse ağı kapat.
    const probe = await docker.verifyIsolation();
    if (!probe.ok) {
      console.error('🚫 Ağ yalıtımı doğrulanamadı; sandbox internete KAPALI başlatılıyor. Erişilebilen hedefler:', probe.reachable);
      console.error('   Çözüm: ana makinede `sudo scripts/sandbox-firewall.sh` çalıştır (docs/sandbox.md).');
      docker.networkMode = 'none';
    } else {
      console.log('✅ Ağ yalıtımı doğrulandı: sandbox yalnızca 80/443 ve DNS ile internete çıkabilir.');
    }
  }
  runtime = docker;
}

const service = new SandboxService(cfg, runtime, bootLog);
await service.start();
const app = buildServer(service, cfg);
await app.listen({ port: cfg.PORT, host: cfg.HOST });

const shutdown = async () => {
  await app.close();
  await service.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
