import 'dotenv/config';
import { fetchGddStationData } from '../server/data/dataFetchers';
async function main(){
  const t0=Date.now();
  const r = await fetchGddStationData(35.68,139.76,30);
  console.log('time:', ((Date.now()-t0)/1000).toFixed(1)+'s');
  console.log(r ? `station=${r.station} days=${r.days?.length}` : 'NULL');
}
main();
