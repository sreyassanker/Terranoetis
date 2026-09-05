import React, { useMemo, type ComponentType, type HTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';

function stripCommands(text: string): string {
  // Split on section headers (## ...), then drop internal COMMANDS /
  // TOOL_CALLS / THINKING blocks. Split on a newline followed by "## " so a
  // block at the very end is removed too (no trailing section to anchor on).
  return text
    .split(/\n(?=## )/)
    .filter(part => !/^## (?:COMMANDS|TOOL_CALLS|THINKING)\b/.test(part))
    .join('\n')
    .trim();
}

/**
 * LLMs frequently emit bold headers with a stray space just inside the markers
 * (`**Reasoning **`, `** Suggestions**`, `** Reasoning **`). CommonMark's
 * flanking rules reject those, so react-markdown renders the literal `**`.
 * Collapse whitespace immediately inside a `**…**` pair so it renders bold.
 *
 * Safety: the opening `**` must be preceded by line-start/whitespace (so a
 * *closing* `**` is never re-paired with a later opener), the inner class
 * excludes `*` and newlines (so nested `**a *b* c**` is left untouched), and
 * the closing `**` must be followed by whitespace/punctuation/EOL. Unclosed
 * `**` during streaming has no closing marker, so it is left alone.
 */
function normalizeEmphasis(text: string): string {
  return text.replace(
    /(^|[\s(])\*\*[ \t]*([^*\n]+?)[ \t]*\*\*(?=$|[\s).,!?;:])/g,
    '$1**$2**',
  );
}

type MarkdownComponentProps = HTMLAttributes<HTMLElement> & { children?: React.ReactNode; href?: string; className?: string };

const components: Record<string, ComponentType<MarkdownComponentProps>> = {
  code(props: MarkdownComponentProps) {
    const { className, children } = props;
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match;
    if (!isInline) {
      return (
        <div className="rich-code-block">
          {match && <span className="code-lang">{match[1]}</span>}
          <pre>
            <code className={className}>{children}</code>
          </pre>
        </div>
      );
    }
    return (
      <code className="rich-code">
        {children}
      </code>
    );
  },
  table({ children, ...props }) {
    return (
      <div className="rich-table-wrap" {...props}>
        <table>{children}</table>
      </div>
    );
  },
  ul({ children, ...props }) {
    return <ul className="rich-list" {...props}>{children}</ul>;
  },
  h2({ children, ...props }) {
    return <h2 className="rich-h2" {...props}>{children}</h2>;
  },
  h3({ children, ...props }) {
    return <h3 className="rich-h3" {...props}>{children}</h3>;
  },
  hr(_props) {
    return <hr className="rich-hr" />;
  },
  a({ href, children, ...props }) {
    const { node: _node, ...rest } = props as Record<string, unknown>;
    void _node;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="rich-link" {...rest}>
        {children}
      </a>
    );
  },
  blockquote({ children, ...props }) {
    return <blockquote {...props}>{children}</blockquote>;
  },
};

export function RichMarkdown({
  content,
  isStreaming,
  streamingRenderer,
}: {
  content: string;
  isStreaming?: boolean;
  streamingRenderer?: StreamingMarkdownRenderer;
}) {
  const processed = useMemo(() => {
    const text = normalizeEmphasis(stripCommands(content));
    if (isStreaming && streamingRenderer) {
      return streamingRenderer.render(text, (md: string) => md);
    }
    return text;
  }, [content, isStreaming, streamingRenderer]);

  // No caching - prevents memory leaks and XSS from dangerouslySetInnerHTML

  return (
    <div className="rich-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, errorColor: '#b45309', strict: 'ignore', output: 'html' }]]}
        components={components}
      >
        {processed}
      </ReactMarkdown>
      {isStreaming && (
        <span className="streaming-cursor" aria-hidden="true">▊</span>
      )}
    </div>
  );
}