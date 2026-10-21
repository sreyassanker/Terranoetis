import { globalArchaeologyEngine } from '../server/archaeology/archaeologyEngine';

async function testComparison() {
  console.log('=== TEST 1: The User Drawn Box from Screenshot (approx 9.057 km² centered at 39.058° E) ===');
  // 9.057 km² is approx 0.030 deg lat by 0.034 deg lon centered at 36.5492, 39.0581
  const userBox = {
    latMin: 36.5492 - 0.0135,
    latMax: 36.5492 + 0.0135,
    lonMin: 39.0581 - 0.019,
    lonMax: 39.0581 + 0.019,
  };
  const scanUser = await globalArchaeologyEngine.scanStudyArea(userBox);
  console.log('User Box Area:', scanUser.studyAreaKm2.toFixed(3), 'km²');
  console.log('User Box Status:', scanUser.status);
  console.log('User Box Anomalies:', scanUser.anomalies.length);

  console.log('\n=== TEST 2: The Actual Candidate Complex Box (1.947 km² at 39.030° E) ===');
  const candidateBox = {
    latMin: 36.5430,
    latMax: 36.5570,
    lonMin: 39.0230,
    lonMax: 39.0370,
  };
  const scanCandidate = await globalArchaeologyEngine.scanStudyArea(candidateBox, 'agricultural_plain');
  console.log('Candidate Box Area:', scanCandidate.studyAreaKm2.toFixed(3), 'km²');
  console.log('Candidate Box Status:', scanCandidate.status);
  console.log('Candidate Box Anomalies:', scanCandidate.anomalies.length);
  if (scanCandidate.anomalies.length > 0) {
    console.log('Anomaly #1:', scanCandidate.anomalies[0].name, 'Centroid:', scanCandidate.anomalies[0].centroid);
  }
}

testComparison().catch(console.error);
