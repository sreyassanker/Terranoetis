import * as cheerio from 'cheerio';

export interface TokyoVaacAdvisory {
  id: string;
  issuedAt: string;
  volcano: string;
  area: string;
  advisoryNumber: string;
  textUrl?: string;
  source: 'Tokyo VAAC (JMA)';
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
): TokyoVaacAdvisory[] {
  const $ = cheerio.load(html);
  const advisories: TokyoVaacAdvisory[] = [];

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
