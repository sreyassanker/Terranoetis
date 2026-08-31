import { describe, expect, it } from 'vitest';
import { parseTokyoVaacHtml } from '../../utils/vaac';

describe('parseTokyoVaacHtml', () => {
  it('extracts advisories and resolves official text links', () => {
    const html = `<table class="data2">
      <tr class="mtx">
        <td style="display:none">2026/06/18 21:17:00</td>
        <td>21:17 UTC, 18 Jun. 2026</td>
        <td>MAYON</td><td>PHILIPPINES</td><td>2026/701</td>
        <td><a href="TextData/2026/advisory_Text.html">Text</a></td>
      </tr>
    </table>`;

    expect(parseTokyoVaacHtml(html)).toEqual([{
      id: '2026/701-2026-06-18T21:17:00Z',
      issuedAt: '2026-06-18T21:17:00Z',
      volcano: 'MAYON',
      area: 'PHILIPPINES',
      advisoryNumber: '2026/701',
      textUrl: 'https://ds.data.jma.go.jp/svd/vaac/data/TextData/2026/advisory_Text.html',
      source: 'Tokyo VAAC (JMA)',
    }]);
  });

  it('ignores headings and malformed advisory rows', () => {
    const html = '<table class="data2"><tr class="mtx"><td>bad date</td><td>x</td><td></td><td></td><td></td><td></td></tr></table>';
    expect(parseTokyoVaacHtml(html)).toEqual([]);
  });
});
