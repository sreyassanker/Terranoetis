import type { DisasterType, EnvironmentSnapshot, ValidationCheck, ValidationReport } from "../core/types";

type Rule = (env: EnvironmentSnapshot) => ValidationCheck;

const pct = (f: number) => `${(f * 100).toFixed(1)}%`;

const RULES: Record<string, Rule[]> = {
  tsunami: [
    (env) => ({
      id: "ocean-connectivity", label: "Ocean connectivity",
      status: env.stats.oceanConnected && env.stats.oceanFraction > 0.02 ? "pass" : "fail",
      measured: pct(env.stats.oceanFraction),
      detail: env.stats.oceanConnected
        ? `Open water covers ${pct(env.stats.oceanFraction)} of the domain and connects to the boundary — a tsunami can propagate in from offshore.`
        : "No water body connected to the domain edge was found. A tsunami physically requires a connected ocean or large sea; it cannot occur in a landlocked or dry region.",
    }),
    (env) => ({
      id: "coastline", label: "Coastline presence",
      status: env.stats.coastlineLengthM > 500 ? "pass" : "fail",
      measured: `${Math.round(env.stats.coastlineLengthM)} m`,
      detail: env.stats.coastlineLengthM > 500
        ? `Detected ~${(env.stats.coastlineLengthM / 1000).toFixed(1)} km of coastline for wave run-up.`
        : "No meaningful land–water interface exists inside the study area, so inundation cannot be simulated.",
    }),
    (env) => ({
      id: "coastal-elevation", label: "Coastal elevation profile",
      status: env.stats.minElevationM < 15 ? "pass" : "warn",
      measured: `${env.stats.minElevationM.toFixed(0)} m min`,
      detail: env.stats.minElevationM < 15
        ? "Low-lying coastal terrain is present; significant inundation is plausible."
        : "The lowest terrain is high above sea level — expect very limited inundation even for a large wave.",
    }),
  ],

  flood: [
    (env) => {
      const hasDriver = env.stats.riverFraction > 0.005 || env.weather.precipitationMmHr > 0.5;
      return {
        id: "water-source", label: "Water source (rivers / rainfall)",
        status: hasDriver ? "pass" : env.stats.minElevationM < 10 ? "warn" : "fail",
        measured: `rivers ${pct(env.stats.riverFraction)}, rain ${env.weather.precipitationMmHr} mm/h`,
        detail: hasDriver
          ? "A drainage network and/or active precipitation provides a physical water source for flooding."
          : "No river network and no current rainfall was detected. Flooding requires a water input; the simulation will be rejected unless rainfall is added to the scenario.",
      } as ValidationCheck;
    },
    (env) => ({
      id: "relief", label: "Terrain relief and ponding potential",
      status: env.stats.meanSlopeDeg < 25 ? "pass" : "warn",
      measured: `${env.stats.meanSlopeDeg.toFixed(1)}° mean slope`,
      detail: env.stats.meanSlopeDeg < 25
        ? "Terrain gradients allow accumulation and realistic overland flow."
        : "Extremely steep terrain drains rapidly — expect flash-flood channels rather than widespread ponding.",
    }),
  ],

  cyclone: [
    (env) => ({
      id: "ocean-energy", label: "Ocean interaction",
      status: env.stats.oceanFraction > 0.05 ? "pass" : "warn",
      measured: pct(env.stats.oceanFraction),
      detail: env.stats.oceanFraction > 0.05
        ? "Adjacent open water sustains cyclone energy and enables storm surge."
        : "Little or no ocean in the domain: the cyclone will be simulated as a decaying landfallen system with no storm surge.",
    }),
    (env) => {
      const lat = Math.abs((env.rectangle.north + env.rectangle.south) / 2) * 180 / Math.PI;
      const status = lat >= 5 && lat <= 45 ? "pass" : lat < 5 ? "fail" : "warn";
      return {
        id: "latitude", label: "Latitude band (Coriolis)",
        status, measured: `${lat.toFixed(1)}°`,
        detail: status === "fail"
          ? "Within ~5° of the equator the Coriolis force is too weak for cyclonic rotation to form — tropical cyclones do not occur here."
          : status === "warn"
            ? "High latitude: only an extratropical transition remnant is physically plausible."
            : "Latitude falls within the climatological tropical cyclone band.",
      } as ValidationCheck;
    },
  ],

  wildfire: [
    (env) => ({
      id: "fuel", label: "Fuel availability (vegetation)",
      status: env.stats.vegetationFraction > 0.15 ? "pass"
        : env.stats.vegetationFraction > 0.05 ? "warn" : "fail",
      measured: pct(env.stats.vegetationFraction),
      detail: env.stats.vegetationFraction > 0.15
        ? `Vegetated land covers ${pct(env.stats.vegetationFraction)} of the area — sufficient fuel for sustained fire spread.`
        : env.stats.vegetationFraction > 0.05
          ? "Sparse vegetation: fire will spread patchily and self-extinguish quickly."
          : "There is essentially no combustible vegetation (open water, bare ground, or built surface dominates). A wildfire cannot ignite or spread here.",
    }),
    (env) => ({
      id: "not-water", label: "Land presence",
      status: env.stats.oceanFraction < 0.9 ? "pass" : "fail",
      measured: pct(1 - env.stats.oceanFraction),
      detail: env.stats.oceanFraction < 0.9
        ? "The domain contains burnable land."
        : "The study area is almost entirely open water — wildfire is physically impossible.",
    }),
    (env) => ({
      id: "fire-weather", label: "Fire weather",
      status: env.weather.relativeHumidityPct < 70 && env.weather.precipitationMmHr < 1 ? "pass" : "warn",
      measured: `RH ${env.weather.relativeHumidityPct}%, rain ${env.weather.precipitationMmHr} mm/h`,
      detail: env.weather.relativeHumidityPct < 70 && env.weather.precipitationMmHr < 1
        ? "Current humidity and precipitation permit fire growth."
        : "High humidity or active rainfall will strongly suppress spread; the simulation will reflect reduced intensity.",
    }),
  ],

  earthquake: [
    (env) => {
      const q = env.hazards.significantQuakesWithin100Km;
      return {
        id: "seismicity", label: "Historical seismicity / fault proximity",
        status: q.length >= 3 ? "pass" : q.length >= 1 ? "warn" : "fail",
        measured: `${q.length} M4.5+ events within 100 km since 1950`,
        detail: q.length >= 3
          ? `Active seismic zone: ${q.length} significant earthquakes recorded nearby (largest M${Math.max(...q.map(e => e.magnitude)).toFixed(1)}).`
          : q.length >= 1
            ? "Only isolated historical events — a large rupture here is unusual but not impossible; intensity will be capped."
            : "No significant earthquakes recorded within 100 km since 1950 and no evidence of active faulting. A damaging earthquake scenario is not scientifically supportable in this region.",
      } as ValidationCheck;
    },
  ],

  volcano: [
    (env) => {
      const v = env.hazards.volcanoesWithin50Km;
      return {
        id: "volcanism", label: "Holocene volcanic activity",
        status: v.length > 0 ? "pass" : "fail",
        measured: `${v.length} volcanoes within 50 km`,
        detail: v.length > 0
          ? `Found ${v.map(x => x.name).join(", ")} — an eruption scenario is geologically grounded and will originate at the real vent location.`
          : "The Smithsonian Global Volcanism catalog lists no Holocene volcano within 50 km. Magmatic eruptions cannot occur without an existing volcanic system, so this scenario is rejected.",
      };
    },
  ],
};

export class ValidationEngine {
  validate(disaster: DisasterType, env: EnvironmentSnapshot): ValidationReport {
    const checks = (RULES[disaster] ?? []).map((rule) => rule(env));
    const failed = checks.filter((c) => c.status === "fail");
    const warned = checks.filter((c) => c.status === "warn");
    const feasible = failed.length === 0;

    const summary = feasible
      ? warned.length
        ? `Scenario is physically plausible with caveats: ${warned.map((w) => w.label.toLowerCase()).join("; ")}. The simulation will honor these constraints.`
        : "All environmental preconditions are satisfied. The scenario is physically plausible in this study area."
      : `Scenario rejected: ${failed.map((f) => f.detail).join(" ")}`;

    return { disaster, feasible, checks, summary };
  }
}
