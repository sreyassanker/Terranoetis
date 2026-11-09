import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Cesium from 'cesium';
import { getPegmanSvgUri, updatePegman, removePegman } from '@/rendering/streetViewPegman';
import { GroundWalkController } from '@/rendering/groundWalkController';
import { SENSOR_STYLES } from '@/rendering/sensorStyles';
import { getTeslaRoadsterGltf, getRoverGltf } from '@/rendering/roadsterModel';
import { API_METADATA } from '../../server/apiMetadata';

describe('Street View & Ground-Level Exploration', () => {
  describe('Pegman SVG & Globe Marker', () => {
    it('generates a valid Pegman SVG data URI with iconic Google yellow coloring', () => {
      const uri = getPegmanSvgUri();
      expect(uri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      expect(decodeURIComponent(uri)).toContain('#FBBC04'); // Iconic Google Maps Pegman Yellow
      expect(decodeURIComponent(uri)).toContain('<circle');
      expect(decodeURIComponent(uri)).toContain('<path');
    });

    it('creates and updates Cesium entities for Pegman and directional radar wedge', () => {
      const entitiesMap = new Map<string, any>();
      const mockViewer = {
        isDestroyed: () => false,
        entities: {
          getById: (id: string) => entitiesMap.get(id) || null,
          add: (obj: any) => {
            entitiesMap.set(obj.id, obj);
            return obj;
          },
          remove: (obj: any) => entitiesMap.delete(obj.id),
        },
        scene: {
          requestRender: vi.fn(),
        },
      } as unknown as Cesium.Viewer;

      // Initial placement
      updatePegman(mockViewer, 48.8584, 2.2945, 90);
      expect(entitiesMap.has('terranoetis_streetview_pegman')).toBe(true);
      expect(entitiesMap.has('terranoetis_streetview_cone')).toBe(true);
      expect(mockViewer.scene.requestRender).toHaveBeenCalled();

      // Subsequent update
      updatePegman(mockViewer, 48.859, 2.295, 180);
      expect(entitiesMap.get('terranoetis_streetview_pegman')).toBeDefined();

      // Cleanup
      removePegman(mockViewer);
      expect(entitiesMap.has('terranoetis_streetview_pegman')).toBe(false);
      expect(entitiesMap.has('terranoetis_streetview_cone')).toBe(false);
    });
  });

  describe('3D Ground Walk Simulator (Game Mode)', () => {
    it('initializes controller and handles mode switches', () => {
      const controller = new GroundWalkController();
      expect(controller.isActive).toBe(false);
      expect(controller.currentMode).toBe('drive');

      controller.setMode('walk');
      expect(controller.currentMode).toBe('walk');

      controller.setMode('drone');
      expect(controller.currentMode).toBe('drone');
    });

    it('manages camera control state transitions cleanly', () => {
      const controller = new GroundWalkController();
      const mockCanvas = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLCanvasElement;

      const mockViewer = {
        isDestroyed: () => false,
        scene: {
          canvas: mockCanvas,
          screenSpaceCameraController: {
            enableRotate: true,
            enableZoom: true,
            enableTilt: true,
            enableLook: true,
          },
          globe: {
            getHeight: () => 35, // 35m terrain elevation
          },
          preRender: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
          primitives: {
            add: vi.fn(),
            remove: vi.fn(),
          },
          requestRender: vi.fn(),
        },
        camera: {
          setView: vi.fn(),
          flyTo: vi.fn(),
        },
      } as unknown as Cesium.Viewer;

      controller.start(mockViewer, 35.6595, 139.7005, 180);
      expect(controller.isActive).toBe(true);
      // Cesium controls should be disabled during ground walk to allow custom WASD navigation
      expect(mockViewer.scene.screenSpaceCameraController.enableRotate).toBe(false);
      expect(mockViewer.scene.screenSpaceCameraController.enableZoom).toBe(false);
      expect(mockViewer.camera.setView).toHaveBeenCalled();

      // Pointer and trackpad listeners for 360° spherical orbit, wheel zoom, and reset
      expect(mockCanvas.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
      expect(mockCanvas.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
      expect(mockCanvas.addEventListener).toHaveBeenCalledWith('dblclick', expect.any(Function));

      // Stopping restores controls and initiates overview transition
      controller.stop(250);
      expect(controller.isActive).toBe(false);
      expect(mockViewer.scene.screenSpaceCameraController.enableRotate).toBe(true);
      expect(mockViewer.scene.screenSpaceCameraController.enableZoom).toBe(true);
      expect(mockCanvas.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
      expect(mockViewer.camera.flyTo).toHaveBeenCalled();
    });

    it('manages SpaceX cold-gas thruster flight, Ludicrous boost, and 360 turntable controls', () => {
      const controller = new GroundWalkController();
      let lastState: any = null;
      const callback = (state: any) => { lastState = state; };

      const mockCanvas = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLCanvasElement;

      const mockViewer = {
        isDestroyed: () => false,
        scene: {
          canvas: mockCanvas,
          screenSpaceCameraController: {
            enableRotate: true,
            enableZoom: true,
            enableTilt: true,
            enableLook: true,
          },
          globe: { getHeight: () => 10 },
          preRender: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
          primitives: {
            add: vi.fn(),
            remove: vi.fn(),
          },
          requestRender: vi.fn(),
        },
        camera: {
          setView: vi.fn(),
          flyTo: vi.fn(),
        },
      } as unknown as Cesium.Viewer;

      controller.start(mockViewer, 37.7749, -122.4194, 90, callback, 'drive');
      expect(controller.isActive).toBe(true);

      // Camera Perspective Switching
      expect(controller.currentPerspective).toBe('chase');
      const newPersp = controller.togglePerspective();
      expect(newPersp).toBe('cockpit');
      expect(controller.currentPerspective).toBe('cockpit');
      controller.setPerspective('chase');
      expect(controller.currentPerspective).toBe('chase');

      // 360 Studio Turntable Mode
      expect(controller.toggleTurntable()).toBe(true);
      expect(controller.toggleTurntable()).toBe(false);

      // Removable Glass Roof Convertible Targa Mode
      expect(controller.isTargaRoofOpen()).toBe(false);
      expect(controller.toggleTargaRoof()).toBe(true);
      expect(controller.isTargaRoofOpen()).toBe(true);
      expect(controller.toggleTargaRoof()).toBe(false);

      // Audio Mute Toggle
      expect(controller.isAudioMuted()).toBe(false);
      expect(controller.toggleAudioMute()).toBe(true);
      expect(controller.isAudioMuted()).toBe(true);
      expect(controller.toggleAudioMute()).toBe(false);

      // Manual control inputs (SpaceX fly, Ludicrous, Steer, Throttle)
      controller.setManualFly(true);
      controller.setManualLudicrous(true);
      controller.setManualThrottle(1);
      controller.setManualSteer(-1);
      controller.resetOrbitCamera();

      controller.stop(0);
      expect(controller.isActive).toBe(false);
    });
  });

  describe('Genie 3 World Restyler & Shader Pipeline', () => {
    it('registers Cyberpunk shader with neon chromatic grading', () => {
      const cyberpunk = SENSOR_STYLES.find(s => s.id === 'cyberpunk');
      expect(cyberpunk).toBeDefined();
      expect(cyberpunk?.label).toBe('Cyberpunk');
      expect(cyberpunk?.frag).toContain('colorTexture');
      expect(cyberpunk?.frag).toContain('neon');
    });
  });

  describe('Tesla Roadster 3D Model glTF Generator', () => {
    it('generates a valid binary glTF 2.0 data URI for the Tesla Roadster', () => {
      const uri = getTeslaRoadsterGltf();
      expect(uri).toMatch(/^data:model\/gltf-binary;base64,/);
      const b64 = uri.replace('data:model/gltf-binary;base64,', '');
      const buf = Buffer.from(b64, 'base64');
      // GLB Header magic: 0x46546C67 ('glTF' in ASCII)
      expect(buf.readUInt32LE(0)).toBe(0x46546C67);
      // GLB Version 2
      expect(buf.readUInt32LE(4)).toBe(2);
      expect(buf.length).toBeGreaterThan(10000);
    });

    it('generates convertible Targa roof and SpaceX thruster plume variants', () => {
      const targaUri = getTeslaRoadsterGltf({ targaOpen: true });
      expect(targaUri).toMatch(/^data:model\/gltf-binary;base64,/);

      const plumeUri = getTeslaRoadsterGltf({ showThrusterPlumes: true });
      expect(plumeUri).toMatch(/^data:model\/gltf-binary;base64,/);
      expect(plumeUri).not.toBe(targaUri);
    });

    it('backward compatibility alias getRoverGltf returns the Tesla Roadster model', () => {
      const roadster = getTeslaRoadsterGltf();
      const rover = getRoverGltf();
      expect(rover).toBe(roadster);
    });

    it('preserves wheel scene-graph nodes for dynamic 60 FPS animation', () => {
      const gltfUri = getTeslaRoadsterGltf();
      const base64 = gltfUri.replace(/^data:model\/gltf-binary;base64,/, '');
      const buf = Buffer.from(base64, 'base64');
      const jsonLen = buf.readUInt32LE(12);
      const jsonStr = buf.toString('utf8', 20, 20 + jsonLen);
      const gltf = JSON.parse(jsonStr);
      const nodeNames = gltf.nodes.map((n: { name?: string }) => n.name).filter(Boolean);
      expect(nodeNames).toContain('wheel_fl');
      expect(nodeNames).toContain('wheel_fr');
      expect(nodeNames).toContain('wheel_rl');
      expect(nodeNames).toContain('wheel_rr');
    });
  });

  describe('API Vault Catalog Configuration', () => {
    it('registers Google Maps with free Maps Embed API tier', () => {
      const gmaps = API_METADATA.find(a => a.id === 'google_maps');
      expect(gmaps).toBeDefined();
      expect(gmaps?.free).toBe(true);
      expect(gmaps?.rateLimit).toContain('Unlimited');
      expect(gmaps?.envKey).toBe('GOOGLE_MAPS_API_KEY');
    });
  });
});
