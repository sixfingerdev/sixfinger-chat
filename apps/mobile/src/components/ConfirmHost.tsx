import { useRef } from 'react';
import { Text as RNText, View } from 'react-native';
import { Trash2, TriangleAlert } from 'lucide-react-native';
import { fonts, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { haptic } from '../lib/haptics.ts';
import { useUi, type ConfirmRequest } from '../store/ui.ts';
import { Sheet } from './Sheet.tsx';
import { Press } from './Ui.tsx';

/** Silme gibi geri alınamaz işlemler için uygulama içi onay paneli (alttan açılır, uygulamanın diliyle). */
export function ConfirmHost() {
  const { c } = useTheme();
  const req = useUi((s) => s.confirmReq);
  // Kapanış animasyonu sürerken içerik kaybolmasın.
  const shown = useRef<ConfirmRequest | null>(null);
  if (req) shown.current = req;
  const r = req ?? shown.current;
  const close = () => useUi.getState().closeConfirm();
  const Icon = r?.destructive ? Trash2 : TriangleAlert;
  const tone = r?.destructive ? c.danger : c.text;

  return (
    <Sheet visible={Boolean(req)} onClose={close}>
      {r && (
        <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 6, gap: 14 }}>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: r.destructive ? c.dangerSoft : c.surface2 }}>
              <Icon size={24} color={tone} />
            </View>
            <RNText style={[type.body, { color: c.text, fontFamily: fonts.sansSemibold, fontSize: 18, textAlign: 'center' }]}>{r.title}</RNText>
            {!!r.message && (
              <RNText numberOfLines={3} style={[type.body, { color: c.text2, textAlign: 'center' }]}>
                {r.message}
              </RNText>
            )}
          </View>
          <View style={{ gap: 10, marginTop: 4 }}>
            <Press
              haptics="tap"
              scale={0.97}
              onPress={() => {
                haptic.warn();
                close();
                r.onConfirm();
              }}
              style={{ height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: r.destructive ? c.danger : c.inverse }}
            >
              <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 16, color: r.destructive ? '#ffffff' : c.onInverse }}>{r.confirmLabel}</RNText>
            </Press>
            <Press haptics="tap" scale={0.97} onPress={close} style={{ height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}>
              <RNText style={{ fontFamily: fonts.sansSemibold, fontSize: 16, color: c.text }}>{r.cancelLabel}</RNText>
            </Press>
          </View>
        </View>
      )}
    </Sheet>
  );
}
