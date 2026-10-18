import { memo, useMemo, useState } from 'react';
import { Alert, SectionList, Text as RNText, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Pencil, Pin, PinOff, Plus, Search, Settings, Trash2 } from 'lucide-react-native';
import type { ChatDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { groupChats, initials, type GroupKey } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Brand } from './Logo.tsx';
import { Sheet } from './Sheet.tsx';
import { Press, SlashBar } from './Ui.tsx';
import { useDrawer } from './Drawer.tsx';
import { RenameDialog } from './RenameDialog.tsx';

const ChatRow = memo(function ChatRow({
  chat,
  active,
  onOpen,
  onMenu,
}: {
  chat: ChatDTO;
  active: boolean;
  onOpen: (c: ChatDTO) => void;
  onMenu: (c: ChatDTO) => void;
}) {
  const { c } = useTheme();
  const t = useT();
  return (
    <Press
      scale={0.985}
      onPress={() => onOpen(chat)}
      onLongPress={() => {
        haptic.press();
        onMenu(chat);
      }}
      delayLongPress={320}
      style={{
        height: 46,
        marginHorizontal: 8,
        borderRadius: radius.sm,
        paddingLeft: 14,
        paddingRight: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: active ? c.surface2 : 'transparent',
      }}
    >
      {active && <SlashBar height={24} style={{ position: 'absolute', left: 3 }} />}
      <RNText numberOfLines={1} style={[type.body, { flex: 1, fontSize: 14.5, color: active ? c.text : c.text2, fontFamily: active ? fonts.sansMedium : fonts.sans }]}>
        {chat.title || t('chat.untitled')}
      </RNText>
      {chat.pinned && <Pin size={13} color={c.text3} />}
    </Press>
  );
});

type Section = { key: GroupKey | 'archived'; data: ChatDTO[] };

export function Sidebar() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const drawer = useDrawer();
  const user = useAuth((s) => s.user);
  const chats = useChats((s) => s.chats);
  const archived = useChats((s) => s.archived);
  const loaded = useChats((s) => s.chatsLoaded);
  const activeId = useChats((s) => s.activeId);
  const features = useUi((s) => s.config?.limits.features);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatDTO | null>(null);
  const [renaming, setRenaming] = useState<ChatDTO | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? chats.filter((x) => x.title.toLowerCase().includes(q)) : chats), [chats, q]);
  const sections = useMemo<Section[]>(() => {
    const groups: Section[] = groupChats(filtered).map((g) => ({ key: g.key, data: g.chats }));
    if (showArchived && archived?.length) groups.push({ key: 'archived', data: archived });
    return groups;
  }, [filtered, archived, showArchived]);

  const open = (chat: ChatDTO) => {
    drawer.close();
    void useChats.getState().openChat(chat.id);
  };
  const newChat = () => {
    haptic.tap();
    useChats.getState().newChat();
    drawer.close();
  };

  const confirmDelete = (chat: ChatDTO) => {
    Alert.alert(t('chat.deleteConfirm'), chat.title, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (await useChats.getState().deleteChat(chat.id)) {
            haptic.success();
            useUi.getState().toast({ kind: 'success', text: t('chat.deleted') });
            if (useChats.getState().activeId === chat.id) useChats.getState().newChat();
          }
        },
      },
    ]);
  };

  const menuItems = menuFor
    ? [
        { icon: Pencil, label: t('common.rename'), run: () => setRenaming(menuFor) },
        {
          icon: menuFor.pinned ? PinOff : Pin,
          label: menuFor.pinned ? t('chat.unpin') : t('chat.pin'),
          disabled: !features?.pin,
          run: () => void useChats.getState().pinChat(menuFor.id, !menuFor.pinned),
        },
        {
          icon: menuFor.archived ? ArchiveRestore : Archive,
          label: menuFor.archived ? t('chat.unarchive') : t('chat.archive'),
          run: async () => {
            await useChats.getState().archiveChat(menuFor.id, !menuFor.archived);
            if (!menuFor.archived && useChats.getState().activeId === menuFor.id) useChats.getState().newChat();
          },
        },
        { icon: Trash2, label: t('common.delete'), danger: true, run: () => confirmDelete(menuFor) },
      ]
    : [];

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 }}>
        <Brand size={22} />
      </View>

      <View style={{ paddingHorizontal: 12, gap: 10, paddingBottom: 8 }}>
        <Press
          haptics={false}
          onPress={newChat}
          style={{ height: 46, borderRadius: radius.md, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Plus size={18} color={c.onAccent} strokeWidth={2.4} />
          <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.onAccent }}>{t('sidebar.newChat')}</RNText>
        </Press>
        <View style={{ height: 42, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
          <Search size={16} color={c.text3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('sidebar.search')}
            placeholderTextColor={c.text3}
            style={{ flex: 1, fontFamily: fonts.sans, fontSize: 14.5, color: c.text, paddingVertical: 0 }}
            cursorColor={c.accent}
            selectionColor={c.accentSoft}
            returnKeyType="search"
          />
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(x) => x.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 12 }}
        renderSectionHeader={({ section }) => (
          <RNText style={[type.label, { color: c.text3, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 6 }]}>
            {section.key === 'archived' ? t('sidebar.archived') : t(`sidebar.group.${section.key}` as 'sidebar.group.today')}
          </RNText>
        )}
        renderItem={({ item }) => <ChatRow chat={item} active={item.id === activeId} onOpen={open} onMenu={setMenuFor} />}
        ListEmptyComponent={
          loaded ? (
            <View style={{ padding: 28, alignItems: 'center', gap: 4 }}>
              <RNText style={[type.body, { color: c.text2 }]}>{q ? t('sidebar.noResults') : t('sidebar.empty')}</RNText>
              {!q && <RNText style={[type.small, { color: c.text3, textAlign: 'center' }]}>{t('sidebar.emptyHint')}</RNText>}
            </View>
          ) : undefined
        }
        ListFooterComponent={
          !q ? (
            <Press
              scale={0.98}
              onPress={() => {
                haptic.select();
                if (!showArchived && archived === null) void useChats.getState().loadArchived();
                setShowArchived((v) => !v);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, height: 44, marginTop: 6 }}
            >
              {showArchived ? <ChevronUp size={15} color={c.text3} /> : <ChevronDown size={15} color={c.text3} />}
              <RNText style={[type.small, { color: c.text3 }]}>{showArchived ? t('sidebar.hideArchived') : t('sidebar.showArchived')}</RNText>
            </Press>
          ) : undefined
        }
      />

      <Press
        scale={0.99}
        onPress={() => {
          drawer.close();
          router.push('/settings');
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          borderTopWidth: 1,
          borderTopColor: c.line,
        }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface3, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 13, color: c.text }}>{user && !user.isGuest ? initials(user.displayName) : '?'}</RNText>
        </View>
        <View style={{ flex: 1 }}>
          <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14.5, color: c.text }}>
            {user ? user.displayName : ''}
          </RNText>
          <RNText numberOfLines={1} style={[type.small, { color: user?.isGuest ? c.accent : c.text3 }]}>
            {user ? (user.isGuest ? t('limits.upgrade') : t(`tier.${user.tier}` as 'tier.guest')) : ''}
          </RNText>
        </View>
        <Settings size={18} color={c.text2} />
      </Press>

      <Sheet visible={Boolean(menuFor)} onClose={() => setMenuFor(null)}>
        {menuFor && (
          <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
            <RNText numberOfLines={1} style={[type.label, { color: c.text3, paddingHorizontal: 12, paddingBottom: 8 }]}>
              {menuFor.title}
            </RNText>
            {menuItems.map((it, i) => (
              <Press
                key={i}
                scale={0.985}
                disabled={it.disabled}
                haptics="tap"
                onPress={() => {
                  setMenuFor(null);
                  void it.run();
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 52, paddingHorizontal: 12, borderRadius: radius.md, opacity: it.disabled ? 0.4 : 1 }}
              >
                <it.icon size={19} color={it.danger ? c.danger : c.text2} />
                <RNText style={[type.body, { color: it.danger ? c.danger : c.text }]}>{it.label}</RNText>
              </Press>
            ))}
          </View>
        )}
      </Sheet>
      <RenameDialog chat={renaming} onClose={() => setRenaming(null)} />
    </View>
  );
}
