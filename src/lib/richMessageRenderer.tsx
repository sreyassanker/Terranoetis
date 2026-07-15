import DOMPurify from 'dompurify';

const RICH_MESSAGE_CACHE = new Map<string, string>();
const RICH_MESSAGE_CACHE_MAX = 200;

const TYPE_LABELS: Record<string, string> = {
  earthquake_swarm: 'Earthquake Swarm', hurricane_landfall: 'Hurricane Landfall',
  wildfire_spread: 'Wildfire Spread', volcanic_eruption: 'Volcanic Eruption',
  flood_inundation: 'Flood Inundation',
  data_layer: 'Data Layer',
};

export function adaptScenario(raw: any): any {
  const severity = raw.validationScore > 0.8 ? 'extreme' : raw.validationScore > 0.6 ? 'high' : raw.validationScore > 0.4 ? 'medium' : 'low';
  const lat = raw.params?.lat ?? raw.params?.epicenterLat ?? 0;
  const lon = raw.params?.lon ?? raw.params?.epicenterLon ?? 0;
  return {
    id: raw.id,
    type: raw.type,
    name: (raw.dataSources?.length ? 'Data: ' : '') + (TYPE_LABELS[raw.type as string] || raw.type),
    pointCloud: raw.pointCloud,
    validationScore: raw.validationScore,
    severity,
    location: { lat, lon },
    timestamp: raw.createdAt,
    timeSeries: raw.timeSeries,
    metadata: {
      ...raw.metadata,
      colorValues: raw.colorValues,
      valueMin: raw.valueMin,
      valueMax: raw.valueMax,
      variableName: raw.variableName,
      dataSources: raw.dataSources,
      bbox: raw.bbox,
    },
  };
}

export function mapFrontendParams(type: string, params: Record<string, unknown>): Record<string, unknown> {
  const { lat, lon, magnitude = 5, depth = 10, spread = 0.1, intensity = 1, duration = 24, windSpeed = 50, populationDensity: _pd, ...rest } = params;
  const base = { lat, lon };
  switch (type) {
    case 'earthquake_swarm':
      return { ...base, depthRange: [Math.max(0.1, (depth as number) - 5), (depth as number) + 5], magnitudeRange: [Math.max(0, (magnitude as number) - 2), Math.min(9.5, (magnitude as number) + 2)], numEvents: Math.max(10, Math.round((spread as number) * 100)), timeWindow: duration, decayModel: 'omori' };
    case 'hurricane_landfall':
      return { ...base, category: Math.min(7, Math.max(1, Math.round((magnitude as number) / 1.5))), forwardSpeed: windSpeed, pressure: Math.round(1050 - (intensity as number) * 10), radius: Math.max(10, (spread as number) * 200 + 10), landfallTime: duration };
    case 'wildfire_spread':
      return { ...base, area: Math.max(100, (spread as number) * 5000 + 500), windSpeed: windSpeed, windDir: 270, humidity: Math.max(0, Math.min(100, 100 - (depth as number))), fuelType: 'forest', duration };
    case 'volcanic_eruption':
      return { ...base, vei: Math.min(7, Math.max(1, Math.round((magnitude as number) / 2))), ashHeight: Math.max(1000, (intensity as number) * 2000), windDir: 260, duration };
    case 'flood_inundation':
      return { ...base, rainfall: Math.max(10, (intensity as number) * 100), catchmentArea: Math.max(100, (spread as number) * 5000), soilSaturation: Math.min(1, Math.max(0, (depth as number) / 100)), duration };
    default:
      return { ...base, ...params };
  }
}

export function richRender(text: string): string {
  const cached = RICH_MESSAGE_CACHE.get(text);
  if (cached) return cached;

  const readableText = text.replace(/## COMMANDS\n[\s\S]*?(?=\n##|\n*$)/g, '');
  let html = readableText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langTag = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="rich-code-block">${langTag}<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></div>`;
  });

  html = html.replace(/\n?\|(.+)\|\n\|([-|:\s]+)\|\n((?:\|.+\|\n?)*)/g, (_, headerRow, _sepRow, dataRows) => {
    const headers = headerRow.split('|').map((h: string) => `<th>${h.trim()}</th>`).join('');
    const rows = dataRows.trim().split('\n').map((row: string) => {
      const cells = row.split('|').map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<div class="rich-table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
  });

  html = html.replace(/^---$/gm, '<hr class="rich-hr" />');
  html = html.replace(/^( *)[-*] (.+)$/gm, '$1<li>$2</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="rich-list">$&</ul>');
  html = html.replace(/^ *(\d+)\. (.+)$/gm, '<li value="$1">$2</li>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="rich-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="rich-h2">$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code class="rich-code">$1</code>');
  html = html.replace(/\n{2,}/g, '</p><p class="rich-p">');
  html = html.replace(/\n/g, '<br/>');

  if (!html.startsWith('<')) html = `<p class="rich-p">${html}</p>`;

  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'strong', 'em', 'code', 'pre', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'a', 'blockquote'],
    ALLOWED_ATTR: ['class', 'value', 'href', 'rel', 'target'],
    ALLOW_DATA_ATTR: false,
  });
  if (RICH_MESSAGE_CACHE.size > RICH_MESSAGE_CACHE_MAX) RICH_MESSAGE_CACHE.clear();
  RICH_MESSAGE_CACHE.set(text, safe);
  return safe;
}
