import { memo, useState, type ReactNode, isValidElement, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { normalizeMath } from '../lib/markdown-prep.ts';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import 'katex/dist/katex.min.css';

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

function CodeBlock({ children }: ComponentPropsWithoutRef<'pre'>) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const code = isValidElement(children) ? (children as React.ReactElement<{ className?: string; children?: ReactNode }>) : null;
  const lang = /language-([\w+#-]+)/.exec(code?.props.className ?? '')?.[1] ?? '';
  const raw = textOf(code?.props.children ?? children).replace(/\n$/, '');

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{lang || 'text'}</span>
        <button
          className="codeblock-copy"
          onClick={async () => {
            if (await copyText(raw)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_600);
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t('msg.codeCopied') : t('msg.codeCopy')}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: CodeBlock,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  // Dış görseller izleme riski taşır; bağlantı olarak göster.
  img: ({ src, alt }) => (
    <a href={src} target="_blank" rel="noopener noreferrer nofollow">
      {alt || src}
    </a>
  ),
};

const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]] as never;
// Model çıktısındaki ham HTML'den yalnızca güvenli alt küme (br, b, i, sub, sup, details...) geçer.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-[\w+#-]+$/]],
  },
};
const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema], rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]] as never;

const MarkdownInner = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownInner;
