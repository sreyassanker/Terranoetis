import 'dotenv/config';
import { fetchGddStationData } from '../server/data/dataFetchers';
async function main(){
  const t0=Date.now();
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const r = await fetchGddStationData(35.68,139.76,start,end);
  console.log('time:', ((Date.now()-t0)/1000).toFixed(1)+'s');
  console.log(r ? `station=${r.station} days=${r.days?.length}` : 'NULL');
}
main();
