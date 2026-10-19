import { useState, type ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';
import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Trash2 } from 'lucide-react-native';
import type { CodeSessionDTO } from '@sixfinger/shared';
import { radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { haptic } from '../../lib/haptics.ts';
import { useT } from '../../lib/i18n/index.ts';
import { useCode } from '../../store/code.ts';
import { Press } from '../Ui.tsx';
import { RenameDialog } from '../RenameDialog.tsx';
import { Sheet } from '../Sheet.tsx';

export function MenuItem({ icon, label, danger, onPress }: { icon: ReactNode; label: string; danger?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Press haptics="tap" scale={0.985} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 52, paddingHorizontal: 12, borderRadius: radius.md }}>
      {icon}
      <RNText style={[type.body, { color: danger ? c.danger : c.text }]}>{label}</RNText>
    </Press>
  );
}

/**
 * Oturum işlemleri: yeniden adlandır, sabitle, arşivle, sil. `extra` ekranın kendi öğelerini (dosyalar, dışa aktar) başa ekler.
 * `onArchived` arşivleme sonrası çağrılır (oturum ekranı listeye döner).
 */
export function SessionMenu({
  session,
  onClose,
  onDelete,
  onArchived,
  extra,
}: {
  session: CodeSessionDTO | null;
  onClose: () => void;
  onDelete: (s: CodeSessionDTO) => void;
  onArchived?: () => void;
  extra?: (close: () => void) => ReactNode;
}) {
  const { c } = useTheme();
  const t = useT();
  const [renaming, setRenaming] = useState<CodeSessionDTO | null>(null);
  // Kapanış animasyonu sürerken içerik kaybolmasın diye son oturum tutulur.
  const [last, setLast] = useState<CodeSessionDTO | null>(null);
  if (session && session !== last) setLast(session);
  const s = session ?? last;

  const update = async (patch: { pinned?: boolean; archived?: boolean }) => {
    if (!s) return;
    onClose();
    if (await useCode.getState().updateSession(s.chatId, patch)) {
      haptic.success();
      if (patch.archived) onArchived?.();
    }
  };

  return (
    <>
      <Sheet visible={Boolean(session)} onClose={onClose}>
        {s && (
          <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
            {extra?.(onClose)}
            <MenuItem
              icon={<Pencil size={19} color={c.text} />}
              label={t('code.session.rename')}
              onPress={() => {
                onClose();
                setRenaming(s);
              }}
            />
            <MenuItem
              icon={s.pinned ? <PinOff size={19} color={c.text} /> : <Pin size={19} color={c.text} />}
              label={s.pinned ? t('code.session.unpin') : t('code.session.pin')}
              onPress={() => void update({ pinned: !s.pinned })}
            />
            <MenuItem
              icon={s.archived ? <ArchiveRestore size={19} color={c.text} /> : <Archive size={19} color={c.text} />}
              label={s.archived ? t('code.session.unarchive') : t('code.session.archive')}
              onPress={() => void update({ archived: !s.archived })}
            />
            <MenuItem
              danger
              icon={<Trash2 size={19} color={c.danger} />}
              label={t('code.session.delete')}
              onPress={() => {
                onClose();
                onDelete(s);
              }}
            />
          </View>
        )}
      </Sheet>
      <RenameDialog
        chat={renaming ? { id: renaming.chatId, title: renaming.title } : null}
        onClose={() => setRenaming(null)}
        onSave={(id, title) => void useCode.getState().updateSession(id, { title })}
      />
    </>
  );
}
