export {};

declare global {
  interface Response extends Omit<Response, 'json'> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json(): Promise<any>;
  }
}
