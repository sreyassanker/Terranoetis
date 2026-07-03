declare module 'papaparse' {
  interface ParseResult<T> {
    data: T[];
    errors: Array<{ type: string; code: string; message: string; row: number }>;
    meta: {
      delimiter: string;
      linebreak: string;
      aborted: boolean;
      fields: string[];
      truncated: boolean;
    };
  }

  interface ParseConfig<T> {
    delimiter?: string;
    newline?: string;
    quoteChar?: string;
    escapeChar?: string;
    header?: boolean;
    dynamicTyping?: boolean;
    preview?: number;
    encoding?: string;
    worker?: boolean;
    comments?: boolean | string;
    step?: (results: ParseResult<T>, parser: unknown) => void;
    complete?: (results: ParseResult<T>, file: File) => void;
    error?: (error: Error, file: File) => void;
    download?: boolean;
    downloadRequestHeaders?: Record<string, string>;
    downloadChunkSize?: number;
    skipEmptyLines?: boolean | 'greedy';
    chunk?: (results: ParseResult<T>, parser: unknown) => void;
    fastMode?: boolean;
    beforeFirstChunk?: (chunk: string) => string;
    withCredentials?: boolean;
    transform?: (value: string, field: string | number) => unknown;
    delimitersToGuess?: string[];
  }

  const Papa: {
    parse: <T = Record<string, unknown>>(file: File | string, config?: ParseConfig<T>) => ParseResult<T>;
  };

  export default Papa;
}
