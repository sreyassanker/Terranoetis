import React, { useEffect, useRef, useState, useId } from 'react';
import mermaid from 'mermaid';
import { Copy, Check, Code2, Eye, Maximize2, Minimize2, AlertCircle } from 'lucide-react';

function isLightModeActive(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.querySelector('.ai-panel-light') ||
    document.documentElement.classList.contains('light') ||
    (!document.documentElement.classList.contains('dark') && !document.querySelector('.ai-panel-dark'))
  );
}

function configureMermaid(isLight: boolean) {
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: isLight ? 'neutral' : 'dark',
      themeVariables: isLight
        ? {
            darkMode: false,
            background: '#ffffff',
            mainBkg: '#f8fafc',
            nodeBorder: '#0284c7',
            lineColor: '#64748b',
            textColor: '#0f172a',
            primaryColor: '#f1f5f9',
            primaryTextColor: '#0f172a',
            primaryBorderColor: '#0284c7',
            secondaryColor: '#f8fafc',
            tertiaryColor: '#ffffff',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            fontSize: '12px',
          }
        : {
            darkMode: true,
            background: '#0d131f',
            mainBkg: '#131b2e',
            nodeBorder: '#38bdf8',
            lineColor: '#64748b',
            textColor: '#f8fafc',
            primaryColor: '#1e293b',
            primaryTextColor: '#f1f5f9',
            primaryBorderColor: '#38bdf8',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            fontSize: '12px',
          },
      securityLevel: 'loose',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      logLevel: 'fatal',
    });
  } catch (err) {
    console.error('Failed to configure mermaid:', err);
  }
}

interface MermaidDiagramProps {
  chart: string;
  isStreaming?: boolean;
}

export function MermaidDiagram({ chart, isStreaming }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const uniqueId = useId().replace(/:/g, '_');

  useEffect(() => {
    const isLight = isLightModeActive();
    configureMermaid(isLight);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      if (!chart.trim()) return;

      try {
        const isLight = isLightModeActive();
        configureMermaid(isLight);

        const renderId = `mermaid_svg_${uniqueId}_${Date.now()}`;
        // Clean up common LLM artifacts
        const cleanChart = chart
          .trim()
          .replace(/^```mermaid\s*/i, '')
          .replace(/```\s*$/, '')
          .trim();

        const { svg } = await mermaid.render(renderId, cleanChart);
        if (!cancelled) {
          setSvgHtml(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          // If streaming, syntax might be incomplete — do not treat as fatal error yet
          if (isStreaming) {
            setError('Generating diagram…');
          } else {
            setError(err instanceof Error ? err.message : 'Invalid Mermaid diagram syntax');
          }
        }
      }
    }

    renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, uniqueId, isStreaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(chart.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`mermaid-wrapper ${isFullscreen ? 'mermaid-fullscreen' : ''}`}
      style={{
        margin: '10px 0',
        borderRadius: 8,
        overflow: 'hidden',
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 20 : undefined,
        left: isFullscreen ? 20 : undefined,
        right: isFullscreen ? 20 : undefined,
        bottom: isFullscreen ? 20 : undefined,
        zIndex: isFullscreen ? 99999 : undefined,
        maxHeight: isFullscreen ? 'calc(100vh - 40px)' : undefined,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header bar */}
      <div
        className="mermaid-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="mermaid-badge" style={{
            fontSize: 9,
            padding: '1px 6px',
            borderRadius: 4,
            fontWeight: 700,
            letterSpacing: '0.5px',
          }}>
            DIAGRAM
          </span>
          <span className="mermaid-subtitle" style={{ fontSize: 10 }}>Mermaid Flow</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Diagram / Code Toggle */}
          <button
            type="button"
            className="mermaid-btn"
            onClick={() => setViewMode(v => v === 'diagram' ? 'code' : 'diagram')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              fontSize: 10,
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title={viewMode === 'diagram' ? 'View Mermaid Source' : 'View Diagram'}
          >
            {viewMode === 'diagram' ? <Code2 size={12} /> : <Eye size={12} />}
            <span>{viewMode === 'diagram' ? 'Code' : 'Diagram'}</span>
          </button>

          {/* Copy Button */}
          <button
            type="button"
            className="mermaid-btn"
            onClick={handleCopy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 6px',
              borderRadius: 4,
              cursor: 'pointer',
              color: copied ? '#10b981' : undefined,
            }}
            title="Copy Mermaid Code"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            className="mermaid-btn"
            onClick={() => setIsFullscreen(v => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 6px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title={isFullscreen ? 'Exit Fullscreen' : 'Expand Diagram'}
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {/* Main Diagram or Code View */}
      <div style={{ flex: 1, overflow: 'auto', padding: '14px', position: 'relative' }}>
        {viewMode === 'code' ? (
          <pre className="mermaid-code-view" style={{ margin: 0, padding: '10px 12px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            <code>{chart.trim()}</code>
          </pre>
        ) : error && !svgHtml ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: isStreaming ? '#0284c7' : '#ef4444',
            fontSize: 11,
            padding: '12px',
            background: 'rgba(239, 68, 68, 0.08)',
            borderRadius: 6,
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="mermaid-svg-container"
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%',
              overflowX: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        )}
      </div>
    </div>
  );
}
