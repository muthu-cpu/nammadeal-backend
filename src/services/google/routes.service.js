const axios = require('axios');

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function normalizeGoogleRoute(route, index) {
  const leg = route.legs?.[0] || {};
  const steps = leg.steps || [];
  const walkingMeters = steps
    .filter((step) => step.travelMode === 'WALK')
    .reduce((sum, step) => sum + (step.distanceMeters || 0), 0);

  const transitSteps = steps.filter((step) => step.travelMode === 'TRANSIT');
  const stopCount = transitSteps.reduce((sum, step) => {
    const stops = step.transitDetails?.stopCount || 0;
    return sum + stops;
  }, 0);

  const fare = Number(route.travelAdvisory?.transitFare?.amount?.units || 0);
  const durationMin = Math.round((Number(String(route.duration || '0s').replace('s', '')) || 0) / 60);

  return {
    id: `google-${index + 1}`,
    kind: transitSteps.length > 1 ? 'MIXED' : transitSteps[0]?.transitDetails?.vehicle?.type || 'TRANSIT',
    durationMin,
    costInr: fare,
    walkingMeters,
    stopCount,
    summary: route.description || transitSteps.map((step) => step.transitDetails?.headsign).filter(Boolean).join(' -> ') || 'Transit route',
    polyline: route.polyline?.encodedPolyline || '',
    source: 'google',
    legs: steps.map((step) => ({
      mode: step.travelMode,
      distanceMeters: step.distanceMeters || 0,
      staticDuration: step.staticDuration || '',
      instruction: step.navigationInstruction?.instructions || '',
      transit: step.transitDetails
        ? {
            headsign: step.transitDetails.headsign || '',
            stopCount: step.transitDetails.stopCount || 0,
            arrivalStop: step.transitDetails.arrivalStop?.name || '',
            departureStop: step.transitDetails.departureStop?.name || '',
            lineName: step.transitDetails.transitLine?.name || '',
            lineShortName: step.transitDetails.transitLine?.nameShort || '',
            vehicleType: step.transitDetails.transitLine?.vehicle?.type || '',
          }
        : null,
    })),
  };
}

async function fetchGoogleTransitRoutes({ origin, destination, departureTime }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const payload = {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lng,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lng,
        },
      },
    },
    travelMode: 'TRANSIT',
    computeAlternativeRoutes: true,
    languageCode: 'en-IN',
    units: 'METRIC',
  };

  if (departureTime) {
    payload.departureTime = departureTime;
  }

  const response = await axios.post(GOOGLE_ROUTES_URL, payload, {
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'routes.description',
        'routes.distanceMeters',
        'routes.duration',
        'routes.polyline.encodedPolyline',
        'routes.legs.steps',
        'routes.travelAdvisory.transitFare',
      ].join(','),
    },
  });

  return (response.data.routes || []).map(normalizeGoogleRoute);
}

function buildFallbackRoutes({ origin, destination }) {
  const seed = Math.abs(Math.round(origin.lat * 1000) + Math.round(destination.lng * 1000));
  const durationBase = 30 + (seed % 15);
  const costBase = 20 + (seed % 12);

  return [
    {
      id: 'fallback-fastest',
      kind: 'MIXED',
      durationMin: durationBase,
      costInr: costBase + 12,
      walkingMeters: 350,
      stopCount: 9,
      summary: 'Bus to Majestic + Metro connector',
      polyline: '',
      source: 'fallback',
      legs: [
        { mode: 'WALK', distanceMeters: 180, staticDuration: '300s', instruction: 'Walk to bus stop', transit: null },
        {
          mode: 'TRANSIT',
          distanceMeters: 6200,
          staticDuration: '1200s',
          instruction: 'Take bus towards Majestic',
          transit: {
            headsign: 'Majestic',
            stopCount: 6,
            arrivalStop: 'Majestic',
            departureStop: origin.name,
            lineName: 'BMTC 500D',
            lineShortName: '500D',
            vehicleType: 'BUS',
          },
        },
        {
          mode: 'TRANSIT',
          distanceMeters: 5200,
          staticDuration: '780s',
          instruction: 'Board Metro towards destination',
          transit: {
            headsign: destination.name,
            stopCount: 3,
            arrivalStop: destination.name,
            departureStop: 'Majestic Metro',
            lineName: 'Namma Metro',
            lineShortName: 'Green Line',
            vehicleType: 'SUBWAY',
          },
        },
      ],
    },
    {
      id: 'fallback-cheapest',
      kind: 'BUS',
      durationMin: durationBase + 12,
      costInr: costBase,
      walkingMeters: 540,
      stopCount: 14,
      summary: 'Direct BMTC bus route',
      polyline: '',
      source: 'fallback',
      legs: [
        { mode: 'WALK', distanceMeters: 240, staticDuration: '360s', instruction: 'Walk to nearest BMTC stop', transit: null },
        {
          mode: 'TRANSIT',
          distanceMeters: 10400,
          staticDuration: '2280s',
          instruction: 'Take direct BMTC route',
          transit: {
            headsign: destination.name,
            stopCount: 14,
            arrivalStop: destination.name,
            departureStop: origin.name,
            lineName: 'BMTC KIA-8A',
            lineShortName: 'KIA-8A',
            vehicleType: 'BUS',
          },
        },
      ],
    },
  ];
}

module.exports = {
  DEFAULT_TTL_MS,
  fetchGoogleTransitRoutes,
  buildFallbackRoutes,
};
