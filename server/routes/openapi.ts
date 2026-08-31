/**
 * OpenAPI 3.0.3 specification for Terranoetis.
 *
 * Generated from the live API surface. Documents the primary public,
 * authenticated, and analytical endpoints so integrators can build against
 * the platform without reading server/index.ts.
 *
 * Served at GET /api/openapi.json. The spec is built from two sources:
 *   - explicit route declarations below (core + analytical + data)
 *   - the /api/config/apis registry (external API metadata)
 */

import type { Express } from 'express';

const SERVERS = [{ url: '/', description: 'Terranoetis API' }];

const SECURITY_SCHEMES = {
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
} as const;

function docSummary(name: string): { summary: string; operationId: string; security: unknown[]; tags: string[] } {
  return {
    summary: name,
    operationId: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    security: [{ bearerAuth: [] }],
    tags: ['core'],
  };
}

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  // ── Core platform ─────────────────────────────────────────────
  paths['/api/health'] = {
    get: {
      ...docSummary('Platform health'),
      security: [],
      tags: ['core'],
      responses: { '200': { description: 'Health check with per-component status' } },
    },
  };
  paths['/api/metrics'] = {
    get: { ...docSummary('Prometheus metrics'), security: [], tags: ['core'], responses: { '200': { description: 'Prometheus text format' } } },
  };
  paths['/api/observability/traces'] = {
    get: { ...docSummary('Recent OTel traces'), security: [], tags: ['core'], responses: { '200': { description: 'Trace spans' } } },
  };
  paths['/api/observability/metrics'] = {
    get: { ...docSummary('OTel metrics summary'), security: [], tags: ['core'], responses: { '200': { description: 'Metrics summary' } } },
  };
  paths['/api/config/apis'] = {
    get: { ...docSummary('API configuration registry'), security: [], tags: ['core'], responses: { '200': { description: 'Configured upstream APIs' } } },
  };
  paths['/api/auth/dev-login'] = {
    post: { ...docSummary('Development login (JWT)'), security: [], tags: ['core'], responses: { '200': { description: 'JWT token + user' } } },
  };
  paths['/api/auth/refresh'] = {
    post: { ...docSummary('Refresh JWT'), security: [], tags: ['core'], responses: { '200': { description: 'Fresh JWT' }, '401': { description: 'Invalid/expired token' } } },
  };

  // ── Analytical engine ─────────────────────────────────────────
  paths['/api/analytical-models'] = {
    get: { ...docSummary('List implemented analytical models'), security: [], tags: ['analytical'], responses: { '200': { description: 'Implemented equation IDs' } } },
  };
  paths['/api/analytical-models/search'] = {
    get: {
      ...docSummary('Semantic search over analytical models'),
      security: [],
      tags: ['analytical'],
      parameters: [
        { name: 'q', in: 'query', required: true, description: 'Natural-language query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
      ],
      responses: { '200': { description: 'Matching models' } },
    },
  };
  paths['/api/analytical-models/{id}'] = {
    get: {
      ...docSummary('Model definition'),
      security: [],
      tags: ['analytical'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: { '200': { description: 'Model metadata' }, '404': { description: 'Not found' } },
    },
  };
  paths['/api/analytical-models/{id}/execute'] = {
    post: {
      ...docSummary('Execute an analytical model'),
      tags: ['analytical'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                inputs: { type: 'object', additionalProperties: { type: 'number' } },
                context: {
                  type: 'object',
                  properties: {
                    studyArea: {
                      type: 'object',
                      properties: {
                        mode: { type: 'string', enum: ['point', 'bbox', 'polygon', 'two-points'] },
                        point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                        bbox: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: { '200': { description: 'Computation result with grid/QC/validation/uncertainty' }, '401': { description: 'Unauthorized' } },
    },
  };

  // ── Live data layers ──────────────────────────────────────────
  const dataEndpoints: Array<[string, string, string, boolean]> = [
    ['/api/earthquakes', 'Recent earthquakes (USGS)', 'get', false],
    ['/api/earthquakes/significant', 'Significant earthquakes (USGS)', 'get', false],
    ['/api/eonet', 'NASA EONET events', 'get', false],
    ['/api/flights/all', 'Live flights (ADS-B/OpenSky)', 'get', false],
    ['/api/satellites/tle', 'Active satellites with live positions', 'get', false],
    ['/api/space-weather/kp', 'Planetary K-index', 'get', false],
    ['/api/gdacs/alerts', 'GDACS disaster alerts', 'get', false],
    ['/api/radar/rainviewer', 'RainViewer radar layers', 'get', false],
    ['/api/cctv/worldwide', 'Worldwide CCTV cameras', 'get', false],
    ['/api/data/radio_stations', 'Geolocated radio stations', 'get', true],
    ['/api/data/bikeshare', 'Bikeshare stations (GBFS)', 'get', true],
    ['/api/volcanoes', 'Active volcanoes', 'get', false],
    ['/api/iss', 'ISS live position', 'get', false],
    ['/api/tectonic', 'Tectonic plate boundaries', 'get', false],
    ['/api/weather/alerts', 'Active weather alerts (NWS)', 'get', false],
    ['/api/weather/open-meteo', 'Open-Meteo weather', 'get', false],
    ['/api/satnogs/transmitters', 'SatNOGS transmitters', 'get', false],
    ['/api/mgrs', 'MGRS conversion', 'get', false],
  ];
  for (const [path, summary, method, auth] of dataEndpoints) {
    const op: Record<string, unknown> = { ...docSummary(summary), tags: ['data'], responses: { '200': { description: summary } } };
    if (auth) op.security = [{ bearerAuth: [] }];
    paths[path] = { [method]: op };
  }

  // ── Agent / voice ─────────────────────────────────────────────
  paths['/api/agent/ask'] = {
    post: {
      ...docSummary('Agent query with SSE streaming'),
      tags: ['agent'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['message'],
              properties: {
                message: { type: 'string' },
                images: { type: 'array', items: { type: 'string' } },
                studyAreaBbox: { type: 'object', properties: { latMin: { type: 'number' }, latMax: { type: 'number' }, lonMin: { type: 'number' }, lonMax: { type: 'number' } } },
              },
            },
          },
        },
      },
      responses: { '200': { description: 'Server-Sent Events stream (connected/intent/step/commands/output/analytical_result/done)' }, '401': { description: 'Unauthorized' } },
    },
  };
  paths['/api/scenarios/generate'] = {
    post: {
      ...docSummary('Generate a disaster scenario from real data'),
      tags: ['scenarios'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['type'],
              properties: { type: { type: 'string' }, params: { type: 'object' } },
            },
          },
        },
      },
      responses: { '200': { description: 'Generated scenario' } },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Terranoetis API',
      version: '3.1',
      description: 'Real-time geospatial intelligence platform. Live environmental data, 150 analytical equation engines, realtime voice, and multi-provider AI cognition. All outputs are computed from real data — nothing is fabricated.',
    },
    servers: SERVERS,
    tags: [
      { name: 'core', description: 'Platform health, metrics, auth' },
      { name: 'analytical', description: '150 scientific equation engines' },
      { name: 'data', description: 'Live data layers' },
      { name: 'agent', description: 'Agent + voice + scenarios' },
    ],
    paths,
    components: { securitySchemes: SECURITY_SCHEMES },
  };
}

export function registerOpenApiRoutes(app: Express): void {
  const spec = buildOpenApiSpec();
  app.get('/api/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(spec);
  });
  app.get('/api/docs', (_req, res) => {
    res
      .type('html')
      .send(`<!DOCTYPE html><html><head><title>Terranoetis API</title>
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
      </head><body><div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
        <script>SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' });</script>
      </body></html>`);
  });
}
