import type {
  PotholeRecord,
  PriorityEngineWeights,
  RoadArterialClass,
  SeverityLevel,
} from '../types/index.ts';
import { DEFAULT_PRIORITY_WEIGHTS } from '../config/appConfig.ts';

const SEVERITY_BASE_SCORE: Record<SeverityLevel, number> = {
  Critical: 100,
  High: 72,
  Moderate: 42,
};

const ARTERIAL_BASE_SCORE: Record<RoadArterialClass, number> = {
  Highway: 100,
  Arterial: 88,
  Collector: 64,
  Local: 40,
};

export interface PriorityBreakdown {
  totalScore: number;
  tier: 'P1' | 'P2' | 'P3';
  factors: {
    severityComponent: number;
    peakGComponent: number;
    arterialComponent: number;
    clusterComponent: number;
    ageComponent: number;
  };
}

/**
 * Municipal Priority Calculation Engine
 * Computes a deterministic 0-100 triage index from MPU6050 sensor readings,
 * road classification, DBSCAN spatial cluster density, and exposure age.
 * Safely handles nullable live telemetry without inventing fake sensor inputs.
 */
export function calculatePotholePriority(
  input: {
    severity: SeverityLevel | null;
    peakAccelG: number | null;
    arterialClass: RoadArterialClass | null;
    clusterNeighborCount: number;
    detectedAt: string | null;
  },
  weights: PriorityEngineWeights = DEFAULT_PRIORITY_WEIGHTS
): PriorityBreakdown {
  const activeParts: Array<{ key: keyof PriorityBreakdown['factors']; norm: number; weight: number }> = [];

  if (input.severity) {
    activeParts.push({
      key: 'severityComponent',
      norm: SEVERITY_BASE_SCORE[input.severity],
      weight: weights.severityWeight,
    });
  }

  if (typeof input.peakAccelG === 'number' && Number.isFinite(input.peakAccelG)) {
    activeParts.push({
      key: 'peakGComponent',
      norm: Math.min(100, Math.max(10, ((input.peakAccelG - 1.5) / 4.0) * 100)),
      weight: weights.peakGWeight,
    });
  }

  if (input.arterialClass) {
    activeParts.push({
      key: 'arterialComponent',
      norm: ARTERIAL_BASE_SCORE[input.arterialClass],
      weight: weights.arterialWeight,
    });
  }

  activeParts.push({
    key: 'clusterComponent',
    norm: Math.min(100, (Math.max(1, input.clusterNeighborCount) / 6) * 100),
    weight: weights.clusterDensityWeight,
  });

  if (input.detectedAt) {
    const ts = new Date(input.detectedAt).getTime();
    if (!Number.isNaN(ts)) {
      const ageDays = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
      activeParts.push({
        key: 'ageComponent',
        norm: Math.min(100, (ageDays / 14) * 100),
        weight: weights.ageWeight,
      });
    }
  }

  const totalWeight = activeParts.reduce((s, p) => s + p.weight, 0) || 100;

  const factors: PriorityBreakdown['factors'] = {
    severityComponent: 0,
    peakGComponent: 0,
    arterialComponent: 0,
    clusterComponent: 0,
    ageComponent: 0,
  };

  let rawTotal = 0;
  for (const part of activeParts) {
    const contribution = (part.norm * part.weight) / totalWeight;
    factors[part.key] = Math.round(contribution);
    rawTotal += contribution;
  }

  const totalScore = Math.round(Math.min(100, Math.max(1, rawTotal)));
  const tier: 'P1' | 'P2' | 'P3' =
    totalScore >= 78 ? 'P1' : totalScore >= 55 ? 'P2' : 'P3';

  return {
    totalScore,
    tier,
    factors,
  };
}

export function recalculatePotholePriorities(
  potholes: PotholeRecord[],
  weights: PriorityEngineWeights
): PotholeRecord[] {
  const clusterCounts = new Map<string, number>();
  for (const p of potholes) {
    if (p.clusterId) {
      clusterCounts.set(p.clusterId, (clusterCounts.get(p.clusterId) || 0) + 1);
    }
  }

  return potholes.map((p) => {
    const hasCoreInput =
      p.severity !== null ||
      (typeof p.telemetry.peakAccelG === 'number' && Number.isFinite(p.telemetry.peakAccelG));
    if (!hasCoreInput && p.priorityScore === null) {
      return p;
    }

    const breakdown = calculatePotholePriority(
      {
        severity: p.severity,
        peakAccelG: p.telemetry.peakAccelG,
        arterialClass: p.arterialClass,
        clusterNeighborCount: p.clusterId ? clusterCounts.get(p.clusterId) || 1 : 1,
        detectedAt: p.detectedAt,
      },
      weights
    );
    return {
      ...p,
      priorityScore: breakdown.totalScore,
      priorityTier: breakdown.tier,
    };
  });
}

export function classifySeverityFromSensor(peakAccelG: number, iriScore: number): SeverityLevel {
  if (peakAccelG >= 3.8 || iriScore >= 7.2) return 'Critical';
  if (peakAccelG >= 2.8 || iriScore >= 5.2) return 'High';
  return 'Moderate';
}
