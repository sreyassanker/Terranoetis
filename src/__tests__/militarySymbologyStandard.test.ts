import { describe, expect, it } from 'vitest';
import {
  buildSidc,
  parseSidc,
  getAffiliationColor,
  validateSidc,
  COMMON_SYMBOLS,
  type Affiliation,
  type EntityDomain,
  type Echelon,
} from '../rendering/militarySymbologyStandard';

describe('MIL-STD-2525D / APP-6D Symbology', () => {
  describe('buildSidc', () => {
    it('builds a 20-character SIDC', () => {
      const sidc = buildSidc('friend', 'land');
      expect(sidc).toHaveLength(20);
    });

    it('starts with S for standard', () => {
      const sidc = buildSidc('friend', 'land');
      expect(sidc[0]).toBe('S');
    });

    it('sets affiliation character correctly', () => {
      expect(buildSidc('friend', 'land')[2]).toBe('F');
      expect(buildSidc('hostile', 'land')[2]).toBe('H');
      expect(buildSidc('neutral', 'land')[2]).toBe('N');
      expect(buildSidc('unknown', 'land')[2]).toBe('U');
      expect(buildSidc('pending', 'land')[2]).toBe('P');
    });

    it('sets domain character correctly', () => {
      expect(buildSidc('friend', 'land')[3]).toBe('G');
      expect(buildSidc('friend', 'air')[3]).toBe('A');
      expect(buildSidc('friend', 'sea')[3]).toBe('S');
      expect(buildSidc('friend', 'subsurface')[3]).toBe('U');
      expect(buildSidc('friend', 'cyber')[3]).toBe('W');
    });

    it('includes entity type', () => {
      const sidc = buildSidc('friend', 'land', '131000');
      expect(sidc.slice(4, 10)).toBe('131000');
    });

    it('sets echelon when provided', () => {
      const sidc = buildSidc('friend', 'land', '------', 'company');
      expect(sidc[10]).toBe('E');
    });

    it('uses dash when no echelon', () => {
      const sidc = buildSidc('friend', 'land', '------');
      expect(sidc[10]).toBe('-');
    });

    it('echelon codes are correct', () => {
      const echelons: [Echelon, string][] = [
        ['team', 'A'], ['squad', 'B'], ['section', 'C'], ['platoon', 'D'],
        ['company', 'E'], ['battery', 'F'], ['battalion', 'G'], ['squadron', 'H'],
        ['regiment', 'I'], ['brigade', 'J'], ['division', 'K'], ['corps', 'L'],
        ['army', 'M'], ['army_group', 'N'], ['theater', 'O'],
      ];
      for (const [echelon, code] of echelons) {
        const sidc = buildSidc('friend', 'land', '------', echelon);
        expect(sidc[10]).toBe(code);
      }
    });
  });

  describe('parseSidc', () => {
    it('parses a valid SIDC', () => {
      const sidc = buildSidc('hostile', 'air', 'AFB----', 'squadron');
      const parsed = parseSidc(sidc);
      expect(parsed.affiliation).toBe('hostile');
      expect(parsed.domain).toBe('air');
      expect(parsed.entityType).toBe('AFB----');
      expect(parsed.echelon).toBe('squadron');
    });

    it('returns defaults for short SIDC', () => {
      const parsed = parseSidc('SF');
      expect(parsed.affiliation).toBe('unknown');
      expect(parsed.domain).toBe('unknown');
      expect(parsed.entityType).toBe('------');
      expect(parsed.echelon).toBeNull();
    });

    it('round-trips buildSidc -> parseSidc', () => {
      const affs: Affiliation[] = ['friend', 'hostile', 'neutral', 'unknown', 'pending'];
      const domains: EntityDomain[] = ['land', 'air', 'sea', 'subsurface', 'cyber'];
      for (const aff of affs) {
        for (const dom of domains) {
          const sidc = buildSidc(aff, dom, '123456', 'battalion');
          const parsed = parseSidc(sidc);
          expect(parsed.affiliation).toBe(aff);
          expect(parsed.domain).toBe(dom);
          expect(parsed.entityType).toBe('123456');
          expect(parsed.echelon).toBe('battalion');
        }
      }
    });
  });

  describe('getAffiliationColor', () => {
    it('returns blue for friend', () => {
      expect(getAffiliationColor('friend')).toBe('#4A90D9');
    });

    it('returns red for hostile', () => {
      expect(getAffiliationColor('hostile')).toBe('#FF4444');
    });

    it('returns yellow for neutral', () => {
      expect(getAffiliationColor('neutral')).toBe('#FFD700');
    });

    it('returns white for unknown', () => {
      expect(getAffiliationColor('unknown')).toBe('#FFFFFF');
    });

    it('exercise affiliations match real affiliations', () => {
      expect(getAffiliationColor('exercise_friend')).toBe(getAffiliationColor('friend'));
      expect(getAffiliationColor('exercise_hostile')).toBe(getAffiliationColor('hostile'));
      expect(getAffiliationColor('exercise_neutral')).toBe(getAffiliationColor('neutral'));
    });
  });

  describe('validateSidc', () => {
    it('validates a correct SIDC', () => {
      const sidc = buildSidc('friend', 'land', '131000', 'company');
      const result = validateSidc(sidc);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects short SIDC', () => {
      const result = validateSidc('SF');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('20 characters'))).toBe(true);
    });

    it('rejects invalid first character', () => {
      const result = validateSidc('AFG131000E---------');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid affiliation character', () => {
      const result = validateSidc('SXG131000E---------');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Affiliation'))).toBe(true);
    });

    it('rejects invalid domain character', () => {
      const result = validateSidc('SFX131000E---------');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Domain'))).toBe(true);
    });
  });

  describe('COMMON_SYMBOLS', () => {
    it('contains expected land units', () => {
      expect(COMMON_SYMBOLS.infantry_company).toBeDefined();
      expect(COMMON_SYMBOLS.armor_battalion).toBeDefined();
      expect(COMMON_SYMBOLS.artillery_battery).toBeDefined();
    });

    it('contains expected air units', () => {
      expect(COMMON_SYMBOLS.fighter_squadron).toBeDefined();
      expect(COMMON_SYMBOLS.attack_heli).toBeDefined();
      expect(COMMON_SYMBOLS.recon_uav).toBeDefined();
    });

    it('contains expected sea units', () => {
      expect(COMMON_SYMBOLS.carrier_group).toBeDefined();
      expect(COMMON_SYMBOLS.destroyer).toBeDefined();
      expect(COMMON_SYMBOLS.submarine).toBeDefined();
    });

    it('contains hostile units', () => {
      expect(COMMON_SYMBOLS.hostile_infantry).toBeDefined();
      expect(COMMON_SYMBOLS.hostile_armor).toBeDefined();
      expect(COMMON_SYMBOLS.hostile_missile).toBeDefined();
    });

    it('all symbols are 20 characters', () => {
      for (const [name, sidc] of Object.entries(COMMON_SYMBOLS)) {
        expect(sidc).toHaveLength(20);
      }
    });

    it('all symbols start with S (standard)', () => {
      for (const [name, sidc] of Object.entries(COMMON_SYMBOLS)) {
        expect(sidc[0]).toBe('S');
      }
    });

    it('friend symbols have F affiliation', () => {
      expect(COMMON_SYMBOLS.infantry_company[2]).toBe('F');
      expect(COMMON_SYMBOLS.fighter_squadron[2]).toBe('F');
      expect(COMMON_SYMBOLS.carrier_group[2]).toBe('F');
    });

    it('hostile symbols have H affiliation', () => {
      expect(COMMON_SYMBOLS.hostile_infantry[1]).toBe('H');
      expect(COMMON_SYMBOLS.hostile_armor[1]).toBe('H');
    });
  });
});
