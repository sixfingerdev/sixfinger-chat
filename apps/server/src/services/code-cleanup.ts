import type { AppContext } from '../context.ts';

type Ctx = Pick<AppContext, 'runs' | 'codeSandbox' | 'log'>;

/**
 * Code oturumları silinince çalışma alanları da (konteyner + diskteki klasör) silinir. Süren bir üretim varsa önce durdurulur.
 * Sandbox'a ulaşılamazsa oturum yine silinir (kullanıcının isteği engellenmez); hata yalnızca günlüğe yazılır.
 */
export async function destroyCodeWorkspaces(ctx: Ctx, userId: string, chatIds: string[]): Promise<void> {
  if (!chatIds.length) return;
  for (const id of chatIds) ctx.runs.forChat(id)?.stop();
  const sandbox = ctx.codeSandbox;
  if (!sandbox) return;
  await Promise.all(
    chatIds.map((id) =>
      sandbox.destroy({ user: userId, session: `${userId}:${id}` }).catch((err) => {
        ctx.log.warn({ err: String(err), chatId: id }, 'Code çalışma alanı silinemedi (oturum yine de silindi)');
      }),
    ),
  );
}
