import * as Cesium from 'cesium';

export interface CausalChainLink {
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;
  confidence: number;
  timeDeltaHours: number;
}

export class OracleChainRenderer {
  private viewer: Cesium.Viewer;
  private chainEntities: Cesium.Entity[] = [];
  private readonly COLORS: Record<string, Cesium.Color> = {
    CAUSES: new Cesium.Color(1.0, 0.3, 0.1, 0.9),
    INFLUENCES: new Cesium.Color(0.3, 0.6, 1.0, 0.8),
    PRECEDES: new Cesium.Color(0.9, 0.9, 0.2, 0.7),
    CORRELATES_WITH: new Cesium.Color(0.5, 0.5, 0.5, 0.5),
    BLOCKS: new Cesium.Color(0.8, 0.1, 0.8, 0.9),
  };

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  renderChain(links: CausalChainLink[]): void {
    this.clearChain();

    const now = Cesium.JulianDate.now();

    for (const link of links) {
      const sourceEntity = this.viewer.entities.getById(link.sourceEntityId);
      const targetEntity = this.viewer.entities.getById(link.targetEntityId);

      if (!sourceEntity || !targetEntity) continue;

      const sourcePos = sourceEntity.position?.getValue(now);
      const targetPos = targetEntity.position?.getValue(now);

      if (!sourcePos || !targetPos) continue;

      const midPoint = Cesium.Cartesian3.lerp(sourcePos, targetPos, 0.5, new Cesium.Cartesian3());
      const height = Cesium.Cartesian3.distance(sourcePos, targetPos) * 0.3;
      const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(midPoint, new Cesium.Cartesian3());
      const arcPeak = Cesium.Cartesian3.add(
        midPoint,
        Cesium.Cartesian3.multiplyByScalar(up, height, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );

      const positions: Cesium.Cartesian3[] = [];
      const segments = 64;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const oneMinusT = 1 - t;
        const p0 = Cesium.Cartesian3.multiplyByScalar(sourcePos, oneMinusT * oneMinusT, new Cesium.Cartesian3());
        const p1 = Cesium.Cartesian3.multiplyByScalar(arcPeak, 2 * oneMinusT * t, new Cesium.Cartesian3());
        const p2 = Cesium.Cartesian3.multiplyByScalar(targetPos, t * t, new Cesium.Cartesian3());
        const sum = Cesium.Cartesian3.add(p0, p1, new Cesium.Cartesian3());
        positions.push(Cesium.Cartesian3.add(sum, p2, new Cesium.Cartesian3()));
      }

      const color = this.COLORS[link.relation] || this.COLORS.CORRELATES_WITH;
      const alpha = Math.max(0.2, link.confidence);

      const polyline = this.viewer.entities.add({
        id: `oracle_chain_${link.sourceEntityId}_${link.targetEntityId}`,
        polyline: {
          positions,
          width: 2 + link.confidence * 4,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: new Cesium.Color(color.red, color.green, color.blue, alpha),
            glowPower: 0.25,
          }),
          arcType: Cesium.ArcType.NONE,
        },
      });

      const pulseEntity = this.viewer.entities.add({
        id: `oracle_pulse_${link.targetEntityId}_${Date.now()}`,
        position: targetPos,
        ellipse: {
          semiMajorAxis: 50000 + link.confidence * 200000,
          semiMinorAxis: 50000 + link.confidence * 200000,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => {
              const pulse = 0.5 + 0.5 * Math.abs(Math.sin(Date.now() / 1000));
              return new Cesium.Color(color.red, color.green, color.blue, alpha * pulse * 0.5);
            }, false),
          ),
          outline: true,
          outlineColor: new Cesium.Color(color.red, color.green, color.blue, alpha),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      });

      this.chainEntities.push(polyline, pulseEntity);
    }
  }

  clearChain(): void {
    for (const ent of this.chainEntities) {
      this.viewer.entities.remove(ent);
    }
    this.chainEntities = [];
  }

  highlightEntity(entityId: string, outgoingLinks: CausalChainLink[]): void {
    this.clearChain();
    const enhancedLinks = outgoingLinks.map(l => ({ ...l, confidence: Math.min(1.0, l.confidence * 1.3) }));
    this.renderChain(enhancedLinks);
  }

  destroy(): void {
    this.clearChain();
  }
}
