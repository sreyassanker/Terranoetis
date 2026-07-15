/**
 * ReportGenerator — Generates a downloadable PDF intelligence report
 *
 * Captures the current dashboard state (zones, alerts, risk scores, trends)
 * and renders a styled PDF with cover page, threat matrix, and alert summary.
 */

import React, { useRef, useCallback, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { FileText, Download, X } from 'lucide-react';
import { SEVERITY_COLORS } from '@/lib/constants';

interface WatchZone {
  id: string;
  name: string;
  bbox_min_lat: number;
  bbox_max_lat: number;
  bbox_min_lon: number;
  bbox_max_lon: number;
  layers: string[];
  enabled: boolean;
  composite_score: number;
  hazard_scores: Record<string, number>;
}

interface DashboardAlert {
  alert_id: string;
  title: string;
  body: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  lat?: number;
  lon?: number;
  type?: string;
  created_at: string;
}

interface ReportGeneratorProps {
  zones: WatchZone[];
  alerts: DashboardAlert[];
  stats: { totalZones: number; totalAlerts: number; criticalAlerts: number; avgRisk: number };
  onClose: () => void;
}

const HAZARD_LABELS: Record<string, string> = {
  earthquakes: 'Earthquakes', weather: 'Weather', wildfires: 'Wildfires',
  floods: 'Floods', storms: 'Storms', air_quality: 'Air Quality', firms_fires: 'FIRMS Fires',
};



function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReportGenerator({ zones, alerts, stats, onClose }: ReportGeneratorProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  const generatePdf = useCallback(async () => {
    setGenerating(true);
    try {
      // Wait for render
      await new Promise(r => setTimeout(r, 100));

      if (!reportRef.current) return;

      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#0c0c1e',
        logging: false,
        ignoreElements: (el: Element) => el.tagName === 'CANVAS',
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'l' : 'p',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth - 20; // 10mm margin
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 10; // top margin

      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= (pdfHeight - 20);

      while (heightLeft > 0) {
        position = -(pdfHeight - 20) + 10;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
        heightLeft -= (pdfHeight - 20);
      }

      const filename = `sentinel-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(filename);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, []);

  const riskColor = (score: number) => score >= 75 ? '#ef4444' : score >= 50 ? '#f97316' : score >= 25 ? '#eab308' : '#22c55e';
  const riskLabel = (score: number) => score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MODERATE' : 'LOW';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.8)', zIndex: 1000,
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        background: 'rgba(12,12,30,0.98)', border: '1px solid rgba(59,130,246,0.3)',
        borderRadius: 12, padding: 16, maxWidth: 700, width: '90%', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} style={{ color: '#60a5fa' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Generate Intelligence Report</span>
          </div>
          <X size={16} style={{ color: '#64748b', cursor: 'pointer' }} onClick={onClose} />
        </div>

        {/* Report Preview (hidden, rendered to canvas) */}
        <div style={{ maxHeight: '60vh', overflow: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div ref={reportRef} style={{
            padding: 32, background: '#0c0c1e', color: '#e2e8f0',
            fontFamily: 'monospace', fontSize: 11, width: '100%',
          }}>
            {/* Cover Header */}
            <div style={{ textAlign: 'center', marginBottom: 32, paddingBottom: 24, borderBottom: '2px solid rgba(59,130,246,0.3)' }}>
              <div style={{ fontSize: 9, color: '#60a5fa', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>
                CLASSIFICATION: UNCLASSIFIED // FOUO
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#93c5fd', marginBottom: 4 }}>
                SENTINEL INTELLIGENCE REPORT
              </div>
              <div style={{ fontSize: 10, color: '#64748b' }}>
                Generated: {formatDate(new Date())}
              </div>
            </div>

            {/* Executive Summary */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                1. Executive Summary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                {[
                  { label: 'Zones Monitored', value: stats.totalZones, color: '#60a5fa' },
                  { label: 'Active Alerts', value: stats.totalAlerts, color: '#f59e0b' },
                  { label: 'Critical Alerts', value: stats.criticalAlerts, color: '#ef4444' },
                  { label: 'Average Risk', value: Math.round(stats.avgRisk), color: riskColor(stats.avgRisk) },
                ].map(item => (
                  <div key={item.label} style={{ textAlign: 'center', padding: '12px 8px', background: `${item.color}12`, borderRadius: 8, border: `1px solid ${item.color}22` }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: item.color }}>{item.value}</div>
                    <div style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase', marginTop: 4 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.6 }}>
                Overall risk posture: <span style={{ color: riskColor(stats.avgRisk), fontWeight: 600 }}>{riskLabel(stats.avgRisk)} ({Math.round(stats.avgRisk)}/100)</span>.
                {stats.criticalAlerts > 0
                  ? ` ${stats.criticalAlerts} critical alert(s) require immediate attention.`
                  : ' No critical alerts at this time.'}
                {stats.totalZones > 0 ? ` Monitoring ${stats.totalZones} active zone(s).` : ''}
              </div>
            </div>

            {/* Threat Matrix */}
            {zones.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                  2. Threat Matrix
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 8px', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)', fontWeight: 600 }}>Zone</th>
                      {Object.entries(HAZARD_LABELS).map(([id, label]) => (
                        <th key={id} style={{ textAlign: 'center', padding: '6px 4px', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)', fontWeight: 600 }}>{label.slice(0, 4)}</th>
                      ))}
                      <th style={{ textAlign: 'center', padding: '6px 8px', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)', fontWeight: 600 }}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map(zone => (
                      <tr key={zone.id}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e2e8f0' }}>{zone.name}</td>
                        {Object.keys(HAZARD_LABELS).map(h => {
                          const score = zone.hazard_scores?.[h] ?? 0;
                          return (
                            <td key={h} style={{ textAlign: 'center', padding: '4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <span style={{ color: riskColor(score), fontWeight: 600 }}>{score > 0 ? Math.round(score) : '—'}</span>
                            </td>
                          );
                        })}
                        <td style={{ textAlign: 'center', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <span style={{ color: riskColor(zone.composite_score), fontWeight: 700 }}>{Math.round(zone.composite_score)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Zone Details */}
            {zones.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                  3. Zone Details
                </div>
                {zones.map(zone => (
                  <div key={zone.id} style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, borderLeft: `3px solid ${riskColor(zone.composite_score)}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{zone.name}</span>
                      <span style={{ color: riskColor(zone.composite_score), fontWeight: 700 }}>{Math.round(zone.composite_score)}/100</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>
                      {zone.bbox_min_lat.toFixed(1)}°–{zone.bbox_max_lat.toFixed(1)}° lat, {zone.bbox_min_lon.toFixed(1)}°–{zone.bbox_max_lon.toFixed(1)}° lon | Layers: {zone.layers.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Alert Summary */}
            {alerts.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                  4. Alert Summary
                </div>
                {alerts.slice(0, 10).map(alert => (
                  <div key={alert.alert_id} style={{
                    marginBottom: 6, padding: '8px 10px', borderRadius: 6,
                    background: `${SEVERITY_COLORS[alert.severity] || '#6b7280'}08`,
                    borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity] || '#6b7280'}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 10 }}>{alert.title}</span>
                      <span style={{ fontSize: 8, color: '#64748b' }}>{alert.severity.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>{alert.body}</div>
                  </div>
                ))}
                {alerts.length > 10 && (
                  <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center', marginTop: 4 }}>
                    + {alerts.length - 10} more alerts
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12, marginTop: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: '#64748b' }}>
                SENTINEL Intelligence Platform | {formatDate(new Date())} | Auto-generated report
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '6px 14px', fontSize: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent', color: '#94a3b8', cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={generatePdf} disabled={generating} style={{
            padding: '6px 14px', fontSize: 10, borderRadius: 6, border: 'none',
            background: generating ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
            color: '#fff', cursor: generating ? 'wait' : 'pointer', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Download size={12} />
            {generating ? 'Generating...' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
