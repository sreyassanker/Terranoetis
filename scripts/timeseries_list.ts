import { getToolConfig } from '../server/analytical-models/toolConfigs';
const ts: number[] = [];
for (let id = 1; id <= 150; id++) if (getToolConfig(id).visualizationType === 'timeseries') ts.push(id);
console.log(ts.join(','));
