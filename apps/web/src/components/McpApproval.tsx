import { useEffect, useState } from 'react';
import { Check, ChevronRight, ShieldAlert, X } from 'lucide-react';
import { MCP_LIMITS, approvalOf, type MessagePartDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useT } from '../lib/i18n/index.ts';
import { useChats } from '../store/chats.ts';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;
type State = 'loading' | 'pending' | 'approved' | 'denied' | 'used' | 'expired';

/**
 * Yazan bir MCP aracı onay beklerken (tool parçasında `meta.approval`) gösterilen kart: Bir kez / Hep izin ver / Reddet.
 * Karar verilince model, kısa bir kullanıcı mesajıyla (onayladım / reddettim) çağrıyı tekrarlar ya da bırakır.
 * Durum sunucudan okunur: sayfa yenilense de karar verilmiş kart yeniden düğme göstermez.
 */
export function ApprovalCard({ part, chatId }: { part: ToolPart; chatId: string }) {
  const t = useT();
  const meta = approvalOf(part.meta)!;
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [showArgs, setShowArgs] = useState(false);
  const generating = useChats((s) => Boolean(s.generating[chatId]));

  useEffect(() => {
    let alive = true;
    api
      .mcpApproval(meta.id)
      .then(({ approval }) => {
        if (!alive) return;
        const stale = Date.now() - Date.parse(approval.createdAt) > MCP_LIMITS.approvalMinutes * 60_000;
        setState(approval.status === 'pending' && stale ? 'expired' : approval.status);
      })
      .catch(() => alive && setState('expired'));
    return () => {
      alive = false;
    };
  }, [meta.id]);

  const decide = async (decision: 'once' | 'always' | 'deny') => {
    setBusy(true);
    try {
      await api.mcpDecide(meta.id, decision);
      setState(decision === 'deny' ? 'denied' : 'approved');
      void useChats.getState().send({ content: t(decision === 'deny' ? 'mcp.approval.deniedMsg' : 'mcp.approval.approvedMsg'), chatId });
    } catch (err) {
      reportError(err);
      setState('expired');
    } finally {
      setBusy(false);
    }
  };

  const live = state === 'pending';
  return (
    <div className={`mcp-approval${live ? '' : ' done'}`}>
      <div className="mcp-approval-head">
        <ShieldAlert size={15} />
        <strong>{t('mcp.approval.title')}</strong>
        {state === 'approved' || state === 'used' ? (
          <span className="mcp-approval-state ok">
            <Check size={13} /> {t('mcp.approval.done.approved')}
          </span>
        ) : state === 'denied' ? (
          <span className="mcp-approval-state">
            <X size={13} /> {t('mcp.approval.done.denied')}
          </span>
        ) : state === 'expired' ? (
          <span className="mcp-approval-state">{t('mcp.approval.expired')}</span>
        ) : null}
      </div>
      <p className="mcp-approval-body">{t('mcp.approval.body', { server: meta.server, tool: meta.tool })}</p>
      {Object.keys(meta.args).length > 0 && (
        <>
          <button className="mcp-args-toggle" aria-expanded={showArgs} onClick={() => setShowArgs((o) => !o)}>
            <ChevronRight size={13} className={showArgs ? 'open' : ''} /> {t('mcp.approval.args')}
          </button>
          {showArgs && <pre className="mcp-args">{JSON.stringify(meta.args, null, 2).slice(0, 4_000)}</pre>}
        </>
      )}
      {live && (
        <div className="mcp-approval-actions">
          <button className="btn btn-primary btn-sm" disabled={busy || generating} onClick={() => void decide('once')}>
            {t('mcp.approval.once')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || generating} onClick={() => void decide('always')}>
            {t('mcp.approval.always')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || generating} onClick={() => void decide('deny')}>
            {t('mcp.approval.deny')}
          </button>
        </div>
      )}
    </div>
  );
}
