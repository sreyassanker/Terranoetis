import NodeCache from 'node-cache';

export const cache = new NodeCache({ stdTTL: 60, checkperiod: 120, maxKeys: 100 });



