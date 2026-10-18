import { memo, useMemo, useState, type ReactNode } from 'react';
import { Linking, ScrollView, Text as RNText, View, type TextStyle } from 'react-native';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root, RootContent, PhrasingContent, TableRow, ListItem } from 'mdast';
import { Check, Copy } from 'lucide-react-native';
import { fonts, radius, useTheme, type Palette } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { copyText } from '../../lib/format.ts';
import { useT } from '../../lib/i18n/index.ts';
import { normalizeMath } from '../../lib/markdown-prep.ts';
import { haptic } from '../../lib/haptics.ts';
import { Press } from '../Ui.tsx';
import { highlightCode } from './highlight.ts';
import { latexToText } from './latex.ts';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: true });

/** Model çıktısındaki sık ham HTML parçalarını düz metne çevirir (<br> → satır sonu, diğer etiketler atılır). */
function htmlToText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

interface Ctx {
  c: Palette;
  t: ReturnType<typeof useT>;
}

// ---------- Satır içi ----------
function Inline({ nodes, ctx, base }: { nodes: PhrasingContent[]; ctx: Ctx; base?: TextStyle }): ReactNode {
  const { c } = ctx;
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return n.value;
      case 'strong':
        return (
          <RNText key={i} style={{ fontFamily: fonts.sansSemibold }}>
            <Inline nodes={n.children} ctx={ctx} base={base} />
          </RNText>
        );
      case 'emphasis':
        return (
          <RNText key={i} style={{ fontStyle: 'italic' }}>
            <Inline nodes={n.children} ctx={ctx} base={base} />
          </RNText>
        );
      case 'delete':
        return (
          <RNText key={i} style={{ textDecorationLine: 'line-through', color: c.text2 }}>
            <Inline nodes={n.children} ctx={ctx} base={base} />
          </RNText>
        );
      case 'inlineCode':
        return (
          <RNText key={i} style={{ fontFamily: fonts.mono, fontSize: 13.5, color: c.text, backgroundColor: c.surface3 }}>
            {` ${n.value} `}
          </RNText>
        );
      case 'link':
        return (
          <RNText
            key={i}
            style={{ color: c.accent, textDecorationLine: 'underline', textDecorationColor: c.accentSoft }}
            onPress={() => void Linking.openURL(n.url).catch(() => {})}
          >
            <Inline nodes={n.children} ctx={ctx} base={base} />
          </RNText>
        );
      case 'break':
        return '\n';
      case 'html':
        return htmlToText(n.value);
      case 'image':
        return (
          <RNText key={i} style={{ color: c.accent }} onPress={() => void Linking.openURL(n.url).catch(() => {})}>
            {n.alt || n.url}
          </RNText>
        );
      default: {
        const math = n as unknown as { type: string; value?: string };
        if (math.type === 'inlineMath') {
          return (
            <RNText key={i} style={{ fontStyle: 'italic', color: c.text }}>
              {latexToText(math.value ?? '')}
            </RNText>
          );
        }
        return null;
      }
    }
  });
}

// ---------- Kod bloğu ----------
function CodeBlock({ code, lang, ctx }: { code: string; lang: string; ctx: Ctx }) {
  const { c, t } = ctx;
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => highlightCode(code, lang, c.hl), [code, lang, c.hl]);
  return (
    <View style={{ backgroundColor: c.codeBg, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, overflow: 'hidden', marginVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.codeHead, paddingLeft: 14, paddingRight: 6, height: 38 }}>
        <RNText style={[type.label, { color: c.text3 }]}>{lang || 'text'}</RNText>
        <Press
          haptics="tap"
          scale={0.94}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: radius.sm }}
          onPress={async () => {
            if (await copyText(code)) {
              haptic.success();
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }
          }}
        >
          {copied ? <Check size={14} color={c.success} /> : <Copy size={14} color={c.text2} />}
          <RNText style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: copied ? c.success : c.text2 }}>
            {copied ? t('msg.codeCopied') : t('msg.codeCopy')}
          </RNText>
        </Press>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 14 }}>
        <RNText selectable style={[type.mono, { color: c.text }]}>
          {lines.map((line, li) => (
            <RNText key={li}>
              {line.map((tok, ti) => (
                <RNText key={ti} style={tok.color ? { color: tok.color } : undefined}>
                  {tok.text}
                </RNText>
              ))}
              {li < lines.length - 1 ? '\n' : ''}
            </RNText>
          ))}
        </RNText>
      </ScrollView>
    </View>
  );
}

// ---------- Tablo ----------
function Table({ rows, align, ctx }: { rows: TableRow[]; align: Array<string | null | undefined>; ctx: Ctx }) {
  const { c } = ctx;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
      <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: radius.sm, overflow: 'hidden' }}>
        {rows.map((row, ri) => (
          <View
            key={ri}
            style={{
              flexDirection: 'row',
              backgroundColor: ri === 0 ? c.surface2 : 'transparent',
              borderTopWidth: ri === 0 ? 0 : 1,
              borderTopColor: c.line,
            }}
          >
            {row.children.map((cell, ci) => (
              <View key={ci} style={{ width: 132, paddingHorizontal: 12, paddingVertical: 9, borderLeftWidth: ci === 0 ? 0 : 1, borderLeftColor: c.line }}>
                <RNText
                  selectable
                  style={[
                    type.small,
                    { color: c.text, textAlign: (align[ci] as TextStyle['textAlign']) ?? 'left', fontFamily: ri === 0 ? fonts.sansSemibold : fonts.sans },
                  ]}
                >
                  <Inline nodes={cell.children} ctx={ctx} />
                </RNText>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ---------- Blok ----------
const HEADING: Record<number, { size: number; line: number }> = {
  1: { size: 22, line: 29 },
  2: { size: 19, line: 26 },
  3: { size: 17, line: 24 },
  4: { size: 15.5, line: 22 },
};

function Block({ node, ctx, tight }: { node: RootContent; ctx: Ctx; tight?: boolean }): ReactNode {
  const { c } = ctx;
  switch (node.type) {
    case 'paragraph':
      return (
        <RNText selectable style={[type.body, { color: c.text, marginVertical: tight ? 0 : 5 }]}>
          <Inline nodes={node.children} ctx={ctx} />
        </RNText>
      );
    case 'heading': {
      const h = HEADING[Math.min(node.depth, 4)]!;
      return (
        <RNText
          selectable
          style={{ fontFamily: fonts.sansSemibold, fontSize: h.size, lineHeight: h.line, color: c.text, letterSpacing: -0.2, marginTop: 14, marginBottom: 4 }}
        >
          <Inline nodes={node.children} ctx={ctx} />
        </RNText>
      );
    }
    case 'code':
      return <CodeBlock code={node.value} lang={node.lang ?? ''} ctx={ctx} />;
    case 'blockquote':
      return (
        <View style={{ flexDirection: 'row', marginVertical: 6, gap: 12 }}>
          <View style={{ width: 3, borderRadius: 1, backgroundColor: c.accent, transform: [{ skewX: '-16deg' }] }} />
          <View style={{ flex: 1 }}>
            {node.children.map((ch, i) => (
              <Block key={i} node={ch} ctx={{ ...ctx, c: { ...c, text: c.text2 } }} />
            ))}
          </View>
        </View>
      );
    case 'list':
      return (
        <View style={{ marginVertical: 4, gap: 4 }}>
          {node.children.map((item: ListItem, i) => {
            const marker = item.checked != null ? (item.checked ? '☑' : '☐') : node.ordered ? `${(node.start ?? 1) + i}.` : '•';
            return (
              <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
                <RNText style={[type.body, { color: node.ordered ? c.text2 : c.accent, minWidth: 18, textAlign: 'right', fontFamily: node.ordered ? fonts.mono : fonts.sansSemibold }]}>
                  {marker}
                </RNText>
                <View style={{ flex: 1 }}>
                  {item.children.map((ch, j) => (
                    <Block key={j} node={ch} ctx={ctx} tight={!node.spread && !item.spread} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      );
    case 'thematicBreak':
      return <View style={{ height: 1, backgroundColor: c.line, marginVertical: 14 }} />;
    case 'table':
      return <Table rows={node.children} align={node.align ?? []} ctx={ctx} />;
    case 'html':
      return (
        <RNText selectable style={[type.body, { color: c.text }]}>
          {htmlToText(node.value)}
        </RNText>
      );
    default: {
      const math = node as unknown as { type: string; value?: string };
      if (math.type === 'math') {
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            <View
              style={{
                backgroundColor: c.surface,
                borderWidth: 1,
                borderColor: c.line,
                borderRadius: radius.md,
                paddingHorizontal: 18,
                paddingVertical: 12,
                alignSelf: 'center',
              }}
            >
              <RNText selectable style={{ fontFamily: fonts.sans, fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: c.text, textAlign: 'center' }}>
                {latexToText(math.value ?? '')}
              </RNText>
            </View>
          </ScrollView>
        );
      }
      return null;
    }
  }
}

/** Blok kaynağı değişmediyse yeniden çizilmez — akış sırasında yalnızca son blok güncellenir. */
const BlockView = memo(
  function BlockView({ node, ctx }: { node: RootContent; src: string; ctx: Ctx }) {
    return <Block node={node} ctx={ctx} />;
  },
  (a, b) => a.src === b.src && a.ctx.c === b.ctx.c && a.ctx.t === b.ctx.t,
);

function MarkdownInner({ text }: { text: string }) {
  const { c } = useTheme();
  const t = useT();
  const prepared = useMemo(() => normalizeMath(text), [text]);
  const tree = useMemo(() => processor.runSync(processor.parse(prepared)) as Root, [prepared]);
  const ctx = useMemo<Ctx>(() => ({ c, t }), [c, t]);
  return (
    <View>
      {tree.children.map((node, i) => {
        const start = node.position?.start.offset ?? 0;
        const end = node.position?.end.offset ?? prepared.length;
        return <BlockView key={i} node={node} src={prepared.slice(start, end)} ctx={ctx} />;
      })}
    </View>
  );
}

export const Markdown = memo(MarkdownInner);
