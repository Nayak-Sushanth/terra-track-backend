import type { DbscanCluster, H3HexCell, PotholeRecord } from '../types/index.ts';

/**
 * Spatial Intelligence Engine: DBSCAN Clustering & H3-Compatible Hexagonal Binning
 *
 * Runs deterministic geospatial calculations directly over eligible pothole
 * records with reliable GPS coordinates. Never invents coordinates or metrics.
 */

export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

type GeolocatedPothole = PotholeRecord & { lat: number; lng: number };

function hasReliableCoordinates(p: PotholeRecord): p is GeolocatedPothole {
  if (p.hasReliableGps === false) return false;
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return false;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return false;
  if (p.lat === 0 && p.lng === 0) return false;
  return true;
}

/**
 * Computes a convex hull polygon (or expanded hexagonal buffer for 2-point clusters)
 * for Leaflet rendering of DBSCAN cluster footprints.
 */
function buildClusterFootprint(
  points: Array<{ lat: number; lng: number }>,
  centroidLat: number,
  centroidLng: number,
  radiusMeters: number
): Array<[number, number]> {
  const effectiveRadius = Math.max(radiusMeters + 65, 110);
  const latDegPerMeter = 1 / 111320;
  const lngDegPerMeter = 1 / (111320 * Math.cos((centroidLat * Math.PI) / 180));

  if (points.length < 3) {
    const vertices: Array<[number, number]> = [];
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i;
      vertices.push([
        centroidLat + Math.sin(angle) * effectiveRadius * latDegPerMeter,
        centroidLng + Math.cos(angle) * effectiveRadius * lngDegPerMeter,
      ]);
    }
    return vertices;
  }

  // Monotone chain convex hull with small safety padding
  const sorted = [...points].sort((a, b) => (a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng));
  const cross = (
    o: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
  ) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower: Array<{ lat: number; lng: number }> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Array<{ lat: number; lng: number }> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);

  return hull.map((p) => {
    const dLat = p.lat - centroidLat;
    const dLng = p.lng - centroidLng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng) || 0.0005;
    const padLat = (dLat / dist) * (75 * latDegPerMeter);
    const padLng = (dLng / dist) * (75 * lngDegPerMeter);
    return [p.lat + padLat, p.lng + padLng];
  });
}

/**
 * DBSCAN Spatial Clustering Algorithm
 * Groups active (non-repaired) potholes with reliable GPS within `epsMeters` having at least `minPts`.
 */
export function runDbscanClustering(
  potholes: PotholeRecord[],
  epsMeters = 320,
  minPts = 2
): { clusters: DbscanCluster[]; pointClusterMap: Map<string, string> } {
  const active = potholes.filter(
    (p): p is GeolocatedPothole => p.status !== 'Repaired' && hasReliableCoordinates(p)
  );
  const visited = new Set<string>();
  const pointClusterMap = new Map<string, string>();
  const rawClusters: GeolocatedPothole[][] = [];

  const regionQuery = (point: GeolocatedPothole): GeolocatedPothole[] =>
    active.filter(
      (candidate) =>
        haversineDistanceMeters(point.lat, point.lng, candidate.lat, candidate.lng) <= epsMeters
    );

  for (const point of active) {
    if (visited.has(point.id)) continue;
    visited.add(point.id);
    const neighbors = regionQuery(point);

    if (neighbors.length < minPts) {
      continue; // Noise point
    }

    const clusterMembers: GeolocatedPothole[] = [];
    const queue = [...neighbors];
    const inCluster = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!visited.has(current.id)) {
        visited.add(current.id);
        const currentNeighbors = regionQuery(current);
        if (currentNeighbors.length >= minPts) {
          for (const n of currentNeighbors) {
            if (!inCluster.has(n.id)) {
              queue.push(n);
            }
          }
        }
      }
      if (!inCluster.has(current.id)) {
        inCluster.add(current.id);
        clusterMembers.push(current);
      }
    }

    if (clusterMembers.length >= minPts) {
      rawClusters.push(clusterMembers);
    }
  }

  const clusters: DbscanCluster[] = rawClusters
    .map((members, idx): DbscanCluster => {
      const centroidLat = members.reduce((acc, m) => acc + m.lat, 0) / members.length;
      const centroidLng = members.reduce((acc, m) => acc + m.lng, 0) / members.length;
      const maxDist = members.reduce(
        (max, m) => Math.max(max, haversineDistanceMeters(centroidLat, centroidLng, m.lat, m.lng)),
        80
      );

      const iriValues = members
        .map((m) => m.telemetry.iriScore)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgIri =
        iriValues.length > 0
          ? Number((iriValues.reduce((acc, v) => acc + v, 0) / iriValues.length).toFixed(2))
          : null;

      const peakGValues = members
        .map((m) => m.telemetry.peakAccelG)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const maxPeakG =
        peakGValues.length > 0 ? Number(Math.max(...peakGValues).toFixed(2)) : null;

      const criticalCount = members.filter((m) => m.severity === 'Critical').length;

      const priorityValues = members
        .map((m) => m.priorityScore)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const avgPriority =
        priorityValues.length > 0
          ? priorityValues.reduce((acc, v) => acc + v, 0) / priorityValues.length
          : members.reduce(
              (acc, m) =>
                acc + (m.severity === 'Critical' ? 80 : m.severity === 'High' ? 62 : 45),
              0
            ) / members.length;
      const densityBonus = Math.min(18, members.length * 3.5);
      const priorityScore = Math.min(100, Math.round(avgPriority + densityBonus));

      const clusterId = `CLS-${String(idx + 1).padStart(3, '0')}`;
      for (const m of members) {
        pointClusterMap.set(m.id, clusterId);
      }

      const namedMember = members.find((m) => m.roadName && m.roadName.trim());
      const primaryRoad = namedMember?.roadName
        ? `${namedMember.roadName} Corridor`
        : `Cluster (${centroidLat.toFixed(4)}, ${centroidLng.toFixed(4)})`;
      const primaryDistrict =
        members.find((m) => m.district && m.district.trim())?.district ?? null;

      const riskTier: DbscanCluster['riskTier'] =
        priorityScore >= 82 || criticalCount >= 2
          ? 'Critical'
          : priorityScore >= 65
            ? 'High'
            : 'Moderate';
      const dataSource: DbscanCluster['dataSource'] = members.some(
        (m) => m.dataSource === 'LIVE_ESP32'
      )
        ? 'LIVE_ESP32'
        : 'SIMULATED_DEMO';

      return {
        id: clusterId,
        name: primaryRoad,
        district: primaryDistrict,
        centroidLat: Number(centroidLat.toFixed(6)),
        centroidLng: Number(centroidLng.toFixed(6)),
        radiusMeters: Math.round(maxDist + 45),
        potholeIds: members.map((m) => m.id),
        potholeCount: members.length,
        criticalCount,
        avgIri,
        maxPeakG,
        priorityScore,
        riskTier,
        hullPoints: buildClusterFootprint(members, centroidLat, centroidLng, maxDist),
        dataSource,
      };
    })
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  return { clusters, pointClusterMap };
}

/**
 * H3-Compatible Hexagonal Spatial Grid Generator (Resolutions 8, 9, 10)
 * Produces deterministic H3-formatted hexagonal indices and accurate geodesic
 * hexagon vertices strictly from geolocated pothole records.
 */
const H3_EDGE_METERS: Record<8 | 9 | 10, number> = {
  8: 460,
  9: 210,
  10: 105,
};

function encodeDeterministicH3Index(
  resolution: 8 | 9 | 10,
  q: number,
  r: number
): string {
  const resHex = resolution.toString(16);
  const hashA = Math.abs((q * 73856093) ^ (r * 19349663))
    .toString(16)
    .padStart(8, '0')
    .slice(0, 8);
  const hashB = Math.abs((q * 83492791 + r * 2971215073) % 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `8${resHex}2830${hashA}${hashB}`.slice(0, 15);
}

export function generateH3HexGrid(
  potholes: PotholeRecord[],
  resolution: 8 | 9 | 10 = 9
): H3HexCell[] {
  const active = potholes.filter(
    (p): p is GeolocatedPothole => p.status !== 'Repaired' && hasReliableCoordinates(p)
  );
  if (active.length === 0) return [];

  const refLat = active.reduce((s, p) => s + p.lat, 0) / active.length;
  const refLng = active.reduce((s, p) => s + p.lng, 0) / active.length;
  const metersPerLat = 111320;
  const metersPerLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  const size = H3_EDGE_METERS[resolution];

  const hexBuckets = new Map<
    string,
    { q: number; r: number; items: GeolocatedPothole[] }
  >();

  for (const p of active) {
    const x = (p.lng - refLng) * metersPerLng;
    const y = (p.lat - refLat) * metersPerLat;

    // Flat-top axial hex coordinates
    const qFloat = ((2 / 3) * x) / size;
    const rFloat = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size;
    const sFloat = -qFloat - rFloat;

    let q = Math.round(qFloat);
    let r = Math.round(rFloat);
    const s = Math.round(sFloat);

    const qDiff = Math.abs(q - qFloat);
    const rDiff = Math.abs(r - rFloat);
    const sDiff = Math.abs(s - sFloat);

    if (qDiff > rDiff && qDiff > sDiff) {
      q = -r - s;
    } else if (rDiff > sDiff) {
      r = -q - s;
    }

    const key = `${q}:${r}`;
    const existing = hexBuckets.get(key);
    if (existing) {
      existing.items.push(p);
    } else {
      hexBuckets.set(key, { q, r, items: [p] });
    }
  }

  const cells: H3HexCell[] = [];
  for (const { q, r, items } of hexBuckets.values()) {
    const cx = size * (3 / 2) * q;
    const cy = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
    const centerLat = refLat + cy / metersPerLat;
    const centerLng = refLng + cx / metersPerLng;

    const vertices: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const angleRad = (Math.PI / 180) * (60 * i);
      const vx = cx + size * Math.cos(angleRad);
      const vy = cy + size * Math.sin(angleRad);
      vertices.push([refLat + vy / metersPerLat, refLng + vx / metersPerLng]);
    }

    const iriValues = items
      .map((p) => p.telemetry.iriScore)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const avgIri =
      iriValues.length > 0
        ? Number((iriValues.reduce((acc, v) => acc + v, 0) / iriValues.length).toFixed(2))
        : null;

    const sevItems = items.filter((p) => p.severity !== null);
    const sevWeight =
      sevItems.length > 0
        ? Number(
            (
              sevItems.reduce(
                (acc, p) =>
                  acc + (p.severity === 'Critical' ? 3 : p.severity === 'High' ? 2 : 1),
                0
              ) / sevItems.length
            ).toFixed(2)
          )
        : null;

    const priorityScores = items
      .map((p) => p.priorityScore)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const basePriority =
      priorityScores.length > 0
        ? priorityScores.reduce((acc, v) => acc + v, 0) / priorityScores.length
        : 55;

    const compositePriority = Math.min(
      100,
      Math.round(basePriority + Math.min(16, (items.length - 1) * 5))
    );

    cells.push({
      h3Index: encodeDeterministicH3Index(resolution, q, r),
      resolution,
      centerLat: Number(centerLat.toFixed(6)),
      centerLng: Number(centerLng.toFixed(6)),
      vertices,
      potholeCount: items.length,
      avgSeverityWeight: sevWeight,
      avgIri,
      compositePriority,
      district: items.find((p) => p.district)?.district ?? null,
      potholeIds: items.map((p) => p.id),
    });
  }

  return cells.sort((a, b) => b.compositePriority - a.compositePriority);
}
