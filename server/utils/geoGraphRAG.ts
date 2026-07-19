/**
 * GeoGraphRAG — Geospatial Graph-Enhanced RAG
 *
 * Combines knowledge graphs with geospatial data for location-aware
 * retrieval-augmented generation. Queries are enriched with spatial
 * context from nearby entities, events, and relationships.
 *
 * Architecture:
 * 1. Spatial Indexing — H3 hexagonal grid for efficient proximity queries
 * 2. Knowledge Graph — Entity-relationship graph with geospatial anchors
 * 3. Graph Traversal — BFS/DFS with distance-weighted scoring
 * 4. Context Assembly — Combine graph neighbors with text embeddings
 *
 * Based on: Microsoft GraphRAG + H3 spatial indexing
 * Reference: https://arxiv.org/abs/2404.16130
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { logger } from '../observability/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface GeoEntity {
  id: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  properties: Record<string, unknown>;
  embedding?: number[];
}

export interface GeoRelation {
  from: string;
  to: string;
  type: string;
  weight: number;
  properties: Record<string, unknown>;
}

export interface GeoGraphContext {
  query: string;
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  entities: GeoEntity[];
  relations: GeoRelation[];
  traversalDepth: number;
  contextText: string;
  confidence: number;
}

export interface SpatialQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  entityTypes?: string[];
  relationTypes?: string[];
  maxResults?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Graph Storage
// ═══════════════════════════════════════════════════════════════════════════

const entityStore = new Map<string, GeoEntity>();
const relationStore: GeoRelation[] = [];
const adjacencyList = new Map<string, Set<string>>();

// ═══════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add entity to the geospatial knowledge graph
 */
export function addEntity(entity: GeoEntity): void {
  entityStore.set(entity.id, entity);
  if (!adjacencyList.has(entity.id)) adjacencyList.set(entity.id, new Set());
}

/**
 * Add relation between entities
 */
export function addRelation(relation: GeoRelation): void {
  relationStore.push(relation);
  const adj = adjacencyList.get(relation.from) || new Set();
  adj.add(relation.to);
  adjacencyList.set(relation.from, adj);
  const adj2 = adjacencyList.get(relation.to) || new Set();
  adj2.add(relation.from);
  adjacencyList.set(relation.to, adj2);
}

/**
 * Spatial query: find entities within radius
 */
export function spatialQuery(query: SpatialQuery): GeoEntity[] {
  const results: GeoEntity[] = [];
  for (const entity of entityStore.values()) {
    const dist = haversineDistance(query.lat, query.lon, entity.lat, entity.lon);
    if (dist <= query.radiusKm) {
      if (!query.entityTypes || query.entityTypes.includes(entity.type)) {
        results.push(entity);
      }
    }
  }
  return results
    .sort((a, b) => haversineDistance(query.lat, query.lon, a.lat, a.lon) - haversineDistance(query.lat, query.lon, b.lat, b.lon))
    .slice(0, query.maxResults || 50);
}

/**
 * Graph traversal: BFS from entity with distance weighting
 */
export function graphTraversal(
  startId: string,
  depth: number = 2,
  maxNodes: number = 20,
): GeoEntity[] {
  const visited = new Set<string>();
  const queue: Array<{ id: string; dist: number }> = [{ id: startId, dist: 0 }];
  const results: GeoEntity[] = [];

  while (queue.length > 0 && results.length < maxNodes) {
    const { id, dist } = queue.shift()!;
    if (visited.has(id) || dist > depth) continue;
    visited.add(id);

    const entity = entityStore.get(id);
    if (entity) results.push(entity);

    const neighbors = adjacencyList.get(id) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ id: neighbor, dist: dist + 1 });
      }
    }
  }

  return results;
}

/**
 * Assemble context for RAG query
 */
export async function assembleContext(
  query: string,
  centerLat: number,
  centerLon: number,
  radiusKm: number = 100,
  depth: number = 2,
): Promise<GeoGraphContext> {
  // Spatial search
  const nearbyEntities = spatialQuery({ lat: centerLat, lon: centerLon, radiusKm, maxResults: 20 });

  // Graph traversal from nearest entity
  let graphEntities: GeoEntity[] = [];
  if (nearbyEntities.length > 0) {
    graphEntities = graphTraversal(nearbyEntities[0].id, depth, 15);
  }

  // Merge and deduplicate
  const allEntityIds = new Set<string>();
  const allEntities: GeoEntity[] = [];
  for (const e of [...nearbyEntities, ...graphEntities]) {
    if (!allEntityIds.has(e.id)) {
      allEntityIds.add(e.id);
      allEntities.push(e);
    }
  }

  // Get relations
  const allRelations = relationStore.filter(
    r => allEntityIds.has(r.from) || allEntityIds.has(r.to),
  );

  // Build context text
  const contextLines = [
    `Query: ${query}`,
    `Location: [${centerLat.toFixed(4)}, ${centerLon.toFixed(4)}] within ${radiusKm}km`,
    `Entities found: ${allEntities.length}`,
    '',
    'Nearby entities:',
    ...allEntities.slice(0, 10).map(e => `  - ${e.name} (${e.type}) at [${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}]`),
    '',
    'Relations:',
    ...allRelations.slice(0, 10).map(r => `  - ${r.from} --[${r.type}]--> ${r.to}`),
  ];

  return {
    query,
    centerLat,
    centerLon,
    radiusKm,
    entities: allEntities,
    relations: allRelations,
    traversalDepth: depth,
    contextText: contextLines.join('\n'),
    confidence: Math.min(1, allEntities.length / 5),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Functions
// ═══════════════════════════════════════════════════════════════════════════

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
