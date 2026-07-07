export interface FormattedStepResult {
  status: 'success' | 'synthetic' | 'error';
  label: string;
  summary: string;
  metrics: { label: string; value: string }[];
  latencyMs: number;
  raw: string;
  timestamp: string;
}

function fmtTime(ts: number | string | undefined): string {
  if (ts === undefined) return '';
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function eonetCount(events: Array<Record<string, unknown>> | undefined): number {
  if (!Array.isArray(events)) return 0;
  return events.length;
}

function eonetLatestTs(events: Array<Record<string, unknown>> | undefined): number {
  if (!Array.isArray(events)) return 0;
  let latest = 0;
  for (const ev of events) {
    const geoms = ev?.geometry as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(geoms)) {
      for (const g of geoms) {
        const d = String(g.date ?? '');
        if (d) {
          const t = new Date(d).getTime();
          if (t > latest) latest = t;
        }
      }
    }
  }
  return latest;
}

function eonetSeverityCount(events: Array<Record<string, unknown>> | undefined): number {
  if (!Array.isArray(events)) return 0;
  let sev = 0;
  for (const ev of events) {
    const geoms = ev?.geometry as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(geoms)) {
      for (const g of geoms) {
        const mv = Number(g.magnitudeValue ?? 0);
        if (mv > sev) sev = mv;
      }
    }
  }
  return sev;
}

export function formatStepResult(
  toolId: string,
  parsed: Record<string, unknown>,
  latencyMs: number,
): FormattedStepResult {
  if (parsed.error) {
    return { status: 'error', label: 'Error', summary: String(parsed.error), metrics: [], latencyMs, raw: JSON.stringify(parsed).slice(0, 300) };
  }

  const result = (parsed.result as Record<string, unknown>) ?? parsed;
  const isSynthetic = result?.synthetic === true;

  let summary = '';
  let metrics: { label: string; value: string }[] = [];
  let timestamp = '';
  const status = isSynthetic ? 'synthetic' : 'success';

  // Common GeoJSON features array
  const features = result?.features as Array<Record<string, unknown>> | undefined;
  // EONET events array
  const events = result?.events as Array<Record<string, unknown>> | undefined;
  // FIRMS hotspots array
  const hotspots = result?.hotspots as Array<Record<string, unknown>> | undefined;

  switch (toolId) {
    case 'earthquakes':
    case 'seismic_events': {
      if (features && features.length > 0) {
        let maxMag = -Infinity, maxPlace = '', latestTs = 0;
        for (const f of features) {
          const p = f?.properties as Record<string, unknown> | undefined;
          if (p) {
            const mag = Number(p.mag ?? 0);
            if (mag > maxMag) { maxMag = mag; maxPlace = String(p.place ?? ''); }
            const t = Number(p.time ?? 0);
            if (t > latestTs) latestTs = t;
          }
        }
        timestamp = fmtTime(latestTs || undefined);
        summary = `${features.length} seismic event${features.length > 1 ? 's' : ''} detected`;
        if (maxMag > -Infinity) summary += `, largest M ${maxMag.toFixed(1)}${maxPlace ? ' at ' + maxPlace : ''}`;
        metrics = [
          { label: 'Events', value: String(features.length) },
          { label: 'Max Mag', value: maxMag > -Infinity ? maxMag.toFixed(1) : 'N/A' },
        ];
      } else {
        summary = 'No seismic events detected';
        metrics = [{ label: 'Events', value: '0' }];
      }
      break;
    }

    case 'weather_forecast': {
      const current = result?.current as Record<string, unknown> | undefined;
      const cw = result?.current_weather as Record<string, unknown> | undefined;
      const temp = current?.temperature_2m ?? cw?.temperature ?? result?.temperature;
      const humidity = current?.relative_humidity_2m ?? result?.humidity;
      const wind = current?.wind_speed_10m ?? cw?.windspeed ?? result?.windSpeed;
      const code = current?.weather_code ?? cw?.weathercode ?? result?.weather_code;
      const conditions = result?.conditions;
      const timeStr = String(current?.time ?? cw?.time ?? '');
      timestamp = fmtTime(timeStr);
      const WMO_LABELS: Record<number, string> = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Rain', 63: 'Rain', 65: 'Rain', 71: 'Snow', 73: 'Snow', 75: 'Snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
      const label = code !== undefined ? WMO_LABELS[Number(code)] ?? String(code) : conditions;
      summary = label ? `${label}, ${temp ?? '?'}°C` : `${temp ?? '?'}°C at location`;
      if (temp !== undefined) metrics.push({ label: 'Temperature', value: `${temp}°C` });
      if (humidity !== undefined) metrics.push({ label: 'Humidity', value: `${humidity}%` });
      if (wind !== undefined) metrics.push({ label: 'Wind', value: `${wind}${(current?.wind_speed_10m ?? cw?.windspeed) !== undefined ? ' km/h' : ' m/s'}` });
      if (label !== undefined && !conditions) metrics.push({ label: 'Conditions', value: label });
      if (metrics.length === 0) summary = 'Weather data unavailable';
      break;
    }

    case 'wildfires': {
      const count = eonetCount(events);
      if (count > 0) {
        const sev = eonetSeverityCount(events);
        timestamp = fmtTime(eonetLatestTs(events) || undefined);
        summary = `${count} wildfire event${count > 1 ? 's' : ''} detected`;
        if (sev > 0) summary += `, max ${sev} ${events?.[0]?.geometry?.[0]?.magnitudeUnit ?? 'acres'}`;
        metrics = [{ label: 'Wildfires', value: String(count) }];
        if (sev > 0) metrics.push({ label: 'Severity', value: `${sev} ${events?.[0]?.geometry?.[0]?.magnitudeUnit ?? 'acres'}` });
      } else {
        summary = 'No wildfire activity detected';
        metrics = [{ label: 'Wildfires', value: '0' }];
      }
      break;
    }

    case 'firms_fires': {
      if (hotspots && hotspots.length > 0) {
        let latestTs = 0;
        for (const h of hotspots) {
          const d = String(h.acq_date ?? '');
          const t = String(h.acq_time ?? '').padStart(4, '0');
          if (d) {
            const iso = new Date(d + 'T' + t.substring(0, 2) + ':' + t.substring(2, 4));
            if (iso.getTime() > latestTs) latestTs = iso.getTime();
          }
        }
        timestamp = fmtTime(latestTs || undefined);
        summary = `${hotspots.length} fire hotspot${hotspots.length > 1 ? 's' : ''} detected`;
        metrics = [{ label: 'Hotspots', value: String(hotspots.length) }];
      } else {
        summary = 'No fire activity detected';
        metrics = [{ label: 'Hotspots', value: '0' }];
      }
      break;
    }

    case 'storms': {
      const activeStorms = (result?.activeStorms as Array<Record<string, unknown>>) ?? (Array.isArray(result) ? result as unknown as Array<Record<string, unknown>> : []);
      if (activeStorms.length > 0) {
        let maxWind = 0;
        for (const s of activeStorms) {
          const w = Number(s.windSpeed ?? s.wind ?? s.maxWinds ?? s.category ?? 0);
          if (w > maxWind) maxWind = w;
        }
        timestamp = fmtTime(Number(result?.timestamp ?? result?.updated ?? 0) || undefined);
        summary = `${activeStorms.length} tropical storm${activeStorms.length > 1 ? 's' : ''} active`;
        if (maxWind > 0) summary += `, max wind ${maxWind} kt`;
        metrics = [
          { label: 'Storms', value: String(activeStorms.length) },
          { label: 'Max Wind', value: maxWind > 0 ? `${maxWind} kt` : 'N/A' },
        ];
      } else {
        summary = 'No active tropical storms';
        metrics = [{ label: 'Storms', value: '0' }];
      }
      break;
    }

    case 'floods': {
      const count = eonetCount(events);
      if (count > 0) {
        timestamp = fmtTime(eonetLatestTs(events) || undefined);
        summary = `${count} flood event${count > 1 ? 's' : ''} detected`;
        metrics = [{ label: 'Floods', value: String(count) }];
      } else {
        summary = 'No flood data';
        metrics = [{ label: 'Floods', value: '0' }];
      }
      break;
    }

    case 'satellite_analyze': {
      const msg = result?.message as string | undefined;
      const layer = result?.gibsLayer as string | undefined;
      const sType = result?.type as string | undefined;
      timestamp = fmtTime(Number(new Date(String(result?.date ?? ''))));
      summary = msg ?? `Satellite analysis: ${sType ?? 'ndvi'}`;
      if (sType) metrics.push({ label: 'Type', value: sType });
      if (layer) metrics.push({ label: 'Layer', value: String(layer).replace('MODIS_Terra_', '') });
      break;
    }

    case 'sentiment_analyze': {
      const score = result?.sentiment_score; const vol = result?.volume;
      timestamp = fmtTime(Number(result?.timestamp ?? result?.time ?? 0) || undefined);
      summary = 'Social media sentiment analyzed';
      if (score !== undefined) metrics.push({ label: 'Sentiment', value: typeof score === 'number' ? score.toFixed(3) : String(score) });
      if (vol !== undefined) metrics.push({ label: 'Volume', value: String(vol) });
      break;
    }

    case 'radar_fetch': {
      if (features && features.length > 0) {
        // NWS alerts GeoJSON format (fallback)
        let maxSev = '', latestTs = 0;
        const seenEvents = new Set<string>();
        for (const f of features) {
          const p = f?.properties as Record<string, unknown> | undefined;
          if (p) {
            const ev = String(p.event ?? '');
            if (ev) seenEvents.add(ev);
            const sev = String(p.severity ?? '');
            const order = ['Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme'];
            if (order.indexOf(sev) > order.indexOf(maxSev)) maxSev = sev;
            const t = Number(new Date(String(p.effective ?? p.issued ?? '')));
            if (t > latestTs) latestTs = t;
          }
        }
        timestamp = fmtTime(latestTs || undefined);
        summary = `${features.length} weather alert${features.length > 1 ? 's' : ''} in the area`;
        if (seenEvents.size > 0) summary += `: ${[...seenEvents].slice(0, 3).join(', ')}`;
        metrics = [{ label: 'Alerts', value: String(features.length) }, { label: 'Max Severity', value: maxSev || 'N/A' }];
      } else {
        const radar = result?.radar as Record<string, unknown> | undefined;
        const past = radar?.past as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(past) && past.length > 0) {
          const latest = past[past.length - 1];
          const t = Number(latest.time ?? 0);
          timestamp = fmtTime(t * 1000 || undefined);
          const host = String(result?.host ?? '');
          summary = `Radar mosaic — ${past.length} frames available (past 2h)`;
          metrics = [{ label: 'Frames', value: String(past.length) }];
          if (host) metrics.push({ label: 'Coverage', value: 'Global' });
        } else {
          summary = 'Radar data unavailable';
          metrics = [{ label: 'Status', value: 'No frames' }];
        }
      }
      break;
    }

    case 'predict': {
      const preds = result?.predictions as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(preds) && preds.length > 0) {
        let topHazard = '', topProb = 0, topConf = 0;
        for (const p of preds) {
          const prob = Number(p.probability ?? 0);
          if (prob > topProb) {
            topProb = prob;
            topHazard = String(p.hazardType ?? '');
            topConf = Number(p.confidence ?? 0);
          }
        }
        timestamp = fmtTime(Date.now());
        summary = `${preds.length} hazard prediction${preds.length > 1 ? 's' : ''} — top: ${topHazard || 'N/A'}`;
        if (topProb > 0) metrics.push({ label: 'Top Hazard', value: topHazard || 'N/A' });
        if (topProb > 0) metrics.push({ label: 'Probability', value: `${(topProb * 100).toFixed(0)}%` });
        if (topConf > 0) metrics.push({ label: 'Confidence', value: `${(topConf * 100).toFixed(0)}%` });
      } else {
        summary = 'No prediction results';
        metrics = [{ label: 'Predictions', value: '0' }];
      }
      break;
    }

    case 'flood_forecast': {
      const daily = result?.daily as Record<string, unknown> | undefined;
      if (daily) {
        const discharge = daily.river_discharge as number[] | undefined;
        const prob = daily.flood_probability as number[] | undefined;
        const maxDischarge = Array.isArray(discharge) ? Math.max(...discharge.filter(Number.isFinite)) : 0;
        const maxProb = Array.isArray(prob) ? Math.max(...prob.filter(Number.isFinite)) : 0;
        summary = `Flood forecast: discharge ${maxDischarge.toFixed(0)} m³/s, probability ${(maxProb * 100).toFixed(0)}%`;
        metrics = [
          { label: 'Max Discharge', value: `${maxDischarge.toFixed(0)} m³/s` },
          { label: 'Flood Prob', value: `${(maxProb * 100).toFixed(0)}%` },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Flood forecast data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'marine': {
      const daily = result?.daily as Record<string, unknown> | undefined;
      if (daily) {
        const wh = daily.wave_height_max as number[] | undefined;
        const sw = daily.swell_wave_height_max as number[] | undefined;
        const wp = daily.wave_period_max as number[] | undefined;
        const maxWave = Math.max(0, ...(Array.isArray(wh) ? wh.filter(Number.isFinite) : []));
        const maxSwell = Math.max(0, ...(Array.isArray(sw) ? sw.filter(Number.isFinite) : []));
        const maxPeriod = Math.max(0, ...(Array.isArray(wp) ? wp.filter(Number.isFinite) : []));
        summary = `Marine: wave ${maxWave.toFixed(1)}m, swell ${maxSwell.toFixed(1)}m, period ${maxPeriod.toFixed(0)}s`;
        metrics = [
          { label: 'Max Wave', value: `${maxWave.toFixed(1)}m` },
          { label: 'Max Swell', value: `${maxSwell.toFixed(1)}m` },
          { label: 'Period', value: `${maxPeriod.toFixed(0)}s` },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Marine data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'weather_ensemble': {
      const current = result?.current as Record<string, unknown> | undefined;
      if (current) {
        const temp = current.temperature_2m;
        const precip = current.precipitation;
        const wind = current.wind_speed_10m;
        summary = `Ensemble: ${temp ?? '?'}°C, precip ${precip ?? '?'}mm, wind ${wind ?? '?'} km/h`;
        metrics = [
          { label: 'Temperature', value: temp != null ? `${temp}°C` : 'N/A' },
          { label: 'Wind', value: wind != null ? `${wind} km/h` : 'N/A' },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Ensemble data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'seasonal_forecast': {
      const daily = result?.daily as Record<string, unknown> | undefined;
      if (daily) {
        const tMax = daily.temperature_2m_max as number[] | undefined;
        const precip = daily.precipitation_sum as number[] | undefined;
        const avgHigh = Array.isArray(tMax) ? (tMax.filter(Number.isFinite).reduce((a, b) => a + b, 0) / tMax.length).toFixed(1) : '?';
        const totalP = Array.isArray(precip) ? precip.filter(Number.isFinite).reduce((a, b) => a + b, 0).toFixed(0) : '?';
        summary = `Seasonal: avg high ${avgHigh}°C, total precip ${totalP}mm (180d)`;
        metrics = [
          { label: 'Avg High', value: `${avgHigh}°C` },
          { label: 'Total Precip', value: `${totalP}mm` },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Seasonal forecast unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'climate_historical': {
      const daily = result?.daily as Record<string, unknown> | undefined;
      if (daily) {
        const tMax = daily.temperature_2m_max as number[] | undefined;
        const precip = daily.precipitation_sum as number[] | undefined;
        const wind = daily.wind_speed_10m_max as number[] | undefined;
        const avgT = Array.isArray(tMax) ? ((tMax.filter(Number.isFinite).reduce((a, b) => a + b, 0) / tMax.length).toFixed(1)) : '?';
        const totalP = Array.isArray(precip) ? precip.filter(Number.isFinite).reduce((a, b) => a + b, 0).toFixed(0) : '?';
        const days = Array.isArray(tMax) ? tMax.length : 0;
        summary = `Historical: avg ${avgT}°C, ${totalP}mm precip over ${days} days`;
        metrics = [
          { label: 'Avg Temp', value: `${avgT}°C` },
          { label: 'Total Precip', value: `${totalP}mm` },
        ];
        if (Array.isArray(wind) && wind.length > 0) {
          const maxW = Math.max(...wind.filter(Number.isFinite));
          metrics.push({ label: 'Max Wind', value: `${maxW.toFixed(0)} km/h` });
        }
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Historical data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'air_quality': {
      const current = result?.current as Record<string, unknown> | undefined;
      if (current) {
        const aqi = current.us_aqi ?? current.european_aqi;
        const pm25 = current.pm2_5;
        const pm10 = current.pm10;
        const o3 = current.ozone;
        summary = `AQI: ${aqi ?? 'N/A'}, PM2.5: ${pm25 ?? 'N/A'} μg/m³`;
        metrics = [];
        if (aqi != null) metrics.push({ label: 'US AQI', value: String(aqi) });
        if (pm25 != null) metrics.push({ label: 'PM2.5', value: `${pm25} μg/m³` });
        if (pm10 != null) metrics.push({ label: 'PM10', value: `${pm10} μg/m³` });
        if (o3 != null) metrics.push({ label: 'Ozone', value: `${o3} μg/m³` });
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Air quality data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'gfs_forecast': {
      const current = result?.current as Record<string, unknown> | undefined;
      if (current) {
        const temp = current.temperature_2m;
        const precip = current.precipitation;
        const wind = current.wind_speed_10m;
        summary = `GFS: ${temp ?? '?'}°C, precip ${precip ?? '?'}mm, wind ${wind ?? '?'} km/h`;
        metrics = [
          { label: 'Temperature', value: temp != null ? `${temp}°C` : 'N/A' },
          { label: 'Wind', value: wind != null ? `${wind} km/h` : 'N/A' },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'GFS data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'agriculture': {
      const props = result?.properties as Record<string, unknown> | undefined;
      const params = props?.parameter as Record<string, unknown> | undefined;
      const parameters = result?.parameters as Record<string, unknown> | undefined;
      if (params) {
        const tempArr = Object.values(params.T2M as Record<string, number> ?? {}).filter(Number.isFinite) as number[];
        const precipArr = Object.values(params.PRECTOTCORR as Record<string, number> ?? {}).filter(Number.isFinite) as number[];
        const rhArr = Object.values(params.RH2M as Record<string, number> ?? {}).filter(Number.isFinite) as number[];
        const solarArr = Object.values(params.ALLSKY_SFC_SW_DWN as Record<string, number> ?? {}).filter(Number.isFinite) as number[];
        const avgT = tempArr.length > 0 ? tempArr.reduce((a, b) => a + b, 0) / tempArr.length : 0;
        const avgP = precipArr.length > 0 ? precipArr.reduce((a, b) => a + b, 0) / precipArr.length : 0;
        summary = `Agriculture: avg temp ${avgT.toFixed(1)}°C, avg precip ${avgP.toFixed(1)}mm`;
        metrics = [{ label: 'Avg Temp', value: `${avgT.toFixed(1)}°C` }];
        if (avgP > 0) metrics.push({ label: 'Avg Precip', value: `${avgP.toFixed(1)}mm` });
        if (rhArr.length > 0) {
          const avgRh = rhArr.reduce((a, b) => a + b, 0) / rhArr.length;
          metrics.push({ label: 'Avg Humidity', value: `${avgRh.toFixed(1)}%` });
        }
        if (solarArr.length > 0) {
          const avgSol = solarArr.reduce((a, b) => a + b, 0) / solarArr.length;
          metrics.push({ label: 'Avg Solar', value: `${avgSol.toFixed(1)} W/m²` });
        }
        timestamp = fmtTime(Date.now());
      } else if (parameters) {
        const t = parameters.T2M as Record<string, unknown> | undefined;
        const p = parameters.PRECTOTCORR as Record<string, unknown> | undefined;
        const vals = Object.values(t ?? {}).filter(Number.isFinite) as number[];
        const pVals = Object.values(p ?? {}).filter(Number.isFinite) as number[];
        const avgT = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '?';
        const avgP = pVals.length > 0 ? (pVals.reduce((a, b) => a + b, 0) / pVals.length).toFixed(1) : '?';
        summary = `Agriculture: avg temp ${avgT}°C, avg precip ${avgP}mm`;
        metrics = [
          { label: 'Avg Temp', value: `${avgT}°C` },
          { label: 'Avg Precip', value: `${avgP}mm` },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Agriculture data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'gdelt': {
      const articles = result?.articles as Array<Record<string, unknown>> | undefined;
      const total = result?.total ?? result?.totalArticles;
      if (articles || total) {
        const count = Array.isArray(articles) ? articles.length : Number(total ?? 0);
        summary = `${count} GDELT articles on disaster/conflict events`;
        metrics = [
          { label: 'Articles', value: String(count) },
        ];
        if (Array.isArray(articles) && articles.length > 0) {
          const first = articles[0];
          const tone = first.tone ?? first.averagetone;
          if (tone != null) metrics.push({ label: 'Avg Tone', value: typeof tone === 'number' ? tone.toFixed(2) : String(tone) });
        }
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'No GDELT data';
        metrics = [{ label: 'Articles', value: '0' }];
      }
      break;
    }

    case 'population': {
      const pop = result?.totalPopulation ?? result?.population;
      const density = result?.densityPerKm2 ?? result?.density;
      if (pop != null) {
        summary = `Population: ${Number(pop).toLocaleString()} in study area`;
        metrics = [
          { label: 'Population', value: Number(pop).toLocaleString() },
        ];
        if (density != null) metrics.push({ label: 'Density', value: `${Number(density).toFixed(0)}/km²` });
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'Population data unavailable';
        metrics = [{ label: 'Status', value: 'No data' }];
      }
      break;
    }

    case 'space_weather': {
      const notifications = result as Array<Record<string, unknown>> | Record<string, unknown>;
      const arr = Array.isArray(notifications) ? notifications : (notifications?.notifications as Array<Record<string, unknown>> | undefined) ?? [];
      if (arr.length > 0) {
        const flaren = arr.filter((n: Record<string, unknown>) => String(n.messageType ?? n.type ?? '').includes('flare'));
        const cmen = arr.filter((n: Record<string, unknown>) => String(n.messageType ?? n.type ?? '').includes('cme'));
        const storms = arr.filter((n: Record<string, unknown>) => String(n.messageType ?? n.type ?? '').includes('geomagnetic'));
        summary = `${arr.length} space weather notification${arr.length > 1 ? 's' : ''}`;
        metrics = [
          { label: 'Solar Flares', value: String(flaren.length) },
          { label: 'CMEs', value: String(cmen.length) },
          { label: 'Geomagnetic', value: String(storms.length) },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'No space weather events';
        metrics = [{ label: 'Events', value: '0' }];
      }
      break;
    }

    case 'infrastructure': {
      const elements = result?.elements as Array<Record<string, unknown>> | undefined;
      if (elements && elements.length > 0) {
        const buildings = elements.filter((e: Record<string, unknown>) => (e.tags as Record<string, unknown>)?.building || e.type === 'way');
        const roads = elements.filter((e: Record<string, unknown>) => (e.tags as Record<string, unknown>)?.highway);
        const pois = elements.filter((e: Record<string, unknown>) => e.type === 'node');
        summary = `${elements.length} infrastructure features in area`;
        metrics = [
          { label: 'Buildings', value: String(buildings.length) },
          { label: 'Roads', value: String(roads.length) },
          { label: 'POIs', value: String(pois.length) },
        ];
        timestamp = fmtTime(Date.now());
      } else {
        summary = 'No infrastructure data';
        metrics = [{ label: 'Features', value: '0' }];
      }
      break;
    }

    case 'water_resources': {
      const value = result?.value as Record<string, unknown> | undefined;
      if (value) {
        const q = value['00060'] as Record<string, unknown> | undefined;
        const gh = value['00065'] as Record<string, unknown> | undefined;
        const wt = value['00010'] as Record<string, unknown> | undefined;
        summary = 'Water resources data retrieved';
        metrics = [];
        if (q?.value != null) metrics.push({ label: 'Streamflow', value: `${q.value} cfs` });
        if (gh?.value != null) metrics.push({ label: 'Gauge Ht', value: `${gh.value} ft` });
        if (wt?.value != null) metrics.push({ label: 'Water Temp', value: `${wt.value}°C` });
        timestamp = fmtTime(Date.now());
      } else {
        const sites = result?.sites as Array<Record<string, unknown>> | undefined;
        const siteCount = Array.isArray(sites) ? sites.length : ((result?.numberSites ?? result?.count) as number) ?? 0;
        if (siteCount > 0) {
          summary = `${siteCount} USGS water monitoring sites in area`;
          metrics = [{ label: 'Sites', value: String(siteCount) }];
        } else {
          summary = 'Water resources data unavailable';
          metrics = [{ label: 'Sites', value: '0' }];
        }
        timestamp = fmtTime(Date.now());
      }
      break;
    }

    case 'disaster_declarations': {
      const declarations = result?.DisasterDeclarationsSummaries as Array<Record<string, unknown>> | undefined;
      if (declarations && declarations.length > 0) {
        const types = new Set(declarations.map((d: Record<string, unknown>) => d.incidentType).filter(Boolean));
        const latest = declarations[0];
        summary = `${declarations.length} FEMA disaster declarations (${[...types].slice(0, 5).join(', ')})`;
        metrics = [
          { label: 'Declarations', value: String(declarations.length) },
          { label: 'Types', value: String(types.size) },
        ];
        timestamp = fmtTime(String(latest?.declarationDate ?? Date.now()));
      } else {
        summary = 'No FEMA disaster declarations';
        metrics = [{ label: 'Declarations', value: '0' }];
      }
      break;
    }

    default:
      timestamp = fmtTime(Number(result?.timestamp ?? result?.time ?? 0) || undefined);
      summary = 'Tool executed successfully';
      if (result && typeof result === 'object') {
        for (const key of Object.keys(result as Record<string, unknown>)) {
          if (key === 'synthetic' || key === 'confidence') continue;
          const v = (result as Record<string, unknown>)[key];
          metrics.push({ label: key, value: typeof v === 'object' ? JSON.stringify(v).slice(0, 50) : String(v).slice(0, 50) });
        }
      }
  }

  const toolLabel = toolId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { status, label: isSynthetic ? `Estimated (${toolLabel})` : toolLabel, summary, metrics, latencyMs, raw: JSON.stringify(parsed).slice(0, 300), timestamp };
}
