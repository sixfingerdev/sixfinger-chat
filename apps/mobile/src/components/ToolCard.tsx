import { useState } from 'react';
import { ActivityIndicator, Text as RNText } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Check, ChevronRight, CircleAlert, FilePlus, FileText, Globe, Pencil, Plug, Search, Terminal, Wrench } from 'lucide-react-native';
import { approvalOf, describeTool, splitMcpToolName, type MessagePartDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { Press } from './Ui.tsx';
import { ApprovalCard } from './connectors/ApprovalCard.tsx';
import type { MessageActions } from './code/CodeCards.tsx';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;
const ICONS = { web_search: Search, web_fetch: Globe, bash: Terminal, read: FileText, write: FilePlus, edit: Pencil } as const;

/**
 * Modelin çağırdığı bir aracın kartı. Veriyi değiştiren MCP aracı onay bekliyorsa (`meta.approval`) onay kartı çizilir;
 * `chatId` (ve Code'da `actions`) kararın ardından modele kısa mesaj göndermek için gerekir.
 */
export function ToolCard({ part, chatId, actions }: { part: ToolPart; chatId?: string; actions?: MessageActions }) {
  const approval = approvalOf(part.meta);
  return approval ? <ApprovalCard approval={approval} chatId={chatId} actions={actions} /> : <PlainToolCard part={part} />;
}

/** Katlanabilir araç kartı: durum, özet ve (açılınca) girdi/çıktı. */
function PlainToolCard({ part }: { part: ToolPart }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const mcp = splitMcpToolName(part.name);
  const described = describeTool(part, locale);
  const running = part.status === 'running';
  // MCP aracı: "{sunucu} › {araç}" (çalışırken "… çalışıyor").
  const label = mcp && running ? t('mcp.tool.running', { server: String(part.meta?.server ?? mcp.server), tool: String(part.meta?.tool ?? mcp.tool) }) : described.label;
  const detail = described.detail;
  const Icon = ICONS[part.name as keyof typeof ICONS] ?? (mcp ? Plug : Wrench);
  const failed = part.status === 'error';
  const canOpen = !running && Boolean(part.output);
  const tone = failed ? c.danger : running ? c.accent : c.text3;

  return (
    <Animated.View
      layout={LinearTransition.duration(180)}
      style={{
        marginVertical: 6,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: failed ? c.danger : running ? c.accent : c.line,
        backgroundColor: c.surface,
        overflow: 'hidden',
      }}
    >
      <Press
        scale={0.99}
        disabled={!canOpen}
        haptics={canOpen ? 'select' : false}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12 }}
      >
        <Icon size={15} color={c.accent} />
        <RNText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.sansSemibold, fontSize: 13.5, color: c.text }}>
          {label}
        </RNText>
        <RNText numberOfLines={1} style={[type.small, { flex: 1, color: c.text3 }]}>
          {detail}
        </RNText>
        {running ? (
          <ActivityIndicator size="small" color={c.accent} />
        ) : failed ? (
          <CircleAlert size={15} color={tone} />
        ) : (
          <Check size={15} color={tone} />
        )}
        {canOpen && <ChevronRight size={14} color={c.text3} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />}
      </Press>
      {open && (
        <Animated.View entering={FadeIn.duration(160)} style={{ borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.codeBg, padding: 12, gap: 6 }}>
          {!failed && part.summary && <RNText style={[type.small, { color: c.text2 }]}>{part.summary}</RNText>}
          <RNText style={[type.label, { color: c.text3 }]}>{t('tool.input')}</RNText>
          <RNText selectable style={[type.mono, { fontSize: 12, lineHeight: 17, color: c.text2 }]}>
            {JSON.stringify(part.args, null, 2)}
          </RNText>
          <RNText style={[type.label, { color: c.text3, marginTop: 4 }]}>{t('tool.output')}</RNText>
          <RNText selectable style={[type.mono, { fontSize: 12, lineHeight: 17, color: c.text2 }]}>
            {(part.output ?? '').slice(0, 1_200)}
          </RNText>
        </Animated.View>
      )}
    </Animated.View>
  );
}
