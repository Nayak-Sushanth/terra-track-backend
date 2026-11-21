import type { RoadConditionClass, TelemetryIngestPayload } from '../types/index.ts';

/**
 * ESP32 + MPU6050 Pothole Telemetry Validator
 *
 * Strictly only valid `Pothole` detections meeting confidence and peak G-force
 * thresholds enter the municipal pothole reporting and maintenance workflow.
 * Manual SOS is processed independently.
 */

export interface ClassificationEvaluation {
  condition: RoadConditionClass;
  entersPotholeWorkflow: boolean;
  reason: string;
}

export function evaluateRoadConditionGate(
  payload: Pick<TelemetryIngestPayload, 'condition' | 'mlConfidence' | 'peakAccelG'>,
  confidenceCutoffPct: number,
  minTriggerG: number
): ClassificationEvaluation {
  if (payload.condition !== 'Pothole') {
    return {
      condition: 'Pothole',
      entersPotholeWorkflow: false,
      reason: 'Only Pothole classifications may enter the municipal pothole workflow.',
    };
  }

  if (payload.mlConfidence < confidenceCutoffPct) {
    return {
      condition: 'Pothole',
      entersPotholeWorkflow: false,
      reason: `Pothole confidence (${payload.mlConfidence.toFixed(1)}%) below configured ${confidenceCutoffPct}% cutoff.`,
    };
  }

  if (payload.peakAccelG < minTriggerG) {
    return {
      condition: 'Pothole',
      entersPotholeWorkflow: false,
      reason: `Peak Z-axis G-force (${payload.peakAccelG.toFixed(2)}g) below ${minTriggerG.toFixed(2)}g hardware trigger threshold.`,
    };
  }

  return {
    condition: 'Pothole',
    entersPotholeWorkflow: true,
    reason: `Validated Pothole event (${payload.mlConfidence.toFixed(1)}% confidence, ${payload.peakAccelG.toFixed(2)}g peak) admitted to municipal pothole workflow.`,
  };
}
