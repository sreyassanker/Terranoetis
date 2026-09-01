import 'dotenv/config';
import { fetchSoilData } from '../server/data/dataFetchers';
async function main(){
  for (const [lat,lon,label] of [[39.7,-86.0,'Indiana'],[41.5,-93.6,'Iowa'],[27.5,-81.5,'Florida']] as [number, number, string][]) {
    const t0=Date.now();
    try { const s = await fetchSoilData(lat,lon); console.log(label, ((Date.now()-t0)/1000).toFixed(1)+'s', 'OK sand/silt/clay:', s.sand, s.silt, s.clay); }
    catch(e: unknown){ console.log(label, ((Date.now()-t0)/1000).toFixed(1)+'s', 'ERR:', (e instanceof Error ? e.message : String(e)).slice(0,60)); }
  }
}
main();
