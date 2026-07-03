declare module 'vt-pbf' {
  import type { Tile } from '@mapbox/vector-tile';

  function vtPbf(tile: Tile, options?: { extent?: number }): Buffer;

  export default vtPbf;
}
