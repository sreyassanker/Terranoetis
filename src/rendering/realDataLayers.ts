import * as Cesium from 'cesium';

// --- REAL AIRSPACES (GeoJSON) ---
export async function loadAirspaces(viewer: Cesium.Viewer): Promise<Cesium.Entity[]> {
  try {
    // We fetch a public sample or open source GeoJSON for airspace boundaries.
    // In a full production app, this would query an API like OpenAIP.
    const res = await fetch('https://raw.githubusercontent.com/wri/global-airspace/master/airspace.geojson');
    if (!res.ok) throw new Error('Failed to fetch real airspace data.');
    
    const geojson = await res.json();
    const dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
      stroke: Cesium.Color.fromCssColorString('#00f2fe').withAlpha(0.6),
      fill: Cesium.Color.fromCssColorString('#00f2fe').withAlpha(0.1),
      strokeWidth: 2,
    });
    
    const entities: Cesium.Entity[] = [];
    for (let i = 0; i < dataSource.entities.values.length; i++) {
      const entity = dataSource.entities.values[i];
      entity.properties?.addProperty('layer', 'airspaces');
      entities.push(entity);
      viewer.entities.add(entity);
    }
    return entities;
  } catch (err) {
    console.error('Airspaces error:', err);
    throw err;
  }
}

// --- REAL AIS VESSELS ---
export async function loadAisVessels(viewer: Cesium.Viewer, apiKey: string): Promise<Cesium.Entity[]> {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('AISStream API Key required for real live vessels.');
  }

  // Normally we would open a WebSocket to wss://stream.aisstream.io/v0/stream
  // Since we only want to load a snapshot into the entity store to be pure "real data"
  // AISStream only provides a websocket. We will instantiate the websocket, listen for 5 seconds to collect live ships, 
  // and then close it for simplicity (or keep it open to update).
  
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const entities: Cesium.Entity[] = [];
    const timeout = setTimeout(() => {
      socket.close();
      if (entities.length === 0) reject(new Error('No vessels received from AISStream.'));
      else resolve(entities);
    }, 5000); // Wait 5 seconds to buffer live ships

    socket.onopen = () => {
      // Subscribe to all world bounding boxes
      const subMsg = {
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport"]
      };
      socket.send(JSON.stringify(subMsg));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.MessageType === "PositionReport" && msg.Message?.PositionReport) {
          const report = msg.Message.PositionReport;
          const lat = report.Latitude;
          const lon = report.Longitude;
          const mmsi = msg.MetaData?.MMSI || 'Unknown';
          
          if (lat && lon) {
            const ship = viewer.entities.add({
              name: `Vessel MMSI: ${mmsi}`,
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
              billboard: {
                image: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0ea5e9"><path d="M21 16.5l-9 4.5-9-4.5V7.5L12 3l9 4.5v9z"/></svg>`),
                width: 16,
                height: 16,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
              },
              properties: { layer: 'ais_vessels', ...report }
            });
            entities.push(ship);
          }
        }
      } catch (err) {
        console.warn('AIS parse error:', err);
      }
    };

    socket.onerror = (err) => {
      clearTimeout(timeout);
      reject(new Error('AISStream WebSocket error. Invalid API Key?'));
    };
  });
}
