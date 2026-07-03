/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

const cache = new Map<string, { data: unknown; expires: number }>();
function getCached<T>(key: string, _ttlMs?: number): T | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data as T;
  cache.delete(key);
  return null;
}
function setCache(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

const DEFAULT_SYMBOLS = 'SPY,QQQ,DIA,IWM,AAPL,MSFT,GOOGL,AMZN,NVDA,TSLA,META,BTC-USD,ETH-USD';

router.get('/market/quotes', async (req: Request, res: Response) => {
  try {
    const symbolsParam = (req.query.symbols as string) || DEFAULT_SYMBOLS;
    const symbols = symbolsParam.split(',').map(s => s.trim());
    const cacheKey = `pulse:market:${symbols.sort().join(',')}`;
    const cached = getCached<unknown[]>(cacheKey, 60 * 1000);
    if (cached) return res.json({ quotes: cached });

    const finnhubKey = process.env.FINNHUB_API_KEY;
    const stockSymbols = symbols.filter(s => !s.includes('-USD') && !s.includes('USDT'));
    const cryptoSymbols = symbols.filter(s => s.includes('-USD') || s.includes('USDT'));

    const results: unknown[] = [];

    // Finnhub stocks
    if (finnhubKey && stockSymbols.length > 0) {
      const promises = stockSymbols.map(async (symbol) => {
        try {
          const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!resp.ok) return null;
          const data = await resp.json() as { c: number; d: number; dp: number; pc: number };
          if (!data || data.c === 0) return null;
          return {
            symbol, name: symbol, price: data.c, change: data.d,
            changePct: data.dp, source: 'finnhub',
            sparkline: [data.pc * 0.98, data.pc * 0.99, data.pc * 0.97, data.pc * 1.01, data.c * 0.99, data.c],
          };
        } catch { return null; }
      });
      const stockResults = await Promise.all(promises);
      results.push(...stockResults.filter(Boolean));
    }

    // Yahoo Finance fallback for stocks (no key needed)
    if (stockSymbols.length > results.length) {
      const missingSymbols = stockSymbols.filter(s => !results.some((r: any) => r?.symbol === s));
      const promises = missingSymbols.map(async (symbol) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          if (!resp.ok) return null;
          const data = await resp.json() as any;
          const result = data?.chart?.result?.[0];
          if (!result) return null;
          const meta = result.meta || {};
          const prices = (result.indicators?.quote?.[0]?.close || []).filter((v: number | null) => v != null);
          return {
            symbol, name: symbol, price: meta.regularMarketPrice,
            change: meta.regularMarketPrice - (meta.chartPreviousClose || 0),
            changePct: meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : 0,
            source: 'yahoo',
            sparkline: prices.length >= 2 ? prices : undefined,
          };
        } catch { return null; }
      });
      const yahooResults = await Promise.all(promises);
      results.push(...yahooResults.filter(Boolean));
    }

    // CoinGecko crypto
    if (cryptoSymbols.length > 0) {
      const cgIds = cryptoSymbols.map(s => {
        const base = s.replace(/-(USD|USDT)/, '').toLowerCase();
        const map: Record<string, string> = { btc: 'bitcoin', eth: 'ethereum', sol: 'solana', xrp: 'ripple', ada: 'cardano', dot: 'polkadot', link: 'chainlink', matic: 'polygon', avax: 'avalanche-2' };
        return map[base] || base;
      });
      try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const data = await resp.json() as Record<string, { usd?: number; usd_24h_change?: number }>;
          for (let i = 0; i < cryptoSymbols.length; i++) {
            const entry = data[cgIds[i]!];
            if (entry?.usd) {
              results.push({
                symbol: cryptoSymbols[i], name: cryptoSymbols[i]!.replace(/-(USD|USDT)/, '/USD'),
                price: entry.usd, change: 0, changePct: entry.usd_24h_change ?? 0,
                source: 'coingecko', sparkline: undefined,
              });
            }
          }
        }
      } catch { /* ignore */ }
    }

    setCache(cacheKey, results, 60 * 1000);
    res.json({ quotes: results });
  } catch {
    res.status(500).json({ error: 'Failed to fetch market quotes' });
  }
});

router.get('/market/candle', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'SPY';
    const rawRange = (req.query.range as string) || '1M';
    const rangeMap: Record<string, string> = {
      '5d': '5d', '1m': '1mo', '6m': '6mo', '1y': '1y', '5y': '5y',
      '1D': '1d', '1W': '5d', '1M': '1mo', '3M': '3mo', '1Y': '1y',
    };
    const yahooRange = rangeMap[rawRange] || '1mo';

    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      const now = Math.floor(Date.now() / 1000);
      const secondsMap: Record<string, number> = { '5d': 432000, '1m': 2592000, '6m': 15552000, '1y': 31536000, '5y': 157680000, '1D': 86400, '1W': 604800, '1M': 2592000, '3M': 7776000, '1Y': 31536000 };
      const from = now - (secondsMap[rawRange] || 2592000);
      const resolution = rawRange === '5d' ? '30' : rawRange === '1m' || rawRange === '1M' ? 'D' : rawRange === '6m' ? 'D' : rawRange === '1y' || rawRange === '1Y' ? 'W' : 'M';
      const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${now}&token=${finnhubKey}`;
      const resp = await fetch(url);
      const data = await resp.json() as any;
      if (data.s === 'ok' && data.c) {
        const candles = data.c.map((close: number, i: number) => ({
          time: data.t?.[i] ?? 0, open: data.o?.[i] ?? 0, high: data.h?.[i] ?? 0,
          low: data.l?.[i] ?? 0, close, volume: data.v?.[i] ?? 0,
        }));
        return res.json({ candles, symbol, range: rawRange });
      }
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${yahooRange}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return res.json({ candles: [], error: 'No data available' });
    const data = await resp.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return res.json({ candles: [], error: 'No data available' });
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const candles = timestamps.map((t: number, i: number) => ({
      time: t, open: quotes.open?.[i], high: quotes.high?.[i],
      low: quotes.low?.[i], close: quotes.close?.[i], volume: quotes.volume?.[i],
    })).filter((c: any) => c.close != null);
    res.json({ candles, symbol, range: rawRange });
  } catch {
    res.status(500).json({ error: 'Failed to fetch candle data' });
  }
});

router.get('/energy/prices', async (_req: Request, res: Response) => {
  try {
    const cached = getCached<unknown[]>('pulse:energy', 15 * 60 * 1000);
    if (cached) return res.json({ prices: cached });

    const results: unknown[] = [];
    const eiaKey = process.env.EIA_API_KEY;

    // EIA data (WTI, Brent, NatGas)
    if (eiaKey) {
      const seriesMap: Record<string, string> = { wti: 'RWTC', brent: 'RBRTE', natgas: 'RNGWHHD' };
      for (const [id, series] of Object.entries(seriesMap)) {
        try {
          const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${eiaKey}&frequency=daily&data[0]=value&facets[series][]=${series}&sort[0][column]=period&sort[0][direction]=desc&length=5`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!resp.ok) continue;
          const data = await resp.json() as any;
          const rows = data.response?.data ?? [];
          if (rows.length >= 2) {
            const current = parseFloat(rows[0]!.value);
            const prev = parseFloat(rows[1]!.value);
            const changePct = prev ? ((current - prev) / prev) * 100 : 0;
            results.push({ id, name: id === 'wti' ? 'WTI Crude' : id === 'brent' ? 'Brent Crude' : 'Natural Gas', current, changePct: Math.round(changePct * 10) / 10, unit: id === 'natgas' ? '$/MMBtu' : '$/bbl', trend: changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'stable', source: 'eia' });
          }
        } catch { /* skip */ }
      }
    }

    // Yahoo Finance fallback for energy commodities
    try {
      const yahooCommodities: Array<{ id: string; symbol: string; name: string; unit: string }> = [
        { id: 'wti', symbol: 'CL=F', name: 'WTI Crude', unit: '$/bbl' },
        { id: 'brent', symbol: 'BZ=F', name: 'Brent Crude', unit: '$/bbl' },
        { id: 'natgas', symbol: 'NG=F', name: 'Natural Gas', unit: '$/MMBtu' },
        { id: 'gold', symbol: 'GC=F', name: 'Gold', unit: '$/oz' },
        { id: 'silver', symbol: 'SI=F', name: 'Silver', unit: '$/oz' },
        { id: 'copper', symbol: 'HG=F', name: 'Copper', unit: '$/lb' },
        { id: 'gasoline', symbol: 'RB=F', name: 'Gasoline RBOB', unit: '$/gal' },
      ];
      for (const commodity of yahooCommodities) {
        if (results.some((r: any) => r.id === commodity.id)) continue;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${commodity.symbol}?interval=1d&range=5d`;
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!resp.ok) continue;
        const data = await resp.json() as any;
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          const prevClose = meta.chartPreviousClose || meta.regularMarketPrice;
          const changePct = prevClose ? ((meta.regularMarketPrice - prevClose) / prevClose) * 100 : 0;
          results.push({ id: commodity.id, name: commodity.name, current: meta.regularMarketPrice, changePct: Math.round(changePct * 10) / 10, unit: commodity.unit, trend: changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'stable', source: 'yahoo' });
        }
      }
    } catch { /* ignore */ }

    if (results.length === 0) {
      results.push(
        { id: 'wti', name: 'WTI Crude', current: 0, changePct: 0, unit: '$/bbl', trend: 'stable', source: 'offline' },
        { id: 'brent', name: 'Brent Crude', current: 0, changePct: 0, unit: '$/bbl', trend: 'stable', source: 'offline' },
      );
    }

    setCache('pulse:energy', results, 15 * 60 * 1000);
    res.json({ prices: results });
  } catch {
    res.status(500).json({ error: 'Failed to fetch energy prices' });
  }
});

router.get('/energy/history', async (req: Request, res: Response) => {
  try {
    const series = (req.query.series as string) || 'CL=F';
    const rawRange = (req.query.range as string) || '3mo';
    const rangeMap: Record<string, string> = {
      '5d': '5d', '1m': '1mo', '6m': '6mo', '1y': '1y', '5y': '5y',
    };
    const yahooRange = rangeMap[rawRange] || '3mo';
    const yahooMap: Record<string, string> = { wti: 'CL=F', brent: 'BZ=F', natgas: 'NG=F', gold: 'GC=F', silver: 'SI=F', copper: 'HG=F' };
    const yahooSymbol = yahooMap[series] || series;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=${yahooRange}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return res.json({ data: [], series });
    const data = await resp.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return res.json({ data: [], series });
    const closes = (result.indicators?.quote?.[0]?.close || []).filter((v: number | null) => v != null);
    const history = closes.map((v: number) => ({ value: v }));
    res.json({ data: history, series });
  } catch {
    res.status(500).json({ error: 'Failed to fetch energy history' });
  }
});

router.get('/geopolitical/risks', async (_req: Request, res: Response) => {
  try {
    const cached = getCached<unknown[]>('pulse:geo', 30 * 60 * 1000);
    if (cached) return res.json({ risks: cached });

    const countries = [
      { code: 'UA', name: 'Ukraine', coords: { lat: 48.3794, lon: 31.1656 } },
      { code: 'TW', name: 'Taiwan Strait', coords: { lat: 23.6978, lon: 120.9605 } },
      { code: 'IL', name: 'Middle East', coords: { lat: 31.0461, lon: 34.8516 } },
      { code: 'CN', name: 'South China Sea', coords: { lat: 15.0, lon: 115.0 } },
      { code: 'KP', name: 'Korean Peninsula', coords: { lat: 40.3399, lon: 127.5101 } },
      { code: 'ML', name: 'Sahel Region', coords: { lat: 17.5707, lon: -3.9962 } },
      { code: 'YE', name: 'Red Sea', coords: { lat: 15.0, lon: 45.0 } },
      { code: 'SD', name: 'Sudan', coords: { lat: 15.0, lon: 30.0 } },
      { code: 'MM', name: 'Myanmar', coords: { lat: 22.0, lon: 96.0 } },
      { code: 'RS', name: 'Balkans', coords: { lat: 44.0, lon: 21.0 } },
    ];

    // Fetch live data from WarScope API
    const risks: Array<{
      country: string; code: string; score: number; level: string; delta: number;
      briefing?: string; event_count?: number;
    }> = [];

    for (const c of countries) {
      try {
        const url = `https://warscope.net/api/briefing?country=${encodeURIComponent(c.name)}&days=7`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const data = await resp.json() as any;
          const classification = (data.classification || 'LOW').toLowerCase();
          const levelMap: Record<string, string> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
          const level = levelMap[classification] || 'low';
          const scoreMap: Record<string, number> = { critical: 85, high: 65, medium: 45, low: 25 };
          const baseScore = scoreMap[level] || 25;
          const eventCount = data.event_count || 0;
          const fatalities = data.total_fatalities || 0;
          const score = Math.min(100, baseScore + eventCount * 3 + (fatalities > 0 ? 15 : 0));
          risks.push({
            country: c.name,
            code: c.code,
            score,
            level,
            delta: eventCount > 50 ? 3 : eventCount > 20 ? 1 : eventCount > 0 ? -1 : -2,
            briefing: data.summary || undefined,
            event_count: eventCount,
          });
        }
      } catch { /* skip */ }
    }

    // Fallback to static data if WarScope fails
    if (risks.length === 0) {
      const fallback = [
        { country: 'Ukraine', code: 'UA', score: 85, level: 'critical', delta: 2 },
        { country: 'Taiwan Strait', code: 'TW', score: 72, level: 'high', delta: -1 },
        { country: 'Middle East', code: 'IL', score: 78, level: 'high', delta: 5 },
        { country: 'South China Sea', code: 'CN', score: 65, level: 'medium', delta: 0 },
        { country: 'Korean Peninsula', code: 'KP', score: 58, level: 'medium', delta: -2 },
        { country: 'Sahel Region', code: 'ML', score: 62, level: 'medium', delta: 3 },
        { country: 'Red Sea', code: 'YE', score: 70, level: 'high', delta: 4 },
        { country: 'Sudan', code: 'SD', score: 74, level: 'high', delta: 6 },
        { country: 'Myanmar', code: 'MM', score: 55, level: 'medium', delta: -1 },
        { country: 'Balkans', code: 'RS', score: 42, level: 'low', delta: -1 },
      ];
      setCache('pulse:geo', fallback, 60 * 60 * 1000);
      return res.json({ risks: fallback });
    }

    setCache('pulse:geo', risks, 30 * 60 * 1000);
    res.json({ risks });
  } catch {
    res.status(500).json({ error: 'Failed to fetch geopolitical risks' });
  }
});

router.get('/correlation/cards', async (_req: Request, res: Response) => {
  try {
    const cached = getCached<unknown[]>('pulse:corr', 10 * 60 * 1000);
    if (cached) return res.json({ cards: cached });

    const cards: unknown[] = [];

    // 1. Cross-asset correlation: fetch S&P 500 and WTI, compute correlation
    try {
      const [spyResp, wtiResp] = await Promise.allSettled([
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1mo', {
          headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000),
        }),
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/CL=F?interval=1d&range=1mo', {
          headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000),
        }),
      ]);

      if (spyResp.status === 'fulfilled' && wtiResp.status === 'fulfilled') {
        const spyData = await spyResp.value.json() as any;
        const wtiData = await wtiResp.value.json() as any;
        const spyCloses = spyData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((v: number | null) => v != null) || [];
        const wtiCloses = wtiData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((v: number | null) => v != null) || [];
        if (spyCloses.length >= 5 && wtiCloses.length >= 5) {
          const minLen = Math.min(spyCloses.length, wtiCloses.length);
          const spy = spyCloses.slice(-minLen);
          const wti = wtiCloses.slice(-minLen);
          const spyMean = spy.reduce((a: number, b: number) => a + b, 0) / spy.length;
          const wtiMean = wti.reduce((a: number, b: number) => a + b, 0) / wti.length;
          const num = spy.reduce((sum: number, v: number, i: number) => sum + (v - spyMean) * (wti[i]! - wtiMean), 0);
          const den = Math.sqrt(spy.reduce((sum: number, v: number) => sum + (v - spyMean) ** 2, 0) * wti.reduce((sum: number, v: number) => sum + (v - wtiMean) ** 2, 0));
          const corr = den ? num / den : 0;
          if (Math.abs(corr) > 0.3) {
            cards.push({
              id: 'corr_spy_wti',
              domain: 'economic',
              title: `SPY ⇄ WTI: ${(corr * 100).toFixed(0)}% correlation`,
              score: Math.round(Math.abs(corr) * 100),
              trend: corr > 0 ? 'escalating' : 'de-escalating',
              signals: minLen,
              assessment: corr > 0
                ? `Positive correlation suggests oil price movement aligns with equity markets — risk-on/risk-off regime.`
                : `Negative correlation suggests oil is acting as a hedge against equity moves — possible supply-shock regime.`,
            });
          }
        }
      }
    } catch { /* ignore */ }

    // 2. Gold & USD negative correlation (classic hedge)
    try {
      const [goldResp, dxyResp] = await Promise.allSettled([
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1mo', {
          headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000),
        }),
        fetch('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=1mo', {
          headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000),
        }),
      ]);
      if (goldResp.status === 'fulfilled' && dxyResp.status === 'fulfilled') {
        const gData = await goldResp.value.json() as any;
        const dData = await dxyResp.value.json() as any;
        const gCloses = gData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((v: number | null) => v != null) || [];
        const dCloses = dData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((v: number | null) => v != null) || [];
        if (gCloses.length >= 5 && dCloses.length >= 5) {
          const minLen = Math.min(gCloses.length, dCloses.length);
          cards.push({
            id: 'corr_gold_dxy',
            domain: 'economic',
            title: `Gold ⇄ DXY: Gold ${gCloses[gCloses.length-1]! > gCloses[0]! ? 'rising' : 'falling'} vs Dollar`,
            score: Math.round(gCloses[gCloses.length-1]! > gCloses[0]! ? 65 : 40),
            trend: gCloses[gCloses.length-1]! > gCloses[0]! ? 'escalating' : 'de-escalating',
            signals: minLen,
            assessment: gCloses[gCloses.length-1]! > gCloses[0]!
              ? 'Gold trending up — potential dollar weakness or flight-to-safety regime.'
              : 'Gold consolidating — dollar strength or risk-on sentiment prevailing.',
          });
        }
      }
    } catch { /* ignore */ }

    // 3. Geopolitical + energy correlation
    try {
      const geoResp = await fetch('https://warscope.net/api/hotspots', { signal: AbortSignal.timeout(5000) });
      if (geoResp.ok) {
        const geoData = await geoResp.json() as any;
        const hotspots = geoData.hotspots || [];
        if (hotspots.length > 0) {
          cards.push({
            id: 'corr_geo_energy',
            domain: 'military',
            title: `${hotspots.length} active conflict zones detected`,
            score: Math.min(100, hotspots.length * 20),
            trend: hotspots.length > 5 ? 'escalating' : 'stable',
            signals: hotspots.length,
            assessment: `${hotspots.length} active conflict zones may impact energy supply chains and risk premiums.`,
          });
        }
      }
    } catch { /* ignore */ }

    // 4. Xoomar sentiment divergence
    try {
      const resp = await fetch('https://xoomar.com/api/markets/sentiment', { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json() as any;
        const assets = data.data || [];
        const divergences = assets
          .filter((a: any) => a.window === '24h' && a.newsScore != null && a.crowdScore != null)
          .filter((a: any) => Math.abs(a.newsScore - a.crowdScore) > 0.5);
        if (divergences.length > 0) {
          const topDiv = divergences[0]!;
          cards.push({
            id: 'sentiment_divergence',
            domain: 'economic',
            title: `Sentiment divergence: ${topDiv.name}`,
            score: Math.min(100, Math.round(Math.abs(topDiv.newsScore - topDiv.crowdScore) * 100)),
            trend: 'escalating',
            signals: divergences.length,
            assessment: `News sentiment (${(topDiv.newsScore * 100).toFixed(0)}%) diverges from crowd positioning (${(topDiv.crowdScore * 100).toFixed(0)}%) — potential reversal signal.`,
          });
        }
      }
    } catch { /* ignore */ }

    // 5. Global event density
    try {
      const eqResp = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', { signal: AbortSignal.timeout(5000) });
      if (eqResp.ok) {
        const eqData = await eqResp.json() as any;
        const features = eqData.features || [];
        const m4plus = features.filter((f: any) => (f.properties?.mag || 0) >= 4);
        if (m4plus.length >= 3) {
          cards.push({
            id: 'seismic_cluster',
            domain: 'disaster',
            title: `${m4plus.length} significant earthquakes (M4+) in past 48 hours`,
            score: Math.min(100, m4plus.length * 15),
            trend: m4plus.length > 10 ? 'escalating' : 'stable',
            signals: m4plus.length,
            assessment: `${m4plus.length} earthquakes M4+ in 48h — elevated tectonic activity may indicate broader geological unrest.`,
          });
        }
      }
    } catch { /* ignore */ }

    setCache('pulse:corr', cards, 10 * 60 * 1000);
    res.json({ cards });
  } catch {
    res.status(500).json({ error: 'Failed to fetch correlation cards' });
  }
});

router.get('/sentiment', async (_req: Request, res: Response) => {
  try {
    const cached = getCached<unknown>('pulse:sentiment', 30 * 60 * 1000);
    if (cached) return res.json(cached);

    const url = 'https://xoomar.com/api/markets/sentiment';
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return res.json({ data: [], error: 'Failed to fetch sentiment' });
    const data = await resp.json();
    setCache('pulse:sentiment', data, 30 * 60 * 1000);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to fetch sentiment data' });
  }
});

router.get('/heatmap', async (_req: Request, res: Response) => {
  try {
    const cached = getCached<unknown[]>('pulse:heatmap', 5 * 60 * 1000);
    if (cached) return res.json({ assets: cached });

    const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META',
      'GC=F', 'CL=F', 'BZ=F', 'NG=F', 'SI=F', 'BTC-USD', 'ETH-USD', 'SOL-USD'];
    const results: Array<{ symbol: string; price: number | null; changePct: number | null }> = [];

    // Batch queries with concurrency limit of 5
    const concurrency = 5;
    for (let i = 0; i < symbols.length; i += concurrency) {
      const batch = symbols.slice(i, i + concurrency);
      const promises = batch.map(async (symbol) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          if (!resp.ok) return { symbol, price: null, changePct: null };
          const data = await resp.json() as any;
          const meta = data?.chart?.result?.[0]?.meta;
          if (!meta?.regularMarketPrice) return { symbol, price: null, changePct: null };
          const prevClose = meta.chartPreviousClose || meta.regularMarketPrice;
          const changePct = prevClose ? ((meta.regularMarketPrice - prevClose) / prevClose) * 100 : 0;
          return { symbol, price: meta.regularMarketPrice, changePct: Math.round(changePct * 100) / 100 };
        } catch {
          return { symbol, price: null, changePct: null };
        }
      });
      const resolved = await Promise.all(promises);
      results.push(...resolved.filter(r => r.price != null));
    }

    setCache('pulse:heatmap', results, 5 * 60 * 1000);
    res.json({ assets: results });
  } catch {
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

export const pulseRouter = router;
