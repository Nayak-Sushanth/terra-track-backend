import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  Layers,
  Crosshair,
  Wrench,
  CheckCircle,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  RoadMapCanvas,
  hasValidMapCoordinates,
  type BaseMapStyle,
  type MapLayerVisibility,
} from '../components/map/RoadMapCanvas';
import {
  DataSourceTag,
  PotholeStatusBadge,
  SeverityBadge,
  VerificationBadge,
} from '../components/common/Badges';
import {
  displayOrNA,
  formatConfidence,
  formatIri,
  formatLatLngPair,
  formatNumberOrNA,
  formatPeakG,
  formatShortTimestamp,
} from '../utilities/formatters';
import { calculatePotholePriority } from '../utilities/priorityEngine';
import type {
  PotholeRecord,
  PotholeStatus,
  SeverityLevel,
  TerraWorkspaceState,
} from '../types';

interface LiveRoadMapProps {
  workspace: TerraWorkspaceState;
  selectedPotholeId: string | null;
  focusCoord: { lat: number; lng: number; zoom?: number } | null;
  onSelectPothole: (pothole: PotholeRecord | null) => void;
  onUpdatePotholeStatus: (id: string, status: PotholeStatus) => Promise<void>;
  onCreateRepairForPothole: (pothole: PotholeRecord) => void;
}

export const LiveRoadMap: React.FC<LiveRoadMapProps> = ({
  workspace,
  selectedPotholeId,
  focusCoord,
  onSelectPothole,
  onUpdatePotholeStatus,
  onCreateRepairForPothole,
}) => {
  const [severityFilter, setSeverityFilter] = useState<'All' | SeverityLevel | 'Repaired'>('All');
  const [baseStyle, setBaseStyle] = useState<BaseMapStyle>('osm');
  const [showLayerMenu, setShowLayerMenu] = useState(true);
  const [layers, setLayers] = useState<MapLayerVisibility>({
    potholes: true,
    heatmap: false,
    dbscanClusters: true,
    h3HexGrid: false,
    devices: true,
    sosAlerts: true,
  });

  const filteredPotholes = useMemo(() => {
    return workspace.potholes.filter((p) => {
      if (
        p.isVerifiedForMap === false ||
        !hasValidMapCoordinates(p.lat, p.lng, p.dataSource, p.hasReliableGps)
      ) {
        return false;
      }
      if (severityFilter === 'All') return true;
      if (severityFilter === 'Repaired') return p.status === 'Repaired';
      return p.severity === severityFilter && p.status !== 'Repaired';
    });
  }, [workspace.potholes, severityFilter]);

  const unmappedCount = useMemo(
    () =>
      workspace.potholes.filter(
        (p) =>
          p.isVerifiedForMap === false ||
          !hasValidMapCoordinates(p.lat, p.lng, p.dataSource, p.hasReliableGps)
      ).length,
    [workspace.potholes]
  );

  const selectedPothole = useMemo(
    () =>
      filteredPotholes.find((p) => p.id === selectedPotholeId) ||
      filteredPotholes[0] ||
      null,
    [selectedPotholeId, filteredPotholes]
  );

  const priorityBreakdown = useMemo(() => {
    if (!selectedPothole) return null;
    if (selectedPothole.severity === null && selectedPothole.telemetry.peakAccelG === null) {
      return null;
    }
    const clusterCount = selectedPothole.clusterId
      ? workspace.clusters.find((c) => c.id === selectedPothole.clusterId)?.potholeCount || 1
      : 1;
    return calculatePotholePriority(
      {
        severity: selectedPothole.severity,
        peakAccelG: selectedPothole.telemetry.peakAccelG,
        arterialClass: selectedPothole.arterialClass,
        clusterNeighborCount: clusterCount,
        detectedAt: selectedPothole.detectedAt,
      },
      workspace.settings.priorityWeights
    );
  }, [selectedPothole, workspace.clusters, workspace.settings.priorityWeights]);

  const waveformData = useMemo(() => {
    if (!selectedPothole) return [];
    return selectedPothole.telemetry.waveformSample.map((g, idx) => ({
      ms: `${idx * 15}ms`,
      g,
    }));
  }, [selectedPothole]);

  const toggleLayer = (key: keyof MapLayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-4">
      {/* Soft Elevated GIS Toolbar */}
      <div className="neu-surface-sm flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-caps mr-1 text-[#718096]">Severity Filter:</span>
          {(['All', 'Critical', 'High', 'Moderate', 'Repaired'] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setSeverityFilter(level)}
              className={`h-7 px-3 text-[12px] font-semibold whitespace-nowrap ${
                severityFilter === level
                  ? 'neu-btn-primary'
                  : 'neu-btn text-[#52627A] hover:text-[#17243A]'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] font-medium text-[#718096]">
            Showing {filteredPotholes.length} geolocated markers
            {unmappedCount > 0 ? ` · ${unmappedCount} omitted (no reliable GPS)` : ''}
          </span>
          <button
            type="button"
            onClick={() => setShowLayerMenu((v) => !v)}
            className={`inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-semibold ${
              showLayerMenu ? 'neu-nav-active' : 'neu-btn text-[#17243A]'
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-[#356AE6]" />
            Map Layers
          </button>
        </div>
      </div>

      {/* 65/35 GIS Viewport + Incident Inspector Split */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Map Container with Floating Raised Layer Palette (zero inner shadows obscuring tiles) */}
        <div className="relative xl:col-span-8">
          <RoadMapCanvas
            potholes={filteredPotholes}
            clusters={workspace.clusters}
            h3Cells={workspace.h3Cells}
            devices={workspace.devices}
            sosAlerts={workspace.alerts}
            selectedPotholeId={selectedPothole?.id || null}
            focusCoord={focusCoord}
            layers={layers}
            baseStyle={baseStyle}
            heightClass="h-[580px]"
            onSelectPothole={(p) => onSelectPothole(p)}
          />

          {/* Floating Soft Raised Map Layer Control Palette */}
          {showLayerMenu && (
            <div className="absolute right-4 top-4 z-[400] w-60 rounded-2xl border border-white/75 bg-[#EEF2F7]/95 backdrop-blur-sm p-3.5 shadow-[6px_6px_16px_rgba(23,36,58,0.18),-4px_-4px_10px_rgba(255,255,255,0.65)]">
              <div className="flex items-center justify-between border-b neu-divider pb-2.5">
                <span className="label-caps flex items-center gap-1.5 text-[#17243A]">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-[#356AE6]" />
                  GIS Vector Layers
                </span>
                <button
                  type="button"
                  onClick={() => setShowLayerMenu(false)}
                  className="neu-btn flex h-6 w-6 items-center justify-center text-[#52627A] hover:text-[#17243A]"
                  aria-label="Hide layer controls"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2.5 space-y-1.5 text-[12px]">
                {(
                  [
                    ['potholes', 'Severity Pothole Markers'],
                    ['heatmap', 'Hazard Heatmap Radius'],
                    ['dbscanClusters', 'DBSCAN Cluster Polygons'],
                    ['h3HexGrid', `H3 Hex Grid (Res ${workspace.settings.h3DefaultResolution})`],
                    ['devices', 'ESP32 Patrol Fleet'],
                    ['sosAlerts', 'Manual SOS Pins'],
                  ] as Array<[keyof MapLayerVisibility, string]>
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between gap-2 py-0.5 text-[#17243A] font-medium"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={layers[key]}
                      onChange={() => toggleLayer(key)}
                      className="h-3.5 w-3.5 rounded accent-[#356AE6]"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 border-t neu-divider pt-2.5">
                <div className="label-caps mb-1.5 text-[#718096]">Base Tile Style</div>
                <div className="neu-tab-track grid grid-cols-3 gap-1">
                  {(
                    [
                      ['osm', 'OSM'],
                      ['light', 'Light'],
                      ['dark', 'Dark'],
                    ] as Array<[BaseMapStyle, string]>
                  ).map(([styleKey, label]) => (
                    <button
                      key={styleKey}
                      type="button"
                      onClick={() => setBaseStyle(styleKey)}
                      className={`h-6 text-[11px] font-semibold ${
                        baseStyle === styleKey ? 'neu-tab-active' : 'neu-tab-inactive'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Telemetry & Pothole Inspector Drawer */}
        <div className="xl:col-span-4 neu-card flex flex-col overflow-hidden h-[594px]">
          <div className="flex items-center justify-between border-b neu-divider px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-[#356AE6]" />
              <span className="text-[14px] font-bold text-[#17243A]">
                Pothole Telemetry Inspector
              </span>
            </div>
            {selectedPothole && <DataSourceTag source={selectedPothole.dataSource} compact />}
          </div>

          {selectedPothole ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[14px] font-bold text-[#17243A]">
                    {displayOrNA(selectedPothole.eventId ?? selectedPothole.id)}
                  </span>
                  <SeverityBadge
                    severity={
                      selectedPothole.status === 'Repaired'
                        ? 'Repaired'
                        : selectedPothole.severity
                    }
                    rawLabel={selectedPothole.rawSeverity}
                    pulse={
                      selectedPothole.severity === 'Critical' &&
                      selectedPothole.status !== 'Repaired'
                    }
                  />
                  <PotholeStatusBadge
                    status={selectedPothole.status}
                    rawLabel={selectedPothole.rawStatus}
                  />
                  <VerificationBadge verified={selectedPothole.verified} />
                </div>
                <div className="mt-2 text-[14px] font-bold text-[#17243A]">
                  {displayOrNA(selectedPothole.roadName)}
                </div>
                <div className="text-[12px] text-[#718096] mt-0.5">
                  Pothole ID: <span className="font-mono text-[#52627A]">{selectedPothole.id}</span> ·{' '}
                  {displayOrNA(selectedPothole.district)} · {displayOrNA(selectedPothole.arterialClass)}
                </div>
              </div>

              {/* Coordinates, Detection Time & Spatial Indices */}
              <div className="neu-inset grid grid-cols-2 gap-3 p-3">
                <div>
                  <div className="label-caps text-[#718096]">Event ID</div>
                  <div className="mt-0.5 font-mono text-[11px] font-semibold text-[#17243A]">
                    {displayOrNA(selectedPothole.eventId)}
                  </div>
                </div>
                <div>
                  <div className="label-caps text-[#718096]">Detection Time</div>
                  <div className="mt-0.5 font-mono text-[11px] font-semibold text-[#17243A]">
                    {formatShortTimestamp(selectedPothole.detectedAt)}
                  </div>
                </div>
                <div>
                  <div className="label-caps text-[#718096]">GPS Coordinates</div>
                  <div className="mt-0.5 font-mono text-[11px] font-semibold text-[#17243A]">
                    {formatLatLngPair(selectedPothole.lat, selectedPothole.lng)}
                  </div>
                </div>
                <div>
                  <div className="label-caps text-[#718096]">H3 Spatial Cell</div>
                  <div className="mt-0.5 font-mono text-[11px] font-semibold text-[#17243A]">
                    {displayOrNA(selectedPothole.h3Index)}
                  </div>
                </div>
                <div>
                  <div className="label-caps text-[#718096]">DBSCAN Cluster</div>
                  <div className="mt-0.5 font-mono text-[11px] font-bold text-[#356AE6]">
                    {selectedPothole.clusterId || 'Isolated Point'}
                  </div>
                </div>
                <div>
                  <div className="label-caps text-[#718096]">Reporting ESP32</div>
                  <div className="mt-0.5 font-mono text-[11px] font-bold text-[#0F8B8D]">
                    {displayOrNA(selectedPothole.deviceId)}
                  </div>
                </div>
              </div>

              {/* MPU6050 Accelerometer Signature */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="label-caps text-[#52627A]">
                    MPU6050 Z-Axis Signature (Conf: {formatConfidence(selectedPothole.telemetry.mlConfidence)})
                  </span>
                  <span className="font-mono text-[11px] font-bold text-[#DC2626]">
                    Peak {formatPeakG(selectedPothole.telemetry.peakAccelG)}
                  </span>
                </div>
                <div className="neu-inset mt-2 h-[100px] w-full p-2">
                  {waveformData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={waveformData}>
                        <YAxis hide domain={[-3, 6]} />
                        <ReferenceLine y={1} stroke="#94A3B8" strokeDasharray="3 3" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#EEF2F7',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.75)',
                            fontSize: 11,
                            fontFamily: 'JetBrains Mono',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="g"
                          name="Z-Axis (g)"
                          stroke="#356AE6"
                          strokeWidth={2.2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center font-mono text-[11px] text-[#718096]">
                      N/A — No accelerometer waveform stored
                    </div>
                  )}
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-2.5 font-mono text-[11px]">
                  <div className="neu-inset-sm p-2.5">
                    <div className="text-[#718096]">IRI Score</div>
                    <div className="mt-0.5 font-bold text-[#17243A]">
                      {formatIri(selectedPothole.telemetry.iriScore)}
                    </div>
                  </div>
                  <div className="neu-inset-sm p-2.5">
                    <div className="text-[#718096]">RMS Vib</div>
                    <div className="mt-0.5 font-bold text-[#17243A]">
                      {selectedPothole.telemetry.rmsVibration !== null
                        ? `${formatNumberOrNA(selectedPothole.telemetry.rmsVibration, 2)} m/s²`
                        : 'N/A'}
                    </div>
                  </div>
                  <div className="neu-inset-sm p-2.5">
                    <div className="text-[#718096]">Speed</div>
                    <div className="mt-0.5 font-bold text-[#17243A]">
                      {selectedPothole.telemetry.speedKmh !== null
                        ? `${formatNumberOrNA(selectedPothole.telemetry.speedKmh, 1)} km/h`
                        : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Priority Score Breakdown */}
              {priorityBreakdown && (
                <div className="neu-inset p-3">
                  <div className="flex items-center justify-between">
                    <span className="label-caps text-[#52627A]">Priority Engine Score</span>
                    <span className="font-mono text-[13px] font-bold text-[#17243A]">
                      {priorityBreakdown.totalScore} / 100 ({priorityBreakdown.tier})
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#D5DCE8] shadow-[inset_1px_1px_3px_rgba(163,177,198,0.6)]">
                    <div
                      className="h-full rounded-full bg-[#356AE6]"
                      style={{ width: `${priorityBreakdown.totalScore}%` }}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-1 text-center font-mono text-[10px] text-[#52627A]">
                    <div>Sev +{priorityBreakdown.factors.severityComponent}</div>
                    <div>G +{priorityBreakdown.factors.peakGComponent}</div>
                    <div>Rd +{priorityBreakdown.factors.arterialComponent}</div>
                    <div>Cls +{priorityBreakdown.factors.clusterComponent}</div>
                    <div>Age +{priorityBreakdown.factors.ageComponent}</div>
                  </div>
                </div>
              )}

              {/* Notes & Source */}
              <div className="text-[12px] text-[#52627A]">
                <div className="label-caps text-[#718096]">Field & Sensor Notes</div>
                <p className="mt-1 leading-relaxed text-[#17243A]">
                  {displayOrNA(selectedPothole.notes)}
                </p>
                <div className="mt-1.5 font-mono text-[11px] text-[#718096]">
                  Source: {displayOrNA(selectedPothole.detectionSource)} · Passes:{' '}
                  {selectedPothole.detectionCount !== null ? selectedPothole.detectionCount : 'N/A'}
                </div>
              </div>

              {/* Action Controls */}
              <div className="flex flex-wrap items-center gap-2.5 border-t neu-divider pt-3.5">
                {selectedPothole.status === 'Detected' && (
                  <button
                    type="button"
                    onClick={() => onUpdatePotholeStatus(selectedPothole.id, 'Verified')}
                    className="neu-btn inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-[12px] font-semibold text-[#17243A]"
                  >
                    <CheckCircle className="h-3.5 w-3.5 text-[#1E9E63]" />
                    Verify Pothole
                  </button>
                )}
                {selectedPothole.status !== 'Repaired' && (
                  <button
                    type="button"
                    onClick={() => onCreateRepairForPothole(selectedPothole)}
                    className="neu-btn-primary inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-[12px] font-semibold"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    {selectedPothole.assignedWorkOrderId
                      ? `Linked ${selectedPothole.assignedWorkOrderId}`
                      : 'Assign Repair Crew'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-[#718096]">
              No geolocated pothole markers match the active filter. Markers without reliable GPS
              coordinates are excluded from the map.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
