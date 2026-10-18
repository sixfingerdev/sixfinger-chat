import { useState } from 'react';
import { Alert, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Archive, ArchiveRestore, ChevronDown, Download, Ellipsis, FileJson, Lock, Menu, Pin, PinOff, Pencil, Share2, Trash2 } from 'lucide-react-native';
import { PERSONAS, getPersona } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { shareText, toJson, toMarkdown } from '../lib/export.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { activePath, indexMessages } from '../lib/tree.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { useDrawer } from './Drawer.tsx';
import { PersonaIcon } from './PersonaIcon.tsx';
import { RenameDialog } from './RenameDialog.tsx';
import { Sheet } from './Sheet.tsx';
import { Press } from './Ui.tsx';

function RoundBtn({ children, onPress, label }: { children: React.ReactNode; onPress: () => void; label: string }) {
  return (
    <Press accessibilityLabel={label} haptics="tap" scale={0.88} onPress={onPress} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </Press>
  );
}

export function TopBar({ chatId }: { chatId: string | undefined }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const drawer = useDrawer();
  const detail = useChats((s) => (chatId ? s.detail[chatId] : undefined));
  const draftPersona = useChats((s) => s.draftPersona);
  const user = useAuth((s) => s.user);
  const features = useUi((s) => s.config?.limits.features);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const chat = detail?.chat;
  const hasMessages = Boolean(detail && detail.messages.length);
  const persona = getPersona(chat?.personaId ?? draftPersona ?? 'default');
  const pathMessages = () => (detail ? activePath(indexMessages(detail.messages), detail.chat.leafId) : []);
  const upgrade = () => router.push({ pathname: '/auth', params: { mode: 'register' } });

  const choosePersona = (id: string) => {
    if (id !== 'default' && !features?.personas) {
      useUi.getState().toast({ kind: 'info', text: t('limits.title'), action: { label: t('limits.upgrade'), run: upgrade } });
      return;
    }
    if (chat) void useChats.getState().setPersona(chat.id, id);
    else useChats.getState().setDraftPersona(id);
  };

  const share = async () => {
    if (!chat) return;
    if (!features?.share) {
      useUi.getState().toast({
        kind: 'info',
        text: user?.isGuest ? t('limits.title') : t('composer.attachLocked'),
        action: user?.isGuest ? { label: t('limits.upgrade'), run: upgrade } : { label: t('limits.verify'), run: () => router.push({ pathname: '/auth', params: { mode: 'verify' } }) },
      });
      return;
    }
    try {
      const { slug, url } = await api.share(chat.id);
      useChats.setState({ detail: { ...useChats.getState().detail, [chat.id]: { ...detail!, chat: { ...chat, shareSlug: slug } } } });
      haptic.success();
      await shareText(chat.title, url);
    } catch (err) {
      reportError(err);
    }
  };

  const actions = chat
    ? [
        { icon: Share2, label: t('chat.share'), run: share },
        { icon: Pencil, label: t('common.rename'), run: () => setRenaming(true) },
        { icon: Download, label: t('chat.exportMd'), run: () => shareText(chat.title, toMarkdown(chat.title, pathMessages(), { you: t('common.you'), ai: 'SixFinger' })) },
        { icon: FileJson, label: t('chat.exportJson'), run: () => shareText(chat.title, toJson(chat.title, pathMessages())) },
        { icon: chat.pinned ? PinOff : Pin, label: chat.pinned ? t('chat.unpin') : t('chat.pin'), disabled: !features?.pin, run: () => useChats.getState().pinChat(chat.id, !chat.pinned) },
        {
          icon: chat.archived ? ArchiveRestore : Archive,
          label: chat.archived ? t('chat.unarchive') : t('chat.archive'),
          run: async () => {
            await useChats.getState().archiveChat(chat.id, !chat.archived);
            if (!chat.archived) useChats.getState().newChat();
          },
        },
        {
          icon: Trash2,
          label: t('common.delete'),
          danger: true,
          run: () =>
            Alert.alert(t('chat.deleteConfirm'), chat.title, [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.delete'),
                style: 'destructive',
                onPress: async () => {
                  if (await useChats.getState().deleteChat(chat.id)) {
                    haptic.success();
                    useUi.getState().toast({ kind: 'success', text: t('chat.deleted') });
                    useChats.getState().newChat();
                  }
                },
              },
            ]),
        },
      ]
    : [];

  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 2 }}>
        <RoundBtn label={t('sidebar.toggle')} onPress={drawer.open}>
          <Menu size={22} color={c.text} />
        </RoundBtn>
        <Press
          haptics="select"
          scale={0.96}
          onPress={() => setPersonaOpen(true)}
          style={{ height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 19, backgroundColor: c.surface2, flexShrink: 1 }}
        >
          <PersonaIcon name={persona.icon} size={15} color={c.accent} />
          <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text, flexShrink: 1 }}>
            {persona.name[locale]}
          </RNText>
          <ChevronDown size={14} color={c.text3} />
        </Press>
        <View style={{ flex: 1 }} />
        {chat && hasMessages && (
          <RoundBtn label="Menu" onPress={() => setMenuOpen(true)}>
            <Ellipsis size={22} color={c.text} />
          </RoundBtn>
        )}
      </View>
      {chat && hasMessages && (
        <RNText numberOfLines={1} style={[type.small, { color: c.text3, textAlign: 'center', marginTop: -6, paddingBottom: 6, paddingHorizontal: 70 }]}>
          {chat.title}
        </RNText>
      )}

      <Sheet visible={personaOpen} onClose={() => setPersonaOpen(false)}>
        <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
          <RNText style={[type.label, { color: c.text3, paddingHorizontal: 12, paddingBottom: 8 }]}>{t('chat.persona')}</RNText>
          {PERSONAS.map((p) => {
            const locked = p.id !== 'default' && !features?.personas;
            const active = p.id === persona.id;
            return (
              <Press
                key={p.id}
                scale={0.985}
                haptics="select"
                onPress={() => {
                  setPersonaOpen(false);
                  choosePersona(p.id);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: active ? c.accentSoft : 'transparent' }}
              >
                <PersonaIcon name={p.icon} size={19} color={active ? c.accent : c.text2} />
                <View style={{ flex: 1 }}>
                  <RNText style={[type.body, { color: c.text, fontFamily: fonts.sansMedium }]}>{p.name[locale]}</RNText>
                  <RNText numberOfLines={1} style={[type.small, { color: c.text3 }]}>
                    {p.description[locale]}
                  </RNText>
                </View>
                {locked && <Lock size={15} color={c.text3} />}
              </Press>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
          {actions.map((it, i) => (
            <Press
              key={i}
              scale={0.985}
              haptics="tap"
              disabled={'disabled' in it && it.disabled}
              onPress={() => {
                setMenuOpen(false);
                void it.run();
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 52, paddingHorizontal: 12, borderRadius: radius.md, opacity: 'disabled' in it && it.disabled ? 0.4 : 1 }}
            >
              <it.icon size={19} color={'danger' in it && it.danger ? c.danger : c.text2} />
              <RNText style={[type.body, { color: 'danger' in it && it.danger ? c.danger : c.text }]}>{it.label}</RNText>
            </Press>
          ))}
        </View>
      </Sheet>
      <RenameDialog chat={renaming ? (chat ?? null) : null} onClose={() => setRenaming(false)} />
    </View>
  );
}
