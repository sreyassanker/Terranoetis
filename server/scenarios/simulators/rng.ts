export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return ((this.state >>> 0) / 4294967296);
  }

  nextInt(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextGaussian(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return hash;
}

export function scenarioSeed(type: string, params: Record<string, unknown>): number {
  const paramStr = JSON.stringify(params, Object.keys(params).sort());
  return hashString(type + ':' + paramStr);
}
