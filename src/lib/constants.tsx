import { AlertTriangle, Info, AlertCircle, XCircle, type LucideIcon } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════
// Shared UI Constants — Severity colors, icons, and utility functions
// ═══════════════════════════════════════════════════════════════════════

/**
 * Color palette for severity levels across the application.
 * Used consistently in MilitaryDashboard,
 * ReportGenerator, AnomalyPanel, and ForcePosturePanel.
 */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
  info: '#6b7280',
  unknown: '#6b7280',
};

/**
 * Background colors for severity badges.
 */
export const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(239,68,68,0.15)',
  high: 'rgba(249,115,22,0.15)',
  medium: 'rgba(234,179,8,0.12)',
  low: 'rgba(59,130,246,0.12)',
  info: 'rgba(107,114,128,0.12)',
  unknown: 'rgba(107,114,128,0.12)',
};

/**
 * Icon component factories for severity levels.
 * Returns a LucideIcon component for the given severity.
 */
export const SEVERITY_ICONS: Record<string, LucideIcon> = {
  critical: XCircle,
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
  info: Info,
  unknown: Info,
};

/**
 * Format a timestamp into a human-readable "time ago" string.
 * @param ts - Unix timestamp in milliseconds
 * @returns Formatted string like "5m ago", "2h ago", "3d ago"
 */
function formatDuration(diffMs: number): string {
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Format a timestamp into a human-readable "time ago" string.
 * @param ts - Unix timestamp in milliseconds
 * @returns Formatted string like "just now", "5m ago", "2h ago", "3d ago"
 */
export function timeAgo(ts: number): string {
  return formatDuration(Date.now() - ts);
}

/**
 * Format a date string into a relative "time ago" string.
 * @param dateStr - ISO date string or timestamp
 * @returns Formatted string like "just now", "5m ago", "2h ago", "3d ago"
 */
export function formatTimeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return formatDuration(Date.now() - d.getTime());
  } catch {
    return dateStr;
  }
}

/**
 * Render the appropriate icon for a severity level.
 */
export function SeverityIcon({ severity, size = 14 }: { severity: string; size?: number }) {
  const Icon = SEVERITY_ICONS[severity] || SEVERITY_ICONS.unknown;
  return <Icon size={size} />;
}



