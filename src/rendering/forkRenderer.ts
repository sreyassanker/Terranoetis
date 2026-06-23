import * as Cesium from 'cesium';

export interface ForkVisualState {
  forkId: string;
  name: string;
  divergenceScore: number;
  simulatedTimeMs: number;
  status: 'running' | 'paused' | 'terminated';
  entities: Cesium.Entity[];
  shellEntity: Cesium.Entity | null;
}

export class ForkRenderer {
  private viewer: Cesium.Viewer;
  private forks: Map<string, ForkVisualState>;
  private readonly AMBER_COLOR = new Cesium.Color(1.0, 0.65, 0.0, 0.5);
  private readonly SHELL_ALTITUDE_KM = 500;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.forks = new Map();
  }

  createForkVisual(forkId: string, name: string, lat: number, lon: number): ForkVisualState {
    this.removeForkVisual(forkId);

    const shellEntity = this.viewer.entities.add({
      id: `fork_shell_${forkId}`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, this.SHELL_ALTITUDE_KM * 1000),
      ellipsoid: {
        radii: new Cesium.Cartesian3(2000000, 2000000, 500000),
        material: new Cesium.ColorMaterialProperty(this.AMBER_COLOR),
        outline: true,
        outlineColor: Cesium.Color.YELLOW,
        outlineWidth: 2,
        slicePartitions: 24,
        stackPartitions: 16,
      },
    });

    const forkState: ForkVisualState = {
      forkId,
      name,
      divergenceScore: 0.0,
      simulatedTimeMs: 0,
      status: 'running',
      entities: [shellEntity],
      shellEntity,
    };

    this.forks.set(forkId, forkState);
    return forkState;
  }

  updateDivergence(forkId: string, divergenceScore: number, simulatedTimeMs: number): void {
    const fork = this.forks.get(forkId);
    if (!fork) return;

    fork.divergenceScore = divergenceScore;
    fork.simulatedTimeMs = simulatedTimeMs;

    if (fork.shellEntity && fork.shellEntity.ellipsoid) {
      const baseAlpha = 0.3 + (divergenceScore * 0.4);
      const redShift = divergenceScore * 0.3;
      const color = new Cesium.Color(1.0, 0.65 - redShift, 0.0, baseAlpha);
      (fork.shellEntity.ellipsoid.material as Cesium.ColorMaterialProperty).color = new Cesium.ConstantProperty(color);
    }
  }

  addGhostEntity(forkId: string, entityConfig: Cesium.Entity.ConstructorOptions): Cesium.Entity | null {
    const fork = this.forks.get(forkId);
    if (!fork) return null;

    const ghostConfig: Cesium.Entity.ConstructorOptions = {
      ...entityConfig,
      id: `${entityConfig.id}_fork_${forkId}`,
    };

    if (entityConfig.point) {
      ghostConfig.point = {
        ...(entityConfig.point as Cesium.PointGraphics),
        color: new Cesium.Color(1.0, 0.65, 0.0, 0.5),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pixelSize: ((entityConfig.point as any).pixelSize ?? 6) * 1.2,
      };
    }

    if (entityConfig.billboard) {
      ghostConfig.billboard = {
        ...(entityConfig.billboard as Cesium.BillboardGraphics),
        color: new Cesium.Color(1.0, 0.65, 0.0, 0.5),
      };
    }

    if (entityConfig.polyline) {
      ghostConfig.polyline = {
        ...(entityConfig.polyline as Cesium.PolylineGraphics),
        material: new Cesium.PolylineGlowMaterialProperty({
          color: new Cesium.Color(1.0, 0.65, 0.0, 0.5),
          glowPower: 0.4,
        }),
      };
    }

    const entity = this.viewer.entities.add(ghostConfig);
    fork.entities.push(entity);
    return entity;
  }

  pauseForkVisual(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (fork) fork.status = 'paused';
  }

  resumeForkVisual(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (fork) fork.status = 'running';
  }

  removeForkVisual(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (!fork) return;

    for (const ent of fork.entities) {
      this.viewer.entities.remove(ent);
    }
    this.forks.delete(forkId);
  }

  getAllForks(): ForkVisualState[] {
    return Array.from(this.forks.values());
  }

  getFork(forkId: string): ForkVisualState | undefined {
    return this.forks.get(forkId);
  }
}
