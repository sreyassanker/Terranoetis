declare module 'pngjs' {
  import { Stream } from 'stream';

  interface PNGOptions {
    width?: number;
    height?: number;
    fill?: boolean;
    filterType?: number;
    inputHasAlpha?: boolean;
    inputColorType?: number;
    bitDepth?: number;
    colorType?: number;
    deflateChunkSize?: number;
    deflateLevel?: number;
    deflateStrategy?: number;
  }

  interface RGB {
    r: number;
    g: number;
    b: number;
  }

  class PNG extends Stream {
    static sync: {
      read(buffer: Buffer, options?: PNGOptions): PNG;
      write(png: PNG, options?: PNGOptions): Buffer;
    };

    constructor(options?: PNGOptions);

    width: number;
    height: number;
    data: Buffer;
    alpha: boolean;

    on(event: 'parsed', callback: () => void): this;
    on(event: string, callback: (...args: unknown[]) => void): this;

    pack(): PNG;
    parse(data: Buffer, callback?: (error: Error | null, png: PNG) => void): PNG;
  }

  export { PNG, PNGOptions, RGB };
}
