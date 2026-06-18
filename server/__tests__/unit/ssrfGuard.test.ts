import { describe, it, expect } from 'vitest';
import { validateOutboundUrl, isAllowedUpstream } from '../../utils/ssrfGuard';

describe('validateOutboundUrl', () => {
  it('rejects file:// protocol', async () => {
    const r = await validateOutboundUrl('file:///etc/passwd');
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/Protocol/);
  });

  it('rejects loopback URL', async () => {
    const r = await validateOutboundUrl('http://127.0.0.1:3001/api/health');
    expect(r.safe).toBe(false);
  });

  it('allows allowlisted upstream prefix', () => {
    const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
    expect(isAllowedUpstream(url)).toBe(true);
  });
});
