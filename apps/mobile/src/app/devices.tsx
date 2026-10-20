import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text as RNText, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Laptop, Trash2 } from 'lucide-react-native';
import { fonts, radius, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import type { LinkDevice, LinkSession } from '../lib/link.ts';
import { useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { Button, Press } from '../components/Ui.tsx';
import { CodeHeader } from '../components/code/CodeUi.tsx';

/** Cihazlarım: kendi bilgisayarında çalışan SixFinger Code oturumları (CLI `sixfinger link`). */
export default function Devices() {
  const { c } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const guest = useAuth((s) => s.user?.isGuest ?? false);
  const [devices, setDevices] = useState<LinkDevice[] | null>(null);
  const [sessions, setSessions] = useState<LinkSession[]>([]);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newFor, setNewFor] = useState<string | null>(null);
  const [dir, setDir] = useState('');
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api.linkDevices(), api.linkSessions()]);
      setDevices(d.devices);
      setSessions(s.sessions);
      setFailed(false);
    } catch (err) {
      setFailed(true);
      reportError(err);
    }
  }, []);

  useEffect(() => {
    if (guest) return;
    void load();
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, [guest, load]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const input = { borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: c.text, backgroundColor: c.surface, fontFamily: fonts.sans, fontSize: 15 } as const;

  let body;
  if (guest) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16, paddingBottom: 60 }}>
        <RNText style={[type.body, { color: c.text2, textAlign: 'center' }]}>{t('link.guest')}</RNText>
        <Button label={t('limits.upgrade')} onPress={() => router.push({ pathname: '/auth', params: { mode: 'register' } })} />
      </View>
    );
  } else if (!devices) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {failed ? <Button label={t('common.retry')} variant="secondary" onPress={() => void load()} /> : <ActivityIndicator color={c.text3} />}
      </View>
    );
  } else {
    body = (
      <FlatList
        data={devices}
        keyExtractor={(d) => d.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={c.text3} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 28, gap: 18 }}
        ListHeaderComponent={<RNText style={[type.small, { color: c.text3 }]}>{t('link.subtitle')}</RNText>}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 12, paddingTop: 40 }}>
            <Laptop size={30} color={c.text3} />
            <RNText style={[type.body, { color: c.text2, textAlign: 'center' }]}>{t('link.empty')}</RNText>
            <RNText selectable style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>sixfinger link</RNText>
          </View>
        }
        renderItem={({ item: d }) => (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.online ? c.text : c.text3 }} />
              <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.text, flexShrink: 1 }} numberOfLines={1}>
                {d.name}
              </RNText>
              <RNText style={[type.small, { color: c.text3, flex: 1 }]} numberOfLines={1}>
                {d.online ? t('link.online') : t('link.offline')} · {d.platform}
              </RNText>
              <Press
                accessibilityLabel={t('link.remove')}
                onPress={() => api.linkDeviceDelete(d.id).then(load, reportError)}
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <Trash2 size={16} color={c.text3} />
              </Press>
            </View>
            {d.online && d.capabilities?.includes('new_session') &&
              (newFor === d.id ? (
                <View style={{ gap: 8 }}>
                  <TextInput value={dir} onChangeText={setDir} placeholder={t('link.newDir')} placeholderTextColor={c.text3} autoCapitalize="none" autoCorrect={false} style={input} />
                  <TextInput value={text} onChangeText={setText} placeholder={t('link.newText')} placeholderTextColor={c.text3} multiline style={[input, { minHeight: 64, textAlignVertical: 'top' }]} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      label={t('link.newStart')}
                      onPress={() =>
                        api
                          .linkNewSession(d.id, { directory: dir.trim() || undefined, text: text.trim() || undefined })
                          .then(() => {
                            setNewFor(null);
                            setDir('');
                            setText('');
                            setTimeout(() => void load(), 1500);
                          }, reportError)
                      }
                    />
                    <Button label={t('link.newCancel')} variant="secondary" onPress={() => setNewFor(null)} />
                  </View>
                </View>
              ) : (
                <Button label={t('link.new')} variant="secondary" onPress={() => setNewFor(d.id)} />
              ))}
            {sessions
              .filter((s) => s.deviceId === d.id)
              .map((s) => (
                <Press
                  key={s.id}
                  haptics="tap"
                  scale={0.985}
                  onPress={() => router.push({ pathname: '/device-session', params: { deviceId: s.deviceId, id: s.id } } as never)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <RNText numberOfLines={1} style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: c.text }}>
                      {s.title || t('code.session.untitled')}
                      {s.status === 'waiting' ? `  · ${t('link.waiting')}` : s.status === 'busy' ? '  · …' : ''}
                    </RNText>
                    <RNText numberOfLines={1} style={[type.small, { color: c.text3 }]}>
                      {s.directory}
                    </RNText>
                  </View>
                  <ChevronRight size={16} color={c.text3} />
                </Press>
              ))}
            {d.sessions === 0 && <RNText style={[type.small, { color: c.text3 }]}>{t('link.noSessions')}</RNText>}
          </View>
        )}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <CodeHeader title={t('link.title')} onBack={back} />
      {body}
    </View>
  );
}
