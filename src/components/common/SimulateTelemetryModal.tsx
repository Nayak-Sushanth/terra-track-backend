import React, { useState } from 'react';
import { Radio, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal } from './Modal';
import type {
  Esp32Device,
  RoadArterialClass,
  TelemetryIngestPayload,
} from '../../types';

interface SimulateTelemetryModalProps {
  open: boolean;
  onClose: () => void;
  devices: Esp32Device[];
  onSubmitTelemetry: (payload: TelemetryIngestPayload) => Promise<{
    acceptedIntoPotholeWorkflow: boolean;
    reason: string;
  }>;
}

const PRESET_LOCATIONS = [
  {
    roadName: 'MG Road & Brigade Rd Corridor',
    district: 'Central Civic Ward',
    arterialClass: 'Arterial' as RoadArterialClass,
    lat: 12.9756,
    lng: 77.6066,
  },
  {
    roadName: 'Outer Ring Rd & Bellandur Junction',
    district: 'East Arterial Zone',
    arterialClass: 'Highway' as RoadArterialClass,
    lat: 12.9279,
    lng: 77.6762,
  },
  {
    roadName: 'Indiranagar 100ft Rd Corridor',
    district: 'Indiranagar Ward',
    arterialClass: 'Arterial' as RoadArterialClass,
    lat: 12.9784,
    lng: 77.6408,
  },
  {
    roadName: 'Jayanagar 4th Block Connector',
    district: 'South Municipal Ward',
    arterialClass: 'Collector' as RoadArterialClass,
    lat: 12.9299,
    lng: 77.5824,
  },
];

export const SimulateTelemetryModal: React.FC<SimulateTelemetryModalProps> = ({
  open,
  onClose,
  devices,
  onSubmitTelemetry,
}) => {
  const [deviceId, setDeviceId] = useState(devices[0]?.id || 'ESP32-VAN-01');
  const [locationIdx, setLocationIdx] = useState(0);
  const [peakAccelG, setPeakAccelG] = useState(4.15);
  const [iriScore, setIriScore] = useState(7.6);
  const [speedKmh, setSpeedKmh] = useState(38);
  const [mlConfidence, setMlConfidence] = useState(94.2);
  const [manualSos, setManualSos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    accepted: boolean;
    reason: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLastResult(null);
    const loc = PRESET_LOCATIONS[locationIdx] || PRESET_LOCATIONS[0];
    const jitterLat = (Math.random() - 0.5) * 0.0012;
    const jitterLng = (Math.random() - 0.5) * 0.0012;

    try {
      const result = await onSubmitTelemetry({
        deviceId,
        roadName: loc.roadName,
        district: loc.district,
        arterialClass: loc.arterialClass,
        lat: Number((loc.lat + jitterLat).toFixed(6)),
        lng: Number((loc.lng + jitterLng).toFixed(6)),
        condition: 'Pothole',
        peakAccelG: Number(peakAccelG),
        rmsVibration: Number((peakAccelG * 0.64).toFixed(2)),
        iriScore: Number(iriScore),
        speedKmh: Number(speedKmh),
        mlConfidence: Number(mlConfidence),
        manualSos,
        operatorName: 'Demo Patrol Operator',
        dataSource: 'SIMULATED_DEMO',
      });
      setLastResult({
        accepted: result.acceptedIntoPotholeWorkflow,
        reason: result.reason,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Simulate ESP32 + MPU6050 Pothole Packet (DEMO MODE)"
      subtitle="Test pothole detection ingestion and independent manual SOS alerts without live hardware."
      maxWidthClass="max-w-xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="neu-btn h-9 px-3.5 text-[12px] font-medium text-[#17243A]"
          >
            Close
          </button>
          <button
            type="submit"
            form="simulate-telemetry-form"
            disabled={submitting}
            className="neu-btn-primary inline-flex h-9 items-center gap-1.5 px-4 text-[12px] font-semibold disabled:opacity-50"
          >
            <Radio className="h-3.5 w-3.5" />
            {submitting ? 'Ingesting Packet...' : 'Transmit Pothole Packet'}
          </button>
        </>
      }
    >
      <form id="simulate-telemetry-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label-caps block text-[#52627A]">ESP32 Hardware Node</label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} — {d.vehicleLabel}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Simulated Municipal Corridor</label>
            <select
              value={locationIdx}
              onChange={(e) => setLocationIdx(Number(e.target.value))}
              className="neu-input mt-1.5 h-9 w-full px-3 text-[12px]"
            >
              {PRESET_LOCATIONS.map((loc, idx) => (
                <option key={loc.roadName} value={idx}>
                  {loc.roadName} ({loc.district})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label-caps block text-[#52627A]">Peak Z-Axis (g)</label>
            <input
              type="number"
              step="0.05"
              min="0.5"
              max="8.0"
              value={peakAccelG}
              onChange={(e) => setPeakAccelG(Number(e.target.value))}
              className="neu-input mt-1.5 h-9 w-full px-2.5 font-mono text-[12px]"
            />
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">IRI (m/km)</label>
            <input
              type="number"
              step="0.1"
              min="1.0"
              max="12.0"
              value={iriScore}
              onChange={(e) => setIriScore(Number(e.target.value))}
              className="neu-input mt-1.5 h-9 w-full px-2.5 font-mono text-[12px]"
            />
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">Speed (km/h)</label>
            <input
              type="number"
              min="0"
              max="120"
              value={speedKmh}
              onChange={(e) => setSpeedKmh(Number(e.target.value))}
              className="neu-input mt-1.5 h-9 w-full px-2.5 font-mono text-[12px]"
            />
          </div>
          <div>
            <label className="label-caps block text-[#52627A]">ML Conf (%)</label>
            <input
              type="number"
              step="0.5"
              min="50"
              max="100"
              value={mlConfidence}
              onChange={(e) => setMlConfidence(Number(e.target.value))}
              className="neu-input mt-1.5 h-9 w-full px-2.5 font-mono text-[12px]"
            />
          </div>
        </div>

        <div className="neu-sos-panel p-3.5">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={manualSos}
              onChange={(e) => setManualSos(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-[#DC2626]"
            />
            <div>
              <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#DC2626]">
                <AlertTriangle className="h-3.5 w-3.5" />
                Also Simulate Independent Physical Manual SOS Push-Button Event
              </div>
              <p className="mt-0.5 text-[11px] text-[#7F1D1D]">
                Dispatches an emergency SOS alert on the independent physical button channel.
              </p>
            </div>
          </label>
        </div>

        {lastResult && (
          <div
            className={`rounded-xl border p-3.5 text-[12px] ${
              lastResult.accepted
                ? 'border-[#86EFAC] bg-[#E8F8EE] text-[#166534]'
                : 'neu-inset text-[#52627A]'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {lastResult.accepted
                ? 'Admitted to Pothole Workflow & Map'
                : 'Below Pothole Threshold'}
            </div>
            <p className="mt-1 text-[11px]">{lastResult.reason}</p>
          </div>
        )}
      </form>
    </Modal>
  );
};
