import { useEffect, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { Check, ChevronRight, ShieldAlert, X } from 'lucide-react-native';
import { MCP_LIMITS, type McpApprovalMeta } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { ApiError, api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { shortJson } from '../../lib/mcp.ts';
import { useChats } from '../../store/chats.ts';
import { Button, Press } from '../Ui.tsx';
import type { MessageActions } from '../code/CodeCards.tsx';

type Phase = 'loading' | 'pending' | 'approved' | 'denied' | 'expired';

/** Karar verilmiş / süresi dolmuş onaylar tekrar çizimde (liste sanallaştırması) yeniden sorulmasın. */
const settled = new Map<string, Phase>();

/**
 * Veriyi değiştiren MCP aracının onay kartı (araç parçasının `meta.approval` alanı). Düğmeler kararı sunucuya yazar, ardından
 * modele kısa bir kullanıcı mesajı gider; model aynı çağrıyı tekrarlar. Chat'te mesaj `useChats.send` ile, Code'da
 * soru kartıyla aynı yoldan (`actions.onAnswer`) gönderilir. Sohbet üretimdeyken düğmeler pasiftir.
 */
export function ApprovalCard({ approval, chatId, actions }: { approval: McpApprovalMeta; chatId?: string; actions?: MessageActions }) {
  const { c } = useTheme();
  const t = useT();
  const [phase, setPhase] = useState<Phase>(settled.get(approval.id) ?? 'loading');
  const [busy, setBusy] = useState(false);
  const [showArgs, setShowArgs] = useState(false);
  const generating = useChats((s) => Boolean(chatId && s.generating[chatId]));
  const locked = generating || busy || actions?.answerable === false;

  const settle = (p: Phase) => {
    if (p !== 'pending' && p !== 'loading') settled.set(approval.id, p);
    setPhase(p);
  };

  // Durum okunur: bekleyen değilse düğmeler yerine sonuç çipi çizilir.
  useEffect(() => {
    if (phase !== 'loading') return;
    let off = false;
    api
      .mcpApproval(approval.id)
      .then(({ approval: a }) => {
        if (off) return;
        const age = Date.now() - new Date(a.createdAt).getTime();
        if (a.status === 'pending') settle(age > MCP_LIMITS.approvalMinutes * 60_000 ? 'expired' : 'pending');
        else settle(a.status === 'denied' ? 'denied' : 'approved');
      })
      .catch((err) => {
        if (off) return;
        // Kayıt yoksa (silinmiş) süresi dolmuş say; ağ hatasında düğmeler açık kalır, karar anında hata verir.
        setPhase(err instanceof ApiError && err.status === 404 ? 'expired' : 'pending');
      });
    return () => {
      off = true;
    };
  }, [approval.id, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (decision: 'once' | 'always' | 'deny') => {
    if (locked) return;
    setBusy(true);
    try {
      await api.mcpDecide(approval.id, decision);
    } catch (err) {
      setBusy(false);
      // Süresi dolmuş ya da zaten yanıtlanmış: gerçek durumu yeniden oku.
      if (err instanceof ApiError && err.status === 400) setPhase('loading');
      reportError(err);
      return;
    }
    const deny = decision === 'deny';
    haptic.success();
    settle(deny ? 'denied' : 'approved');
    setBusy(false);
    const text = t(deny ? 'mcp.approval.deniedMsg' : 'mcp.approval.approvedMsg');
    if (actions) actions.onAnswer(text);
    else if (chatId) void useChats.getState().send({ content: text, chatId });
  };

  const done = phase === 'approved' || phase === 'denied' || phase === 'expired';
  const doneText = phase === 'approved' ? t('mcp.approval.done.approved') : phase === 'denied' ? t('mcp.approval.done.denied') : t('mcp.approval.expired');
  const DoneIcon = phase === 'approved' ? Check : X;

  return (
    <View style={{ marginVertical: 6, padding: 14, gap: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ShieldAlert size={16} color={c.text2} />
        <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>{t('mcp.approval.title')}</RNText>
      </View>
      <RNText style={[type.body, { color: c.text2, fontSize: 14.5, lineHeight: 21 }]}>{t('mcp.approval.body', { server: approval.server, tool: approval.tool })}</RNText>
      {Object.keys(approval.args ?? {}).length > 0 && (
        <View style={{ gap: 6 }}>
          <Press haptics="select" scale={0.98} onPress={() => setShowArgs((v) => !v)} style={{ alignSelf: 'flex-start', minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <ChevronRight size={14} color={c.text3} style={{ transform: [{ rotate: showArgs ? '90deg' : '0deg' }] }} />
            <RNText style={[type.small, { color: c.text3 }]}>{t('mcp.approval.args')}</RNText>
          </Press>
          {showArgs && (
            <View style={{ padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c.line, backgroundColor: c.codeBg }}>
              <RNText selectable style={[type.mono, { fontSize: 12, lineHeight: 17, color: c.text2 }]}>
                {shortJson(approval.args)}
              </RNText>
            </View>
          )}
        </View>
      )}
      {done ? (
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: c.surface2 }}>
          <DoneIcon size={14} color={c.text2} />
          <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: c.text2 }}>{doneText}</RNText>
        </View>
      ) : (
        <View style={{ gap: 8, opacity: phase === 'loading' ? 0.5 : 1 }}>
          <Button label={t('mcp.approval.once')} disabled={locked || phase === 'loading'} onPress={() => void decide('once')} style={{ height: 46 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button variant="secondary" label={t('mcp.approval.always')} disabled={locked || phase === 'loading'} onPress={() => void decide('always')} style={{ flex: 1, height: 46, paddingHorizontal: 8 }} />
            <Button variant="ghost" label={t('mcp.approval.deny')} disabled={locked || phase === 'loading'} onPress={() => void decide('deny')} style={{ flex: 1, height: 46, paddingHorizontal: 8 }} />
          </View>
        </View>
      )}
    </View>
  );
}
