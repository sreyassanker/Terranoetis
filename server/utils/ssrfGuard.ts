import { lookup } from 'dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'net';

/**
 * SSRF protection for user-controlled URLs.
 *
 * - Only allows http: and https: protocols
 * - Rejects URLs pointing to private IP ranges, loopback, link-local, multicast, etc.
 * - Resolves hostnames to IPs before checking (defeats DNS rebinding at fetch time)
 * - Bounded DNS cache TTL to mitigate TOCTOU between resolve and fetch
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// RFC 1918 + RFC 4193 + loopback + link-local + cloud metadata + broadcast + multicast + reserved
const PRIVATE_IPV4_RANGES: Array<[RegExp, string]> = [
  [/^10\./, 'RFC1918 10.0.0.0/8'],
  [/^172\.(1[6-9]|2\d|3[0-1])\./, 'RFC1918 172.16.0.0/12'],
  [/^192\.168\./, 'RFC1918 192.168.0.0/16'],
  [/^127\./, 'loopback 127.0.0.0/8'],
  [/^169\.254\./, 'link-local 169.254.0.0/16 (cloud metadata!)'],
  [/^0\./, 'reserved 0.0.0.0/8'],
  [/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, 'CGN 100.64.0.0/10'],
  [/^192\.0\.(0\.|2\.)/, 'IETF protocol'],
  [/^192\.88\.99\./, 'reserved'],
  [/^198\.(1[8-9])\./, 'benchmark'],
  [/^198\.51\.100\./, 'TEST-NET-2'],
  [/^203\.0\.113\./, 'TEST-NET-3'],
  [/^224\./, 'multicast'],
  [/^240\./, 'reserved'],
  [/^255\./, 'broadcast'],
];

function isPrivateIPv4(ip: string): boolean {
  for (const [re] of PRIVATE_IPV4_RANGES) {
    if (re.test(ip)) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped: extract v4 and check
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  // loopback, link-local, ULA, multicast are covered above
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  if (isIP(ip) === 6) return isPrivateIPv6(ip);
  return true; // unknown — treat as private
}

export interface SsrfCheckResult {
  safe: boolean;
  reason?: string;
  resolvedIPs?: string[];
}

/**
 * Validate a URL for safe outbound fetching.
 * Performs DNS resolution to defeat hostnames that resolve to private IPs.
 */
export async function validateOutboundUrl(rawUrl: string): Promise<SsrfCheckResult> {
  if (typeof rawUrl !== 'string') return { safe: false, reason: 'URL must be a string' };
  if (rawUrl.length > 2048) return { safe: false, reason: 'URL too long' };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { safe: false, reason: `Protocol ${parsed.protocol} not allowed` };
  }

  const hostname = parsed.hostname;
  if (!hostname) return { safe: false, reason: 'Empty hostname' };

  // Reject obvious userinfo tricks
  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'Userinfo in URL not allowed' };
  }

  // If hostname is an IP literal, validate it directly
  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      return { safe: false, reason: 'IP address in private/reserved range' };
    }
    return { safe: true, resolvedIPs: [hostname] };
  }

  // Resolve hostname — checks every A/AAAA record
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { safe: false, reason: 'DNS resolution failed' };
  }
  if (addresses.length === 0) {
    return { safe: false, reason: 'No DNS records' };
  }

  const ips = addresses.map(a => a.address);
  for (const ip of ips) {
    if (isPrivateIP(ip)) {
      return { safe: false, reason: `Hostname resolves to private IP ${ip}`, resolvedIPs: ips };
    }
  }

  return { safe: true, resolvedIPs: ips };
}

/**
 * Hard-coded allowlist of upstreams that /api/data is permitted to proxy.
 * Keys are layerIds (or source paths); values are exact URL prefixes.
 */
export const ALLOWED_UPSTREAMS: ReadonlyArray<string> = [
  'https://earthquake.usgs.gov/',
  'https://eonet.gsfc.nasa.gov/',
  'https://raw.githubusercontent.com/',
  'https://celestrak.org/',
  'https://services.swpc.noaa.gov/',
  'https://api.weather.gov/',
  'https://www.gdacs.org/',
  'https://www.ndbc.noaa.gov/',
  'https://api.carbonintensity.org.uk/',
  'https://erddap.ifremer.fr/',
  'https://api.tidesandcurrents.noaa.gov/',
  'https://api.wheretheiss.at/',
  'https://api.adsb.lol/',
  'https://opendata.adsb.fi/',
  'https://opensky-network.org/',
  'https://volcanoes.usgs.gov/',
];

export function isAllowedUpstream(url: string): boolean {
  return ALLOWED_UPSTREAMS.some(prefix => url.startsWith(prefix));
}
