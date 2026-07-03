import { useRef, useEffect } from 'react';
import { SCENARIO_TYPE_COLORS } from './types';

interface ScenarioThumbnailProps {
  type: string;
  lat: number;
  lon: number;
  size?: number;
}

const HASH_SEED = 42;
function hash(n: number): number {
  let h = (n | 0) + HASH_SEED;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h >>> 0) / 4294967296;
}

export default function ScenarioThumbnail({ type, lat, lon, size = 48 }: ScenarioThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = size * 2;
    const h = size * 2;
    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const baseColor = SCENARIO_TYPE_COLORS[type] || '#60a5fa';
    const seed = Math.abs(lat * 1000 + lon);

    switch (type) {
      case 'earthquake_swarm': {
        const cx = w / 2, cy = h / 2;
        for (let i = 0; i < 30; i++) {
          const a = hash(seed + i) * Math.PI * 2;
          const r = hash(seed + i + 100) * w * 0.35;
          const sz = 1 + hash(seed + i + 200) * 3;
          ctx.fillStyle = `rgba(239,68,68,${0.3 + hash(seed + i + 300) * 0.6})`;
          ctx.beginPath();
          ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), sz, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(239,68,68,0.25)';
        ctx.lineWidth = 1;
        for (let ring = 1; ring <= 3; ring++) {
          ctx.beginPath();
          ctx.arc(cx, cy, ring * w * 0.1, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'hurricane_landfall': {
        const cx = w / 2, cy = h / 2;
        for (let ring = 0; ring < 4; ring++) {
          const r = (ring + 1) * w * 0.08;
          ctx.strokeStyle = `rgba(245,158,11,${0.7 - ring * 0.15})`;
          ctx.lineWidth = 2 - ring * 0.3;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(245,158,11,0.4)';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'wildfire_spread': {
        const cx = w * 0.4, cy = h * 0.6;
        for (let i = 0; i < 25; i++) {
          const a = hash(seed + i) * Math.PI * 2;
          const r = hash(seed + i + 50) * w * 0.3;
          const sz = 1 + hash(seed + i + 150) * 2.5;
          ctx.fillStyle = `rgba(255,${100 + Math.floor(hash(seed + i + 250) * 100)},53,${0.4 + hash(seed + i + 350) * 0.5})`;
          ctx.beginPath();
          ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), sz, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(124,45,18,0.3)';
        ctx.beginPath();
        ctx.arc(cx, cy, w * 0.18, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'volcanic_eruption': {
        const cx = w / 2, cy = h * 0.7;
        ctx.fillStyle = 'rgba(217,70,239,0.5)';
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy);
        ctx.lineTo(cx, cy - h * 0.5);
        ctx.lineTo(cx + 4, cy);
        ctx.fill();
        for (let i = 0; i < 15; i++) {
          const x = cx + (hash(seed + i) - 0.5) * w * 0.4;
          const y = cy - h * 0.3 - hash(seed + i + 100) * h * 0.2;
          ctx.fillStyle = `rgba(168,85,247,${0.2 + hash(seed + i + 200) * 0.4})`;
          ctx.beginPath();
          ctx.arc(x, y, 1 + hash(seed + i + 300) * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'flood_inundation': {
        for (let y = h * 0.4; y < h; y += 3) {
          ctx.fillStyle = `rgba(59,130,246,${0.1 + (y / h) * 0.3})`;
          ctx.fillRect(0, y, w, 2);
        }
        ctx.strokeStyle = 'rgba(96,165,250,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.45);
        for (let x = 0; x <= w; x += 4) {
          ctx.lineTo(x, h * 0.45 + Math.sin(x * 0.08) * 3);
        }
        ctx.stroke();
        break;
      }
      case 'tsunami_wave': {
        const cx = w / 2, cy = h / 2;
        for (let ring = 1; ring <= 4; ring++) {
          ctx.strokeStyle = `rgba(6,182,212,${0.6 - ring * 0.1})`;
          ctx.lineWidth = 2 - ring * 0.3;
          ctx.beginPath();
          ctx.arc(cx, cy, ring * w * 0.08, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
        ctx.globalAlpha = 1;
      }
    }
  }, [type, lat, lon, size]);

  return (
    <canvas ref={canvasRef} style={{ width: size, height: size, borderRadius: 4, display: 'block' }} />
  );
}
