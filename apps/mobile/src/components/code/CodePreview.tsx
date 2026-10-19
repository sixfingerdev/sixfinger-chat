import { useState } from 'react';
import { ActivityIndicator, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ChevronRight, CircleAlert, Download, FileDown, Monitor } from 'lucide-react-native';
import type { MessagePartDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { api } from '../../lib/api.ts';
import { reportError } from '../../lib/errors.ts';
import { formatBytes } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { Press } from '../Ui.tsx';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Çalışma alanındaki dosyayı indirir ve sistemin paylaşım sayfasını açar (kaydet / başka uygulamaya gönder). */
export async function shareWorkspaceFile(chatId: string, path: string): Promise<void> {
  try {
    const { url, headers } = api.codeDownloadRequest(chatId, path);
    const file = await File.downloadFileAsync(url, new Directory(Paths.cache), { headers, idempotent: true });
    haptic.success();
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
  } catch (err) {
    reportError(err);
  }
}

export function openPreview(chatId: string, spec: { path?: string; port?: number; root?: string; title?: string }): void {
  // Yazılı rota tipleri `expo start` ile üretilir; yeni ekran için tip dosyası bir sonraki başlatmada güncellenir.
  router.push({ pathname: '/code/preview', params: { id: chatId, ...(spec.path ? { path: spec.path } : {}), ...(spec.port ? { port: String(spec.port) } : {}), ...(spec.root !== undefined ? { root: spec.root } : {}), ...(spec.title ? { title: spec.title } : {}) } } as never);
}

const rowStyle = (c: ReturnType<typeof useTheme>['c']) => ({ marginVertical: 5, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }) as const;

/** "Önizleme" kartı: dokununca tam ekran önizleme açılır (bağlantı her açılışta yeniden alınır). */
export function PreviewRow({ part, chatId }: { part: ToolPart; chatId: string }) {
  const { c } = useTheme();
  const t = useT();
  const m = part.meta ?? {};
  const port = typeof m.port === 'number' ? m.port : undefined;
  const title = str(m.title) || str(m.path) || (port ? t('code.preview.server', { port }) : t('code.preview.title'));
  const running = part.status === 'running';
  const failed = part.status === 'error';
  return (
    <Press
      haptics={failed || running ? false : 'select'}
      scale={0.985}
      disabled={failed || running}
      onPress={() => openPreview(chatId, { path: str(m.path) || undefined, port, root: typeof m.root === 'string' ? m.root : undefined, title: str(m.title) || undefined })}
      style={rowStyle(c)}
    >
      {running ? <ActivityIndicator size="small" color={c.text2} /> : failed ? <CircleAlert size={16} color={c.text2} /> : <Monitor size={17} color={c.text} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>
          {t('code.preview.title')}
        </RNText>
        <RNText numberOfLines={failed ? 2 : 1} style={{ fontFamily: fonts.sans, fontSize: 12, color: c.text3 }}>
          {failed ? part.summary : title}
        </RNText>
      </View>
      {!failed && !running && <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 12.5, color: c.text2 }}>{t('code.preview.open')}</RNText>}
      {!failed && !running && <ChevronRight size={15} color={c.text3} />}
    </Press>
  );
}

/** Ajanın `share_file` ile verdiği dosya: ad, boyut ve indirme/paylaşma. */
export function ShareFileRow({ part, chatId }: { part: ToolPart; chatId: string }) {
  const { c } = useTheme();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const m = part.meta ?? {};
  const path = str(m.path);
  const name = str(m.name) || path.split('/').pop() || '';
  const size = typeof m.size === 'number' ? m.size : 0;
  const failed = part.status === 'error';
  const running = part.status === 'running';
  return (
    <Press
      haptics={failed || running ? false : 'select'}
      scale={0.985}
      disabled={failed || running || busy}
      onPress={async () => {
        setBusy(true);
        await shareWorkspaceFile(chatId, path);
        setBusy(false);
      }}
      style={rowStyle(c)}
    >
      {busy || running ? <ActivityIndicator size="small" color={c.text2} /> : failed ? <CircleAlert size={16} color={c.text2} /> : <FileDown size={17} color={c.text} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>
          {failed ? t('code.share.download') : name}
        </RNText>
        <RNText numberOfLines={failed ? 2 : 1} style={{ fontFamily: fonts.sans, fontSize: 12, color: c.text3 }}>
          {failed ? part.summary : [size ? formatBytes(size) : '', str(m.description)].filter(Boolean).join(' · ')}
        </RNText>
      </View>
      {!failed && !running && <Download size={17} color={c.text2} />}
    </Press>
  );
}
