import { useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { useT } from '../../lib/i18n/index.ts';
import { ApiError, api } from '../../lib/api.ts';
import { useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { useUi } from '../../store/ui.ts';
import { Field } from '../Field.tsx';
import { Sheet } from '../Sheet.tsx';
import { Button } from '../Ui.tsx';

/** GitHub adresi ya da paylaşım bağlantısı/kodu ile skill al (çakışmada onayla ve üzerine yaz). */
export function ImportSkillSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (n: number) => void }) {
  const { c } = useTheme();
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (overwrite: boolean): Promise<void> => {
    const v = text.trim();
    // Paylaşım bağlantısı (…?import=KOD) ya da çıplak kod: GitHub adresi değil.
    const token = /[?&]import=([\w-]+)/.exec(v)?.[1] ?? (/^[\w-]{20,}$/.test(v) ? v : null);
    setBusy(true);
    setError('');
    try {
      if (token) {
        await api.codeImportShared(token, overwrite);
        onDone(1);
      } else {
        onDone((await api.codeImportSkill(v, overwrite)).imported.length);
      }
      setText('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !overwrite) {
        useUi.getState().askConfirm({
          title: t('code.skills.import'),
          message: t('code.skills.importConflict'),
          confirmLabel: t('common.save'),
          cancelLabel: t('common.cancel'),
          onConfirm: () => void run(true),
        });
      } else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 18, gap: 14 }}>
        <RNText style={[type.heading as never, { color: c.text }]}>{t('code.skills.importTitle')}</RNText>
        <Field value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} placeholder="https://github.com/sahip/depo/tree/main/skills/ad" hint={t('code.skills.importHint')} error={Boolean(error)} />
        {!!error && <RNText style={[type.small, { color: c.danger }]}>{error}</RNText>}
        <Button label={t('code.skills.import')} loading={busy} disabled={text.trim().length < 3} onPress={() => void run(false)} />
      </View>
    </Sheet>
  );
}
