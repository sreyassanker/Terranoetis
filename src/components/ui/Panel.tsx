import type { ReactNode, CSSProperties } from 'react';
import { X } from 'lucide-react';

interface PanelProps {
  title?: string;
  icon?: ReactNode;
  accentColor?: string;
  iconColor?: string;
  titleColor?: string;
  onClose?: () => void;
  children: ReactNode;
  headerExtra?: ReactNode;
  style?: CSSProperties;
  headerHeight?: string;
  hideHeader?: boolean;
  headerBackground?: string;
  width?: number;
}

export default function Panel({
  title,
  icon,
  accentColor = '#6366f1',
  iconColor = '#818cf8',
  titleColor = '#a5b4fc',
  onClose,
  children,
  headerExtra,
  style,
  headerHeight,
  hideHeader,
  headerBackground,
}: PanelProps) {
  return (
    <div style={{
      background: 'rgba(12,12,30,0.94)',
      border: `1px solid rgba(${hexToRgb(accentColor)},0.25)`,
      borderRadius: 12, overflow: 'hidden',
      fontFamily: 'monospace', fontSize: 12,
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(${hexToRgb(accentColor)},0.05)`,
      display: 'flex', flexDirection: 'column',
      ...style,
    }}>
      {!hideHeader && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: headerBackground ?? `linear-gradient(135deg, rgba(${hexToRgb(accentColor)},0.18), rgba(${hexToRgb(accentColor)},0.06))`,
          borderBottom: `1px solid rgba(${hexToRgb(accentColor)},0.15)`,
          minHeight: headerHeight ?? 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
            {icon && <span style={{ color: iconColor, flexShrink: 0, display: 'flex' }}>{icon}</span>}
            <span style={{ color: titleColor, fontWeight: 600, fontSize: 11, letterSpacing: 1, whiteSpace: 'nowrap' }}>
              {title}
            </span>
            {headerExtra}
          </div>
          {onClose && (
            <button
              type="button"
              className="panel-close"
              onClick={onClose}
              aria-label={`Close ${title ?? 'panel'}`}
              title="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}
