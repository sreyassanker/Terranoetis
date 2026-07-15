import * as cheerio from 'cheerio';

export interface VaacAdvisory {
  id: string;
  issuedAt: string;
  volcano: string;
  area: string;
  advisoryNumber: string;
  textUrl?: string;
  source: string;
}

function parseUtcTimestamp(value: string): string | undefined {
  const match = value.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

export function parseTokyoVaacHtml(
  html: string,
  baseUrl = 'https://ds.data.jma.go.jp/svd/vaac/data/vaac_list.html',
): VaacAdvisory[] {
  const $ = cheerio.load(html);
  const advisories: VaacAdvisory[] = [];

  $('table.data2 tr.mtx').each((_index, row) => {
    const cells = $(row).find('td');
    if (cells.length < 6) return;
    const issuedAt = parseUtcTimestamp($(cells[0]).text());
    const volcano = $(cells[2]).text().trim();
    const area = $(cells[3]).text().trim();
    const advisoryNumber = $(cells[4]).text().trim();
    if (!issuedAt || !volcano || !advisoryNumber) return;

    const href = $(cells[5]).find('a[href]').attr('href');
    advisories.push({
      id: `${advisoryNumber}-${issuedAt}`,
      issuedAt,
      volcano,
      area,
      advisoryNumber,
      textUrl: href ? new URL(href, baseUrl).toString() : undefined,
      source: 'Tokyo VAAC (JMA)',
    });
  });

  return advisories;
}

export function parseNoaaVaacHtml(
  html: string,
  sourceName: string,
  baseUrl: string,
): VaacAdvisory[] {
  const $ = cheerio.load(html);
  const advisories: VaacAdvisory[] = [];

  // NOAA VAAC list pages use a table with columns: Issue time, Volcano, Area, Advisory Number, Link
  $('table tr').each((_index, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;

    const rawTime = $(cells[0]).text().trim();
    const volcano = $(cells[1]).text().trim();
    const area = $(cells[2]).text().trim();
    const advisoryNumber = $(cells[3]).text().trim();
    if (!rawTime || !volcano) return;

    // Parse NOAA timestamp format: 2025/01/15 12:00:00
    const tsMatch = rawTime.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    const issuedAt = tsMatch
      ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}T${tsMatch[4]}:${tsMatch[5]}:${tsMatch[6]}Z`
      : rawTime;

    const href = $(cells[4]).find('a[href]').attr('href');
    advisories.push({
      id: `${advisoryNumber}-${issuedAt}`,
      issuedAt,
      volcano,
      area,
      advisoryNumber: advisoryNumber || 'N/A',
      textUrl: href ? new URL(href, baseUrl).toString() : undefined,
      source: sourceName,
    });
  });

  return advisories;
}
