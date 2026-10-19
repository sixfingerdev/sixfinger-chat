import { memo, useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import { Check, ChevronRight, CircleAlert, CircleDashed, FileMinus, FilePen, FilePlus, FileText, Globe, GitCommitHorizontal, HardDrive, Layers, Search, Terminal, Wrench } from 'lucide-react-native';
import { describeTool, type MessageDTO, type MessagePartDTO } from '@sixfinger/shared';
import { fonts, radius, useTheme } from '../../theme/index.tsx';
import { type } from '../../theme/type.ts';
import { useLocale, useT } from '../../lib/i18n/index.ts';
import { useChats } from '../../store/chats.ts';
import { RichText } from '../RichText.tsx';
import { Sheet } from '../Sheet.tsx';
import { ToolCard } from '../ToolCard.tsx';
import { Press } from '../Ui.tsx';

export type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;

/** Alt sayfada gösterilecek şey. Parçalar canlı güncellendiği için kimliklerle tutulur. */
export type SheetTarget = { kind: 'group'; ids: string[] } | { kind: 'file'; id: string } | { kind: 'output'; id: string };

/** Ardışık olunca tek satırda toplanan "komut/okuma/arama" araçları. */
const GROUPED = new Set(['bash', 'read', 'glob', 'grep', 'web_search', 'web_fetch']);
const SEARCH_ICON = { web_search: Search, web_fetch: Globe, bash: Terminal, read: FileText, glob: Search, grep: Search } as const;

type Block = { kind: 'text'; text: string; key: string } | { kind: 'group'; parts: ToolPart[]; key: string } | { kind: 'tool'; part: ToolPart; key: string };

function toBlocks(parts: MessagePartDTO[]): Block[] {
  const out: Block[] = [];
  parts.forEach((p, i) => {
    if (p.type === 'text') {
      if (p.text) out.push({ kind: 'text', text: p.text, key: `t${i}` });
    } else if (p.type === 'tool') {
      const last = out[out.length - 1];
      if (GROUPED.has(p.name)) {
        if (last?.kind === 'group') last.parts.push(p);
        else out.push({ kind: 'group', parts: [p], key: `g${p.id}` });
      } else {
        out.push({ kind: 'tool', part: p, key: p.id });
      }
    }
  });
  return out;
}

const meta = (p: ToolPart) => (p.meta ?? {}) as Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function Counts({ add, del }: { add: number; del: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.success }}>+{add}</RNText>
      <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text2 }}>−{del}</RNText>
    </View>
  );
}

/** "3 komut çalıştı · 2 dosya okundu" satırı; dokununca komutların listesi açılır. */
function GroupRow({ parts, onOpen }: { parts: ToolPart[]; onOpen: (t: SheetTarget) => void }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const cmds = parts.filter((p) => p.name === 'bash').length;
  const reads = parts.filter((p) => p.name === 'read').length;
  const searches = parts.length - cmds - reads;
  const label = [cmds && t('code.group.cmds', { n: cmds }), reads && t('code.group.reads', { n: reads }), searches && t('code.group.searches', { n: searches })]
    .filter(Boolean)
    .join(' · ');
  const running = parts.find((p) => p.status === 'running');
  const Icon = SEARCH_ICON[(running ?? parts[parts.length - 1]!).name as keyof typeof SEARCH_ICON] ?? Wrench;
  return (
    <Press
      haptics="select"
      scale={0.985}
      onPress={() => onOpen({ kind: 'group', ids: parts.map((p) => p.id) })}
      style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
    >
      <Icon size={15} color={c.text3} />
      <RNText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 14, color: running ? c.text : c.text2 }}>
        {label}
      </RNText>
      {running && (
        <>
          <ActivityIndicator size="small" color={c.text2} />
          <RNText numberOfLines={1} style={[type.small, { flex: 1, color: c.text3 }]}>
            {describeTool(running, locale).detail}
          </RNText>
        </>
      )}
      <ChevronRight size={14} color={c.text3} />
    </Press>
  );
}

/** Dosya değişiklik çipi: dosya adı, durum ve +N −M. */
function FileChip({ part, onOpen }: { part: ToolPart; onOpen: (t: SheetTarget) => void }) {
  const { c } = useTheme();
  const t = useT();
  const file = (Array.isArray(meta(part).files) ? (meta(part).files as Array<Record<string, unknown>>)[0] : undefined) ?? {};
  const path = str(part.args.path) || str(file.path);
  const name = path.split('/').pop() || path;
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const status = str(file.status) || (part.name === 'write' ? 'added' : 'modified');
  const Icon = failed ? CircleAlert : status === 'added' ? FilePlus : status === 'deleted' ? FileMinus : FilePen;
  return (
    <Press
      haptics="select"
      scale={0.985}
      disabled={running}
      onPress={() => onOpen({ kind: 'file', id: part.id })}
      style={{ marginVertical: 5, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}
    >
      {running ? <ActivityIndicator size="small" color={c.text2} /> : <Icon size={16} color={failed ? c.text2 : c.text} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>
          {name}
        </RNText>
        <RNText numberOfLines={1} style={[type.small, { fontSize: 12, color: c.text3 }]}>
          {failed ? part.summary || t('tool.failed') : path === name ? t(`code.file.${status}` as 'code.file.added') : path}
        </RNText>
      </View>
      {!running && !failed && <Counts add={num(file.additions)} del={num(file.deletions)} />}
    </Press>
  );
}

const TODO_ICON = { completed: Check, in_progress: CircleDashed, pending: CircleDashed } as const;

function TodoCard({ part }: { part: ToolPart }) {
  const { c } = useTheme();
  const t = useT();
  const todos = (Array.isArray(meta(part).todos) ? meta(part).todos : []) as Array<{ content: string; status: keyof typeof TODO_ICON }>;
  if (!todos.length) return null;
  const done = todos.filter((x) => x.status === 'completed').length;
  return (
    <View style={{ marginVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <RNText style={[type.label, { color: c.text3 }]}>{t('code.todo.title')}</RNText>
        <RNText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>{t('code.todo.progress', { done, total: todos.length })}</RNText>
      </View>
      {todos.map((x, i) => {
        const Icon = TODO_ICON[x.status] ?? CircleDashed;
        const active = x.status === 'in_progress';
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ marginTop: 2 }}>
              <Icon size={15} color={x.status === 'completed' ? c.text2 : active ? c.text : c.text3} />
            </View>
            <RNText style={{ flex: 1, fontFamily: active ? fonts.sansMedium : fonts.sans, fontSize: 14, lineHeight: 20, color: active ? c.text : c.text2, textDecorationLine: x.status === 'completed' ? 'line-through' : 'none' }}>
              {x.content}
            </RNText>
          </View>
        );
      })}
    </View>
  );
}

function WorkspaceRow({ part, onOpen }: { part: ToolPart; onOpen: (t: SheetTarget) => void }) {
  const { c } = useTheme();
  const t = useT();
  const running = part.status === 'running';
  const failed = part.status === 'error';
  return (
    <Press
      haptics={part.output ? 'select' : false}
      scale={0.985}
      disabled={!part.output}
      onPress={() => onOpen({ kind: 'output', id: part.id })}
      style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}
    >
      {running ? <ActivityIndicator size="small" color={c.text2} /> : failed ? <CircleAlert size={15} color={c.text2} /> : <HardDrive size={15} color={c.text3} />}
      <RNText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 14, color: running ? c.text : c.text2 }}>
        {running ? `${t('code.ws.running')}…` : failed ? part.summary || t('tool.failed') : `${t('code.ws.done')} · ${part.summary ?? ''}`}
      </RNText>
      {!!part.output && <ChevronRight size={14} color={c.text3} />}
    </Press>
  );
}

/** 60300 → "60.3k" */
const compact = (n: number) => (n < 1_000 ? String(Math.round(n)) : n < 100_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k` : n < 1_000_000 ? `${Math.round(n / 1_000)}k` : `${(n / 1_000_000).toFixed(1)}M`);

/** Bağlam özetlendi satırı; dokununca özet metni açılır. */
function CompactionRow({ part, onOpen }: { part: ToolPart; onOpen: (t: SheetTarget) => void }) {
  const { c } = useTheme();
  const t = useT();
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const m = meta(part);
  const canOpen = !running && !failed && Boolean(part.output);
  return (
    <Press haptics={canOpen ? 'select' : false} scale={0.985} disabled={!canOpen} onPress={() => onOpen({ kind: 'output', id: part.id })} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      {running ? <ActivityIndicator size="small" color={c.text2} /> : failed ? <CircleAlert size={15} color={c.text2} /> : <Layers size={15} color={c.text3} />}
      <RNText numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 14, color: running ? c.text : c.text2 }}>
        {running ? `${t('code.compact.running')}…` : failed ? t('code.compact.failed') : `${t('code.compact.done')}${num(m.before) > 0 ? ` · ${t('code.compact.tokens', { before: compact(num(m.before)), after: compact(num(m.after)) })}` : ''}`}
      </RNText>
      {canOpen && <ChevronRight size={14} color={c.text3} />}
    </Press>
  );
}

function CommitRow({ part, onOpen }: { part: ToolPart; onOpen: (t: SheetTarget) => void }) {
  const { c } = useTheme();
  const t = useT();
  const m = meta(part);
  const sha = str(m.sha).slice(0, 7) || part.summary || '';
  return (
    <Press
      haptics="select"
      scale={0.985}
      onPress={() => onOpen({ kind: 'output', id: part.id })}
      style={{ marginVertical: 5, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}
    >
      <GitCommitHorizontal size={17} color={c.text} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>
          {str(m.subject) || str(part.args.message)}
        </RNText>
        <RNText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12, color: c.text3 }}>
          {sha}
          {num(m.files) ? ` · ${t('code.pr.files', { n: num(m.files) })}` : ''}
        </RNText>
      </View>
      {num(m.additions) + num(m.deletions) > 0 && <Counts add={num(m.additions)} del={num(m.deletions)} />}
    </Press>
  );
}

/** Asistan mesajının (düşünce parçaları arasındaki) bir dilimi: metin, gruplanmış komutlar, dosya çipleri, görev listesi. */
export const CodeSegment = memo(function CodeSegment({ parts, lastTodoId, onOpen }: { parts: MessagePartDTO[]; lastTodoId: string | null; onOpen: (t: SheetTarget) => void }) {
  const blocks = useMemo(() => toBlocks(parts), [parts]);
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 2 }}>
      {blocks.map((b) => {
        if (b.kind === 'text') return <RichText key={b.key} text={b.text} />;
        if (b.kind === 'group') return <GroupRow key={b.key} parts={b.parts} onOpen={onOpen} />;
        const p = b.part;
        switch (p.name) {
          case 'edit':
          case 'write':
            return <FileChip key={b.key} part={p} onOpen={onOpen} />;
          case 'todo':
            return p.id === lastTodoId ? <TodoCard key={b.key} part={p} /> : null;
          case 'workspace':
            return <WorkspaceRow key={b.key} part={p} onOpen={onOpen} />;
          case 'commit':
            return <CommitRow key={b.key} part={p} onOpen={onOpen} />;
          case 'compaction':
            return <CompactionRow key={b.key} part={p} onOpen={onOpen} />;
          default:
            return <ToolCard key={b.key} part={p} />;
        }
      })}
    </View>
  );
});

/** Mesajdaki son görev listesi parçasının kimliği (öncekiler gizlenir; kart hep güncel listeyi gösterir). */
export function lastTodoOf(m: MessageDTO): string | null {
  const todos = (m.parts ?? []).filter((p): p is ToolPart => p.type === 'tool' && p.name === 'todo');
  return todos[todos.length - 1]?.id ?? null;
}

// ------------------------------------------------------------------------------------------------ alt sayfalar

const cap = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}\n…` : (s ?? ''));

function Mono({ children, color }: { children: string; color?: string }) {
  const { c } = useTheme();
  return (
    <RNText selectable style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 17, color: color ?? c.text2 }}>
      {children}
    </RNText>
  );
}

function Block({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return <View style={{ backgroundColor: c.codeBg, borderRadius: radius.sm, borderWidth: 1, borderColor: c.line, padding: 10 }}>{children}</View>;
}

function CommandItem({ part }: { part: ToolPart }) {
  const { c } = useTheme();
  const t = useT();
  const locale = useLocale();
  const m = meta(part);
  const running = part.status === 'running';
  const failed = part.status === 'error';
  const isBash = part.name === 'bash';
  const d = describeTool(part, locale);
  const title = isBash ? str(m.command) || str(part.args.command) : `${d.label} ${d.detail}`.trim();
  const exit = typeof m.exitCode === 'number' ? m.exitCode : null;
  const notes = [m.timedOut ? t('code.cmd.timeout') : '', m.background ? t('code.cmd.background') : '', exit !== null && exit !== 0 ? t('code.cmd.exit', { code: exit }) : ''].filter(Boolean);
  // Model çıktısı komutu "$ ..." satırıyla yineler; başlıkta zaten var.
  const out = isBash ? (part.output ?? '').replace(/^\$ [^\n]*\n?/, '') : (part.output ?? '');
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ marginTop: 2 }}>{running ? <ActivityIndicator size="small" color={c.text2} /> : failed ? <CircleAlert size={15} color={c.text2} /> : <Check size={15} color={c.text3} />}</View>
        <RNText selectable numberOfLines={6} style={{ flex: 1, fontFamily: isBash ? fonts.mono : fonts.sansMedium, fontSize: isBash ? 12.5 : 14, lineHeight: 19, color: c.text }}>
          {isBash ? `$ ${title}` : title}
        </RNText>
      </View>
      {notes.length > 0 && (
        <RNText style={{ marginLeft: 23, fontFamily: fonts.mono, fontSize: 11.5, color: c.text3 }}>{notes.join(' · ')}</RNText>
      )}
      {!running && (
        <View style={{ marginLeft: 23 }}>
          <Block>
            <Mono>{out ? cap(out, 3_000) : t('code.cmd.noOutput')}</Mono>
          </Block>
        </View>
      )}
    </View>
  );
}

function FileDetail({ part }: { part: ToolPart }) {
  const { c } = useTheme();
  const t = useT();
  const file = (Array.isArray(meta(part).files) ? (meta(part).files as Array<Record<string, unknown>>)[0] : undefined) ?? {};
  const a = part.args;
  const pick = (...keys: string[]) => keys.map((k) => a[k]).find((v) => typeof v === 'string') as string | undefined;
  const path = str(a.path) || str(file.path);
  const status = str(file.status) || (part.name === 'write' ? 'added' : 'modified');
  const oldText = part.name === 'edit' ? pick('old_string', 'oldString', 'old_str', 'old', 'search', 'old_text') : undefined;
  const newText = part.name === 'edit' ? pick('new_string', 'newString', 'new_str', 'new', 'replace', 'new_text') : pick('content');
  const lines = (txt: string | undefined, sign: '+' | '−') => (txt ? cap(txt.replace(/\n$/, ''), 6_000).split('\n').map((l) => `${sign} ${l}`) : []);
  const removed = lines(oldText, '−');
  const added = lines(newText, '+');
  return (
    <View style={{ gap: 12 }}>
      <View>
        <RNText selectable style={{ fontFamily: fonts.mono, fontSize: 13, color: c.text }}>
          {path}
        </RNText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <RNText style={[type.small, { color: c.text3 }]}>{t(`code.file.${status}` as 'code.file.added')}</RNText>
          {part.status !== 'error' && <Counts add={num(file.additions)} del={num(file.deletions)} />}
        </View>
      </View>
      {part.status === 'error' && (
        <Block>
          <Mono>{cap(part.output, 2_000)}</Mono>
        </Block>
      )}
      {part.status !== 'error' && (removed.length > 0 || added.length > 0) && (
        <Block>
          {removed.map((l, i) => (
            <RNText key={`r${i}`} selectable style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 17, color: c.text2, backgroundColor: c.dangerSoft }}>
              {l}
            </RNText>
          ))}
          {added.map((l, i) => (
            <RNText key={`a${i}`} selectable style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 17, color: c.text, backgroundColor: `${c.success}22` }}>
              {l}
            </RNText>
          ))}
        </Block>
      )}
    </View>
  );
}

/** Dokunulan satırın ayrıntı sayfası (komutlar, dosya farkı, çalışma alanı/commit çıktısı). */
export function CodeSheetHost({ chatId, target, onClose }: { chatId: string; target: SheetTarget | null; onClose: () => void }) {
  const { c } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const messages = useChats((s) => s.detail[chatId]?.messages);
  // Son hâli koru: sayfa kapanırken içerik boşalıp zıplamasın.
  const parts = useMemo(() => {
    const map = new Map<string, ToolPart>();
    for (const m of messages ?? []) for (const p of m.parts ?? []) if (p.type === 'tool') map.set(p.id, p);
    return map;
  }, [messages]);

  const shown = target;
  let title = '';
  let body: React.ReactNode = null;
  if (shown?.kind === 'group') {
    const list = shown.ids.map((id) => parts.get(id)).filter((p): p is ToolPart => Boolean(p));
    title = t('code.cmd.command');
    body = (
      <View style={{ gap: 18 }}>
        {list.map((p) => (
          <CommandItem key={p.id} part={p} />
        ))}
      </View>
    );
  } else if (shown?.kind === 'file') {
    const p = parts.get(shown.id);
    title = t('code.changes');
    body = p ? <FileDetail part={p} /> : null;
  } else if (shown?.kind === 'output') {
    const p = parts.get(shown.id);
    title = p?.name === 'commit' ? t('code.commit.title') : p?.name === 'compaction' ? t('code.compact.done') : t('code.ws.done');
    body = p ? (
      <Block>
        <Mono>{cap(p.output, 4_000) || t('code.cmd.noOutput')}</Mono>
      </Block>
    ) : null;
  }

  return (
    <Sheet visible={Boolean(target)} onClose={onClose}>
      <RNText style={[type.label, { color: c.text3, paddingHorizontal: 22, paddingBottom: 10 }]}>{title}</RNText>
      <ScrollView style={{ maxHeight: height * 0.62 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    </Sheet>
  );
}
