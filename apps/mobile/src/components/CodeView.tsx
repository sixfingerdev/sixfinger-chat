import { memo, useMemo } from 'react';
import { FlatList, Text as RNText, View } from 'react-native';
import { fonts, useTheme } from '../theme/index.tsx';
import { type } from '../theme/type.ts';
import { useT } from '../lib/i18n/index.ts';
import { highlightCode } from './markdown/highlight.ts';

const CHUNK = 40;
const TAIL = 60;

const mono = { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18 } as const;

const CodeChunk = memo(function CodeChunk({ text, lang }: { text: string; lang: string }) {
  const { c } = useTheme();
  const lines = useMemo(() => highlightCode(text, lang, c.hl), [text, lang, c.hl]);
  return (
    <RNText selectable style={[mono, { color: c.text, paddingHorizontal: 14 }]}>
      {lines.map((line, i) => (
        <RNText key={i}>
          {line.map((tok, j) => (
            <RNText key={j} style={tok.color ? { color: tok.color } : undefined}>
              {tok.text}
            </RNText>
          ))}
          {i < lines.length - 1 ? '\n' : ''}
        </RNText>
      ))}
    </RNText>
  );
});

/**
 * Büyük kodu donmadan gösterir. Bitmiş kod 40'ar satırlık parçalara bölünür ve sanallaştırılır (ekrandakiler çizilir,
 * renklendirme yalnızca onlar için çalışır). Yazılırken yalnızca son satırlar basit metin olarak gösterilir:
 * maliyet kodun boyuna bağlı değildir.
 */
export function CodeView({ code, lang, writing, bottomInset }: { code: string; lang: string; writing: boolean; bottomInset: number }) {
  const { c } = useTheme();
  const t = useT();
  const all = useMemo(() => code.split('\n'), [code]);
  const chunks = useMemo(() => {
    if (writing) return [];
    const out: string[] = [];
    for (let i = 0; i < all.length; i += CHUNK) out.push(all.slice(i, i + CHUNK).join('\n'));
    return out;
  }, [all, writing]);

  if (!code) return <RNText style={[type.body, { color: c.text3, padding: 16 }]}>{t('artifact.empty')}</RNText>;

  if (writing) {
    const tail = all.slice(-TAIL).join('\n');
    return (
      <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 4 }}>
        <RNText style={[type.small, { color: c.text3, marginBottom: 8 }]}>{t('artifact.lines', { n: all.length })}</RNText>
        <RNText style={[mono, { color: c.text2 }]}>{tail}</RNText>
      </View>
    );
  }
  return (
    <FlatList
      data={chunks}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item }) => <CodeChunk text={item} lang={lang} />}
      initialNumToRender={5}
      maxToRenderPerBatch={4}
      windowSize={5}
      removeClippedSubviews
      contentContainerStyle={{ paddingTop: 4, paddingBottom: bottomInset + 24 }}
    />
  );
}
