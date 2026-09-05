/**
 * AI Chat — Intent Routing Regression Suite
 *
 * Locks in the god-eye contract: every natural-language question routes to the
 * correct deterministic intent, and no valid question is swallowed into a
 * dead end (study-area prompts, over-narrow toggles, bogus model matches).
 * Run: npx vitest run server/__tests__/unit/aiChatIntent.test.ts
 */
import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../../agent';

const route = (q: string) => IntentRouter.classify(q);

describe('deterministic fast paths', () => {
  it('layer toggles', () => {
    expect(route('show earthquakes')).toMatchObject({ type: 'toggle_layer', layerIds: ['earthquakes'] });
    expect(route('show wildfires')).toMatchObject({ type: 'toggle_layer', layerIds: ['wildfires'] });
    expect(route('hide volcanoes')).toMatchObject({ type: 'toggle_layer', layerIds: ['volcanoes'] });
    expect(route('show ships')).toMatchObject({ type: 'toggle_layer', layerIds: ['ais_vessels'] });
    expect(route('track flights')).toMatchObject({ type: 'deep_analysis', layerIds: ['flight_tracks'] });
    expect(route('show space debris')).toMatchObject({ type: 'toggle_layer', layerIds: ['space_debris'] });
    expect(route('show night lights')).toMatchObject({ type: 'toggle_layer', layerIds: ['night_lights'] });
    expect(route('show land cover')).toMatchObject({ type: 'toggle_layer', layerIds: ['land_cover'] });
  });

  it('fly_to commands', () => {
    expect(route('fly to paris').type).toBe('fly_to');
    expect(route('go to tokyo').type).toBe('fly_to');
    expect(route('zoom to london').type).toBe('fly_to');
  });

  it('panel commands (god-eye)', () => {
    expect(route('open analytics workbench')).toMatchObject({ type: 'panel_command', panelId: 'analytics-workbench' });
    expect(route('open satellite tracker')).toMatchObject({ type: 'panel_command', panelId: 'satellite-tracker' });
    expect(route('close settings')).toMatchObject({ type: 'panel_command', panelId: 'settings' });
    expect(route('open ai chat')).toMatchObject({ type: 'panel_command', panelId: 'ai-chat' });
  });
});

describe('new god-eye commands', () => {
  it('opacity commands extract correctly', () => {
    const cmds = IntentRouter.extractCommands('set night lights opacity to 40%');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ action: 'setLayerOpacity', layerId: 'night_lights', opacity: 0.4 });

    const cmds2 = IntentRouter.extractCommands('show earthquakes at 50% opacity');
    expect(cmds2.map(c => c.action)).toContain('toggleLayer');
    expect(cmds2.map(c => c.action)).toContain('setLayerOpacity');
    const op = cmds2.find(c => c.action === 'setLayerOpacity');
    expect(op).toMatchObject({ layerId: 'earthquakes', opacity: 0.5 });
  });

  it('screenshot command extracts correctly', () => {
    expect(IntentRouter.extractCommands('take a screenshot')[0].action).toBe('screenshot');
    expect(IntentRouter.extractCommands('capture the globe')[0].action).toBe('screenshot');
    expect(IntentRouter.extractCommands('save an image')[0].action).toBe('screenshot');
  });
});

describe('data questions route to deep_analysis (never toggles)', () => {
  const cases: Array<[string, string[]?]> = [
    ['what earthquakes happened near japan today', ['earthquakes']],
    ['who disease outbreaks right now', ['who_outbreaks']],
    ['what is the current co2 level', ['climate_co2']],
    ['sandstorm events', ['dust']],
    ['any internet shutdowns recently', ['ioda_outages']],
    ['what is the gdp of japan', ['worldbank_economy']],
  ];
  for (const [q, layer] of cases) {
    it(`"${q}"`, () => {
      const r = route(q);
      expect(r.type).toBe('deep_analysis');
      if (layer) expect(r.layerIds).toEqual(layer);
    });
  }
});

describe('weather_check keeps location questions out of dead ends', () => {
  it('weather with location', () => {
    expect(route('will it rain tomorrow in Kochi')).toMatchObject({ type: 'weather_check' });
    expect(route('air quality in delhi')).toMatchObject({ type: 'weather_check' });
  });
});

describe('no dead ends — uncategorized questions still reach the LLM', () => {
  it('unknown intent keeps confidence below deep-classification threshold', () => {
    const r = route('who won the 2010 world cup');
    // Either deep_analysis or unknown — never a wrong deterministic action.
    expect(['unknown', 'deep_analysis']).toContain(r.type);
  });

  it('pure reasoning questions are not hijacked into toggles/panels', () => {
    expect(route('why do earthquakes happen in japan').type).toBe('deep_analysis');
    expect(route('how does deforestation affect rainfall').type).toBe('deep_analysis');
  });
});

describe('opacity phrasing is never a panel command', () => {
  it('opacity in message does not produce panel_command', () => {
    expect(route('set night lights opacity to 40%').type).not.toBe('panel_command');
    expect(route('show earthquakes at 50% opacity').type).not.toBe('panel_command');
  });
});
