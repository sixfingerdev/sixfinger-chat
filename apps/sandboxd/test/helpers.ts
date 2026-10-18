import { loadConfig, type Config } from '../src/config.ts';
import { LocalRuntime } from '../src/runtime/local.ts';
import { SandboxService } from '../src/service.ts';

export const quiet = { info: () => {}, warn: () => {}, error: () => {} };

export function makeConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    SANDBOXD_TOKEN: 'test-token-test-token-test-token',
    SANDBOX_RUNTIME: 'local-unsafe',
    SANDBOX_DATA_DIR: '/tmp/sf-sandboxd-test',
    ...over,
  } as NodeJS.ProcessEnv);
}

export function makeService(over: Record<string, string> = {}, now?: () => number) {
  const cfg = makeConfig(over);
  const runtime = new LocalRuntime();
  const service = new SandboxService(cfg, runtime, quiet, now);
  return { cfg, runtime, service, cleanup: () => runtime.cleanup() };
}
