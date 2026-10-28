import React, { useMemo, type ComponentType, type HTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { StreamingMarkdownRenderer } from '@/lib/advancedChat';
import { MermaidDiagram } from './MermaidDiagram';
import { InlineChartView } from './AdvancedChatViews';

function stripCommands(text: string): string {
  // Split on section headers (## ...), then drop internal COMMANDS /
  // TOOL_CALLS / THINKING blocks. Split on a newline followed by "## " so a
  // block at the very end is removed too (no trailing section to anchor on).
  let cleaned = text
    .split(/\n(?=## )/)
    .filter(part => !/^## (?:COMMANDS|TOOL_CALLS|THINKING)\b/.test(part))
    .join('\n')
    .trim();

  // Strip stray [ARTIFACT:table:...] or [ARTIFACT:chart:...] tokens
  cleaned = cleaned.replace(/\[ARTIFACT:(?:table|chart):\d+\]/g, '').trim();

  // Strip ONLY code blocks that are purely raw globe command JSON (flyTo, addPin, etc.)
  // Preserve charts, tables, diagrams, and regular code!
  cleaned = cleaned.replace(/```[a-zA-Z0-9_-]*\s*[\r\n]+([\s\S]*?)```/g, (match, blockContent) => {
    const isChart = /"action"\s*:\s*"addChart"|"type"\s*:\s*"(?:pie|bar|line|radar|area)"/.test(blockContent);
    if (isChart) return match;
    const isGlobeCommand = /"action"\s*:\s*"(?:flyTo|addPin|addPolygon|toggleLayer|setStudyArea|addHeatmap|addGeoJSON)"/.test(blockContent);
    if (isGlobeCommand) return '';
    return match;
  }).trim();

  // Fix unclosed code blocks where platform ensemble forecast got trapped
  cleaned = cleaned.replace(/```(?:json)?\s*[\r\n]+(\*Platform ensemble forecast[\s\S]*?)(?:```|$)/gi, '$1\n');

  return cleaned;
}

/**
 * Normalize LaTeX math expressions before feeding into react-markdown.
 * LLMs frequently emit:
 * - \[ ... \] for display math (standard LaTeX)
 * - \( ... \) for inline math (standard LaTeX)
 * - Standalone [ \cmd ... ] bracketed blocks
 * Remark-math only parses $$ ... $$ and $ ... $, so we normalize them here.
 */
function normalizeLatex(text: string): string {
  // Normalize display math \[ ... \] to $$ ... $$
  let res = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, math) => `\n\n$$\n${math.trim()}\n$$\n\n`);
  // Normalize inline math \( ... \) to $ ... $
  res = res.replace(/\\\(([\s\S]+?)\\\)/g, (_m, math) => `$${math.trim()}$`);
  // Normalize standalone bracketed LaTeX expressions: [ \cmd ... ] -> $$ \cmd ... $$
  res = res.replace(/(?:^|\n)\s*\[\s*(\\[a-zA-Z][\s\S]*?)\]\s*(?=\n|$)/g, (_m, math) => `\n\n$$\n${math.trim()}\n$$\n\n`);
  return res;
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

function getMarkdownComponents(isStreaming?: boolean): Record<string, ComponentType<MarkdownComponentProps>> {
  return {
    code(props: MarkdownComponentProps) {
      const { className, children } = props;
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match;
      if (!isInline) {
        if (match && match[1]?.toLowerCase() === 'mermaid') {
          const chartCode = String(children || '').replace(/\n$/, '');
          return <MermaidDiagram chart={chartCode} isStreaming={isStreaming} />;
        }
        if (match && (match[1]?.toLowerCase() === 'chart' || (match[1]?.toLowerCase() === 'json' && (/"labels"\s*:\s*\[/.test(String(children || '')) || /"action"\s*:\s*"addChart"/.test(String(children || '')))))) {
          try {
            const rawJson = String(children || '').trim();
            const spec = JSON.parse(rawJson);
            const labels = spec.labels || spec.data?.labels;
            const values = spec.values || spec.data?.values;
            if (Array.isArray(labels) && Array.isArray(values)) {
              return (
                <InlineChartView
                  artifact={{
                    kind: 'chart',
                    title: spec.title || 'Data Distribution',
                    chartType: spec.type || spec.chartType || 'pie',
                    labels: labels,
                    values: values.map(Number),
                  }}
                />
              );
            }
          } catch {
            /* ignore malformed chart JSON */
          }
        }
        const codeText = String(children || '').trim();
        // If this code block contains internal globe command actions, suppress rendering as developer code card
        if (/"action"\s*:\s*"(?:flyTo|addPin|addPolygon|toggleLayer|setStudyArea|addHeatmap|addGeoJSON)"/.test(codeText)) {
          return null;
        }
        // If falsely labeled as json or untyped but contains markdown lists/prose, render as normal text
        if ((match && match[1]?.toLowerCase() === 'json' && !/^\s*[[{]/.test(codeText)) || /^\*Platform ensemble forecast/i.test(codeText)) {
          return <div className="text-xs text-slate-700 dark:text-slate-200 my-2 leading-relaxed">{children}</div>;
        }
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
}

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
    const text = normalizeLatex(normalizeEmphasis(stripCommands(content)));
    if (isStreaming && streamingRenderer) {
      return streamingRenderer.render(text, (md: string) => md);
    }
    return text;
  }, [content, isStreaming, streamingRenderer]);

  // No caching - prevents memory leaks and XSS from dangerouslySetInnerHTML

  const components = useMemo(() => getMarkdownComponents(isStreaming), [isStreaming]);

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