import React, { useMemo, type ComponentType, type HTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';

function stripCommands(text: string): string {
  return text
    .replace(/^## COMMANDS\n[\s\S]*?(?=\n^## |\n*$)/gm, '')
    .replace(/^## TOOL_CALLS\n[\s\S]*?(?=\n^## |\n*$)/gm, '')
    .replace(/^## THINKING\n[\s\S]*?(?=\n^## |\n*$)/gm, '');
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
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
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
    const text = stripCommands(content);
    if (isStreaming && streamingRenderer) {
      return streamingRenderer.render(text, (md: string) => md);
    }
    return text;
  }, [content, isStreaming, streamingRenderer]);

  // No caching - prevents memory leaks and XSS from dangerouslySetInnerHTML

  return (
    <div className="rich-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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