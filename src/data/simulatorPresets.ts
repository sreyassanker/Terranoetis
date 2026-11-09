export interface CityPreset {
  label: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  heading: number;
}

export const SIMULATOR_CITIES: CityPreset[] = [
  { label: 'New York (Manhattan)', city: 'New York', country: 'USA', lat: 40.758, lon: -73.9855, heading: 25 },
  { label: 'Tokyo (Shibuya)', city: 'Tokyo', country: 'Japan', lat: 35.6595, lon: 139.7005, heading: 320 },
  { label: 'Paris (Eiffel)', city: 'Paris', country: 'France', lat: 48.8584, lon: 2.2945, heading: 140 },
  { label: 'London (Thames)', city: 'London', country: 'UK', lat: 51.5055, lon: -0.0754, heading: 90 },
  { label: 'San Francisco (Bay)', city: 'San Francisco', country: 'USA', lat: 37.8199, lon: -122.4783, heading: 190 },
  { label: 'Dubai (Marina)', city: 'Dubai', country: 'UAE', lat: 25.1972, lon: 55.2744, heading: 45 },
  { label: 'Sydney (Harbour)', city: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21, heading: 60 },
  { label: 'Mumbai (Gateway)', city: 'Mumbai', country: 'India', lat: 18.922, lon: 72.8347, heading: 85 },
  { label: 'New Delhi (Rashtrapati)', city: 'New Delhi', country: 'India', lat: 28.61, lon: 77.21, heading: 90 },
  { label: 'Bengaluru (MG Road)', city: 'Bengaluru', country: 'India', lat: 12.97, lon: 77.59, heading: 0 },
];

export const LANDMARK_PRESETS = [
  { name: 'Times Square', city: 'New York', lat: 40.758, lon: -73.9855, heading: 25 },
  { name: 'Shibuya Crossing', city: 'Tokyo', lat: 35.6595, lon: 139.7005, heading: 320 },
  { name: 'Eiffel Tower', city: 'Paris', lat: 48.85837, lon: 2.294481, heading: 140 },
  { name: 'Golden Gate Bridge', city: 'San Francisco', lat: 37.8199, lon: -122.4783, heading: 190 },
  { name: 'Big Ben & Thames', city: 'London', lat: 51.5007, lon: -0.1246, heading: 40 },
  { name: 'Burj Khalifa', city: 'Dubai', lat: 25.1972, lon: 55.2744, heading: 110 },
];
