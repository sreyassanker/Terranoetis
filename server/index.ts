import express from 'express';
import cors from 'cors';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';
import { Scraper } from '@the-convocation/twitter-scraper';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';

dotenv.config({ path: 'server/.env' });
dotenv.config();

const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const app = express();
const PORT = Number(process.env.PROXY_PORT ?? 3001);

app.use(cors());
app.use(express.json());

async function cachedFetch<T>(key: string, url: string, ttl = 60, init?: RequestInit): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit) return hit;
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(`${key} upstream ${resp.status}`);
  const data = (await resp.json()) as T;
  cache.set(key, data, ttl);
  return data;
}

interface IndiaCctvCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pageUrl: string;
  previewUrl?: string;
  streamUrl?: string;
  thumbnailUrl?: string;
  source: string;
  category?: string;
  city?: string;
  region?: string;
  location?: string;
  updatedAt: number;
  description?: string;
}

interface IndiaCctvPayload {
  source: string;
  country: string;
  updatedAt: number;
  cameras: IndiaCctvCamera[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'camera';
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function collectJsonLdNodes(input: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    input.forEach(item => collectJsonLdNodes(item, out));
    return out;
  }

  if (!input || typeof input !== 'object') {
    return out;
  }

  const record = input as Record<string, unknown>;
  out.push(record);

  if (record['@graph']) {
    collectJsonLdNodes(record['@graph'], out);
  }
  if (record.itemListElement) {
    collectJsonLdNodes(record.itemListElement, out);
  }
  if (record.item) {
    collectJsonLdNodes(record.item, out);
  }

  return out;
}

function extractIndiaCctvCameras(html: string): IndiaCctvCamera[] {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const jsonLdNodes: Record<string, unknown>[] = [];

  for (const match of scripts) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      collectJsonLdNodes(JSON.parse(raw), jsonLdNodes);
    } catch {
      // Ignore malformed JSON-LD blocks and continue scanning the page.
    }
  }

  const itemLists = jsonLdNodes.filter(node => node['@type'] === 'ItemList' && Array.isArray(node.itemListElement));
  const entries = itemLists.flatMap(list => {
    const items = list.itemListElement as Array<Record<string, unknown> | undefined>;
    return items.map(entry => (entry && typeof entry === 'object' ? (entry.item as Record<string, unknown> | undefined) ?? entry : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  });

  const cameras = new Map<string, IndiaCctvCamera>();

  for (const [index, item] of entries.entries()) {
    const record = item as Record<string, any>;
    const contentLocation = record.contentLocation as Record<string, any> | undefined;
    const geo = contentLocation?.geo as Record<string, any> | undefined;
    const lat = toNumber(geo?.latitude ?? record.latitude ?? record.lat);
    const lon = toNumber(geo?.longitude ?? record.longitude ?? record.lon);
    if (lat == null || lon == null) continue;

    const pageUrl = String(record.url ?? record.mainEntityOfPage ?? record.sameAs ?? '');
    const previewUrl = String(record.thumbnailUrl ?? record.image ?? record.contentUrl ?? '');
    const streamUrl = String(record.contentUrl ?? record.embedUrl ?? pageUrl ?? previewUrl ?? '');
    const address = contentLocation?.address as Record<string, any> | undefined;
    const name = String(record.name ?? record.headline ?? `India Camera ${index + 1}`);
    const id = slugify(pageUrl || `${name}-${lat}-${lon}`);

    cameras.set(id, {
      id,
      name,
      lat,
      lon,
      pageUrl: pageUrl || streamUrl || previewUrl || 'https://opencctv.org/cameras/india',
      previewUrl: previewUrl || undefined,
      streamUrl: streamUrl || undefined,
      thumbnailUrl: String(record.thumbnailUrl ?? record.image ?? '') || undefined,
      source: 'opencctv.org',
      category: String(record.genre ?? record.additionalType ?? record.keywords ?? 'public webcam'),
      city: String(address?.addressLocality ?? '') || undefined,
      region: String(address?.addressRegion ?? '') || undefined,
      location: String(contentLocation?.name ?? address?.addressLocality ?? address?.addressRegion ?? 'India'),
      updatedAt: Date.now(),
      description: String(record.description ?? '') || undefined,
    });
  }

  return [...cameras.values()];
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/earthquakes', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'earthquakes',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      60,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/earthquakes/significant', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'earthquakes_significant',
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
      300,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/tectonic', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'tectonic',
      'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json',
      86400,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

interface WorldwideCctvCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pageUrl: string;
  previewUrl?: string;
  streamUrl?: string;
  thumbnailUrl?: string;
  source: string;
  category?: string;
  city?: string;
  region?: string;
  location?: string;
  updatedAt: number;
  description?: string;
  feedType?: string;
}

interface WorldwideCctvPayload {
  source: string;
  country: string;
  updatedAt: number;
  cameras: WorldwideCctvCamera[];
}

const BOUNDS = [
  { s: 24, w: -100, n: 50, e: -65 },   // US East / Midwest
  { s: 24, w: -125, n: 50, e: -100 },  // US West
  { s: -56, w: -90, n: 20, e: -34 },   // South & Central America
  { s: 36, w: -10, n: 62, e: 16 },     // Western Europe
  { s: 30, w: 16, n: 70, e: 60 },      // Eastern Europe & Middle East
  { s: 5, w: 60, n: 36, e: 98 },       // India & South Asia
  { s: 20, w: 120, n: 46, e: 146 },    // East Asia (Japan, Korea, Taiwan)
  { s: -50, w: 110, n: -10, e: 180 },  // Oceania (Australia & New Zealand)
  { s: -35, w: -20, n: 35, e: 55 }     // Africa
];

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchWorldwideCameras(): Promise<WorldwideCctvCamera[]> {
  // Fetch India cameras from webpage first to guarantee their inclusion
  let indiaCams: WorldwideCctvCamera[] = [];
  try {
    const resp = await fetch('https://opencctv.org/cameras/india', {
      headers: { 'User-Agent': 'LiveGlobe/1.0 (public camera explorer)' }
    });
    if (resp.ok) {
      const html = await resp.text();
      indiaCams = extractIndiaCctvCameras(html);
    }
  } catch (err) {
    console.error('Failed to scrape India webcams:', err);
  }

  const fetchBox = async (box: typeof BOUNDS[0]) => {
    try {
      const url = `https://opencctv.org/api/cameras?bounds=${box.s},${box.w},${box.n},${box.e}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'LiveGlobe/1.0 (public camera explorer)' }
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  const results = await Promise.all(BOUNDS.map(fetchBox));
  const allCams = new Map<string, any>();

  // Prepopulate with scraped India cameras
  for (const c of indiaCams) {
    allCams.set(c.id, {
      id: c.id,
      name: c.name,
      lat: c.lat,
      lng: c.lon,
      feed_url: c.previewUrl ?? c.streamUrl ?? c.pageUrl,
      feed_type: (c.streamUrl?.includes('m3u8') || c.previewUrl?.includes('m3u8')) ? 'm3u8' : 'image',
      source: c.source || 'opencctv.org',
      category: c.category,
      city: c.city,
      state: c.region,
      country: 'IN'
    });
  }

  for (const list of results) {
    for (const cam of list) {
      if (cam && cam.id && Number.isFinite(cam.lat) && Number.isFinite(cam.lng)) {
        allCams.set(cam.id, cam);
      }
    }
  }

  const cams = Array.from(allCams.values());
  const hlsCams = shuffleArray(cams.filter(c => c.feed_type === 'm3u8' && c.feed_url && c.feed_url.startsWith('http')));
  const otherCams = shuffleArray(cams.filter(c => c.feed_type !== 'm3u8'));

  const cityCount: Record<string, number> = {};
  const filteredCams: any[] = [];

  // Guarantee scraped Indian cameras are added first
  const indiaSpecific = cams.filter(c => c.country === 'IN');
  for (const cam of indiaSpecific) {
    filteredCams.push(cam);
    const cityKey = `${cam.country || ''}_${cam.city || ''}`.toLowerCase();
    cityCount[cityKey] = (cityCount[cityKey] || 0) + 1;
  }

  // 1. Add valid HLS (video) streams
  for (const cam of hlsCams) {
    if (cam.country === 'IN') continue;
    const cityKey = `${cam.country || ''}_${cam.city || ''}`.toLowerCase();
    cityCount[cityKey] = (cityCount[cityKey] || 0) + 1;
    if (cityCount[cityKey] <= 3) {
      filteredCams.push(cam);
    }
  }

  // 2. Add other feeds (mjpeg/images) up to 800 cameras limit
  for (const cam of otherCams) {
    if (filteredCams.length >= 800) break;
    if (cam.country === 'IN') continue;
    const cityKey = `${cam.country || ''}_${cam.city || ''}`.toLowerCase();
    cityCount[cityKey] = (cityCount[cityKey] || 0) + 1;
    if (cityCount[cityKey] <= 2) {
      filteredCams.push(cam);
    }
  }

  return filteredCams.map(cam => {
    const pageUrl = `https://opencctv.org/cameras/${cam.id}`;
    const feedUrl = cam.feed_url;
    return {
      id: cam.id,
      name: cam.name || `Camera ${cam.camera_code}`,
      lat: cam.lat,
      lon: cam.lng,
      pageUrl,
      previewUrl: feedUrl,
      streamUrl: feedUrl,
      thumbnailUrl: feedUrl,
      source: cam.source || 'opencctv.org',
      category: cam.category || 'public webcam',
      city: cam.city || undefined,
      region: cam.state || undefined,
      location: [cam.city, cam.state, cam.country].filter(Boolean).join(', ') || 'Worldwide',
      updatedAt: Date.now(),
      description: cam.description || undefined,
      feedType: cam.feed_type
    };
  });
}

app.get(['/api/cctv/worldwide', '/api/cctv/india'], async (_req, res) => {
  try {
    const hit = cache.get<WorldwideCctvPayload>('cctv_worldwide');
    if (hit) {
      res.json(hit);
      return;
    }

    const cameras = await fetchWorldwideCameras();
    const payload: WorldwideCctvPayload = {
      source: 'opencctv.org',
      country: 'Worldwide',
      updatedAt: Date.now(),
      cameras,
    };
    cache.set('cctv_worldwide', payload, 1800);
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/eonet', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'eonet',
      'https://eonet.gsfc.nasa.gov/api/v3/events?days=30&status=open',
      120,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/iss', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'iss',
      'https://api.wheretheiss.at/v1/satellites/25544',
      5,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/satellites/tle', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'satellites_tle',
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json',
      300,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/flights', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
    const key = authHeader ? 'flights_auth' : 'flights';
    const hit = cache.get(key);
    if (hit) return res.json(hit);
    const resp = await fetch('https://opensky-network.org/api/states/all', { headers });
    if (!resp.ok) throw new Error(`OpenSky ${resp.status}`);
    const data = await resp.json();
    cache.set(key, data, 15);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/flights/regional', async (req, res) => {
  const lat = req.query.lat ?? '51.5';
  const lon = req.query.lon ?? '-0.1';
  const dist = req.query.dist ?? '250';
  const key = `flights_regional_${lat}_${lon}_${dist}`;
  try {
    const data = await cachedFetch(
      key,
      `https://adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
      5,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/weather/alerts', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'nws_alerts',
      'https://api.weather.gov/alerts/active',
      60,
      { headers: { 'User-Agent': 'LiveGlobe/1.0 (earth-intelligence)' } },
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/space-weather/kp', async (_req, res) => {
  try {
    const data = await cachedFetch(
      'kp_index',
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
      300,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/gdacs/alerts', async (_req, res) => {
  try {
    const resp = await fetch('https://www.gdacs.org/xml/rss.xml');
    if (!resp.ok) throw new Error(`GDACS ${resp.status}`);
    const text = await resp.text();
    cache.set('gdacs_rss', text, 300);
    res.type('application/xml').send(text);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/firms', async (req, res) => {
  const mapKey = process.env.NASA_FIRMS_MAP_KEY;
  if (!mapKey) {
    res.status(503).json({ error: 'NASA_FIRMS_MAP_KEY not configured on server' });
    return;
  }
  const dayRange = req.query.dayRange ?? '1';
  const key = `firms_${dayRange}`;
  try {
    const data = await cachedFetch(
      key,
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/world/${dayRange}`,
      300,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// --- SOCIAL MEDIA & NEWS SCRAPER (NO API KEYS) ---
const rssParser = new Parser();
const twitterScraper = new Scraper();

app.get('/api/social', async (req, res) => {
  const cacheKey = 'social_feed_cache';
  const hit = cache.get(cacheKey);
  if (hit) {
    res.json(hit);
    return;
  }

  const results: any[] = [];

  try {
    // 1. Google News RSS (Extremely Reliable)
    const feed = await rssParser.parseURL('https://news.google.com/rss/search?q=earthquake+OR+tsunami+OR+disaster+OR+hurricane&hl=en-US&gl=US&ceid=US:en');
    feed.items.slice(0, 5).forEach(item => {
      results.push({
        id: 'news_' + Math.random().toString(36).substring(7),
        platform: 'news',
        title: item.title,
        source: item.source || 'Google News',
        url: item.link,
        lat: 0, lon: 0, // News generally doesn't have coordinates in RSS
        timestamp: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
        type: 'news'
      });
    });

    // 2. Twitter Scraper (Bypasses API via Guest Tokens)
    try {
      const tweets = await twitterScraper.searchTweets('earthquake OR disaster -filter:replies min_retweets:10', 5, 2);
      let count = 0;
      for await (const tweet of tweets) {
        if (count >= 5) break;
        results.push({
          id: 'tw_' + tweet.id,
          platform: 'twitter',
          title: tweet.text?.substring(0, 100) + '...',
          source: '@' + (tweet.username || 'twitter_user'),
          url: `https://twitter.com/${tweet.username}/status/${tweet.id}`,
          lat: 0, lon: 0,
          timestamp: tweet.timestamp ? new Date(tweet.timestamp).getTime() : Date.now(),
          type: 'social'
        });
        count++;
      }
    } catch (e) {
      console.warn('Twitter scrape failed (expected occasionally):', String(e));
    }

    // 3. Facebook Puppeteer Scraper (Public Page parsing)
    try {
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      // Go to a known public emergency page, e.g., FEMA
      await page.goto('https://www.facebook.com/FEMA', { waitUntil: 'networkidle2', timeout: 15000 });
      const html = await page.content();
      await browser.close();

      const $ = cheerio.load(html);
      // Try to extract basic text from FB's complex obfuscated DOM
      // Because FB changes classes daily, we just look for broad generic text blocks or paragraphs
      let fbCount = 0;
      $('div[dir="auto"]').each((i, el) => {
        const text = $(el).text();
        if (text.length > 50 && text.length < 500 && fbCount < 3) {
           results.push({
            id: 'fb_' + Math.random().toString(36).substring(7),
            platform: 'facebook',
            title: text.substring(0, 100) + '...',
            source: 'FEMA (Facebook)',
            url: 'https://www.facebook.com/FEMA',
            lat: 0, lon: 0,
            timestamp: Date.now(),
            type: 'social'
          });
          fbCount++;
        }
      });
    } catch (e) {
      console.warn('Facebook scrape failed:', String(e));
    }

    // Sort all combined results by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    cache.set(cacheKey, results, 300); // Cache for 5 minutes to prevent bans
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`LiveGlobe API proxy listening on http://localhost:${PORT}`);
});
