import { buildApp } from './app.ts';
import { runMaintenance } from './maintenance.ts';

const { app, ctx } = await buildApp();

const maintain = () => runMaintenance(ctx).catch((err) => app.log.error({ err }, 'bakım hatası'));
await maintain();
const timer = setInterval(maintain, 60 * 60 * 1000);
timer.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'kapatılıyor');
  clearInterval(timer);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: ctx.config.PORT, host: ctx.config.HOST });
} catch (err) {
  app.log.fatal({ err }, 'sunucu başlatılamadı');
  process.exit(1);
}
