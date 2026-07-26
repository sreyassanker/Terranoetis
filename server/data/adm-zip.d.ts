declare module 'adm-zip' {
  interface IZipEntry {
    entryName: string;
    getData(): Buffer;
  }
  export default class AdmZip {
    constructor(bufferOrFile?: Buffer | string);
    getEntries(): IZipEntry[];
    getEntry(name: string): IZipEntry | null;
    readAsText(entry: IZipEntry): string;
    writeZip(fileName: string): void;
  }
}
