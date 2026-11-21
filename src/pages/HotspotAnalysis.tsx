import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { RefreshCw, Hexagon, Wrench, Layers } from 'lucide-react';
import { MetricTile } from '../components/common/MetricTile';
import { RoadMapCanvas } from '../components/map/RoadMapCanvas';
import { SeverityBadge } from '../components/common/Badges';
import {
  displayOrNA,
  formatNumberOrNA,
  formatPeakG,
} from '../utilities/formatters';
import type {
  DbscanCluster,
  H3HexCell,
  TerraWorkspaceState,
} from '../types';

interface HotspotAnalysisProps {
  workspace: TerraWorkspaceState;
  onRecomputeHotspots: (params: {
    epsMeters: number;
    minPts: number;
    h3Resolution: 8 | 9 | 10;
  }) => Promise<void>;
  onCreateClusterRepair: (cluster: DbscanCluster) => void;
}

export const HotspotAnalysis: React.FC<HotspotAnalysisProps> = ({
  workspace,
  onRecomputeHotspots,
  onCreateClusterRepair,
}) => {
  const [epsMeters, setEpsMeters] = useState(workspace.settings.dbscanDefaultEpsMeters);
  const [minPts, setMinPts] = useState(workspace.settings.dbscanDefaultMinPts);
  const [h3Resolution, setH3Resolution] = useState<8 | 9 | 10>(
    workspace.settings.h3DefaultResolution
  );
  const [showDbscan, setShowDbscan] = useState(true);
  const [showH3, setShowH3] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(
    workspace.clusters[0]?.id || null
  );
  const [selectedH3, setSelectedH3] = useState<H3HexCell | null>(null);
  const [focusCoord, setFocusCoord] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null
  );

  const selectedCluster = useMemo(
    () =>
      workspace.clusters.find((c) => c.id === selectedClusterId) ||
      workspace.clusters[0] ||
      null,
    [workspace.clusters, selectedClusterId]
  );

  const handleRunAnalysis = async () => {
    setRecomputing(true);
    try {
      await onRecomputeHotspots({ epsMeters, minPts, h3Resolution });
    } finally {
      setRecomputing(false);
    }
  };

  const clusteredPotholeCount = useMemo(
    () => workspace.clusters.reduce((sum, c) => sum + c.potholeCount, 0),
    [workspace.clusters]
  );

  const chartData = useMemo(
    () =>
      workspace.clusters.map((c) => ({
        id: c.id,
        name: c.name,
        potholes: c.potholeCount,
        priority: c.priorityScore ?? 0,
        avgIri: c.avgIri,
        color:
          c.riskTier === 'Critical'
            ? '#DC2626'
            : c.riskTier === 'High'
              ? '#EA580C'
              : '#356AE6',
      })),
    [workspace.clusters]
  );

  // Frequently affected road sections strictly derived from actual geolocated potholes
  const frequentRoadSections = useMemo(() => {
    const groups = new Map<
      string,
      {
        section: string;
        district: string | null;
        count: number;
        criticalCount: number;
        latSum: number;
        lngSum: number;
        coordCount: number;
      }
    >();

    for (const p of workspace.potholes) {
      const hasValidGps =
        p.hasReliableGps !== false &&
        typeof p.lat === 'number' &&
        typeof p.lng === 'number' &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        !(p.lat === 0 && p.lng === 0);
      if (!hasValidGps) continue;

      const lat = p.lat as number;
      const lng = p.lng as number;
      const label = p.roadName?.trim()
        ? p.roadName.trim()
        : `GPS Sector (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      const key = label.toLowerCase();

      const entry = groups.get(key) || {
        section: label,
        district: p.district,
        count: 0,
        criticalCount: 0,
        latSum: 0,
        lngSum: 0,
        coordCount: 0,
      };
      entry.count += 1;
      if (p.severity === 'Critical') entry.criticalCount += 1;
      if (!entry.district && p.district) entry.district = p.district;
      entry.latSum += lat;
      entry.lngSum += lng;
      entry.coordCount += 1;
      groups.set(key, entry);
    }

    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        centerLat: g.latSum / g.coordCount,
        centerLng: g.lngSum / g.coordCount,
      }))
      .sort((a, b) => b.count - a.count || b.criticalCount - a.criticalCount)
      .slice(0, 8);
  }, [workspace.potholes]);

  return (
    <div className="space-y-5">
      {/* Spatial KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="DBSCAN Active Clusters"
          value={workspace.clusters.length}
          delta={`eps ${epsMeters}m · minPts ${minPts}`}
          deltaTone="telemetry"
          subtext={`${clusteredPotholeCount} grouped potholes`}
        />
        <MetricTile
          label="Critical Risk Corridors"
          value={workspace.clusters.filter((c) => c.riskTier === 'Critical').length}
          delta="Immediate Batch Paving"
          deltaTone="negative"
        />
        <MetricTile
          label={`H3 Resolution ${h3Resolution} Cells`}
          value={workspace.h3Cells.length}
          delta="Geodesic Hex Binning"
          deltaTone="neutral"
          subtext="Computed from reliable GPS"
        />
        <MetricTile
          label="Highest Corridor Priority"
          value={
            workspace.clusters[0]?.priorityScore !== null &&
            workspace.clusters[0]?.priorityScore !== undefined
              ? `${workspace.clusters[0].priorityScore} / 100`
              : 'N/A'
          }
          delta={workspace.clusters[0]?.id || 'N/A'}
          deltaTone="negative"
          subtext={displayOrNA(workspace.clusters[0]?.district)}
        />
      </div>

      {/* DBSCAN & H3 Parameter Tuning Bar */}
      <div className="neu-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-5">
            <div>
              <label className="label-caps block text-[#52627A]">
                DBSCAN Epsilon Radius: <span className="font-mono text-[#17243A]">{epsMeters}m</span>
              </label>
              <input
                type="range"
                min={120}
                max={650}
                step={20}
                value={epsMeters}
                onChange={(e) => setEpsMeters(Number(e.target.value))}
                className="mt-2 w-44 accent-[#356AE6]"
              />
            </div>

            <div>
              <label className="label-caps block text-[#52627A]">Min Cluster Points</label>
              <select
                value={minPts}
                onChange={(e) => setMinPts(Number(e.target.value))}
                className="neu-input mt-1.5 h-9 w-28 px-2.5 font-mono text-[12px]"
              >
                <option value={2}>2 points</option>
                <option value={3}>3 points</option>
                <option value={4}>4 points</option>
              </select>
            </div>

            <div>
              <label className="label-caps block text-[#52627A]">H3 Hex Resolution</label>
              <div className="neu-tab-track mt-1.5 inline-flex gap-1">
                {([8, 9, 10] as const).map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setH3Resolution(res)}
                    className={`h-7 px-3 font-mono text-[11px] font-semibold ${
                      h3Resolution === res ? 'neu-tab-active' : 'neu-tab-inactive'
                    }`}
                  >
                    Res {res}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3.5 pb-1.5 text-[12px] font-medium">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#17243A]">
                <input
                  type="checkbox"
                  checked={showDbscan}
                  onChange={(e) => setShowDbscan(e.target.checked)}
                  className="accent-[#356AE6]"
                />
                DBSCAN Hulls
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#17243A]">
                <input
                  type="checkbox"
                  checked={showH3}
                  onChange={(e) => setShowH3(e.target.checked)}
                  className="accent-[#356AE6]"
                />
                H3 Hex Grid
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#17243A]">
                <input
                  type="checkbox"
                  checked={showHeatmap}
                  onChange={(e) => setShowHeatmap(e.target.checked)}
                  className="accent-[#356AE6]"
                />
                Heat Radius
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRunAnalysis}
            disabled={recomputing}
            className="neu-btn-primary inline-flex h-9 items-center gap-1.5 px-4 text-[12px] font-semibold disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recomputing ? 'animate-spin' : ''}`} />
            {recomputing ? 'Computing Spatial Index...' : 'Run Spatial Analysis'}
          </button>
        </div>
      </div>

      {/* Map + Priority Chart Split */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8 neu-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[14px] font-bold text-[#17243A]">
              <Hexagon className="h-4 w-4 text-[#356AE6]" />
              DBSCAN Corridor Footprints & H3 Hexagonal Spatial Density
            </div>
            {selectedH3 && (
              <span className="neu-inset-sm px-2.5 py-1 font-mono text-[11px] font-semibold text-[#356AE6]">
                Selected H3: {selectedH3.h3Index} ({selectedH3.potholeCount} hazards · Priority{' '}
                {selectedH3.compositePriority})
              </span>
            )}
          </div>
          <RoadMapCanvas
            potholes={workspace.potholes.filter((p) => p.status !== 'Repaired')}
            clusters={workspace.clusters}
            h3Cells={workspace.h3Cells}
            selectedClusterId={selectedCluster?.id || null}
            focusCoord={focusCoord}
            layers={{
              potholes: true,
              heatmap: showHeatmap,
              dbscanClusters: showDbscan,
              h3HexGrid: showH3,
              devices: false,
              sosAlerts: false,
            }}
            heightClass="h-[440px]"
            onSelectCluster={(cluster) => {
              setSelectedClusterId(cluster.id);
              setFocusCoord({
                lat: cluster.centroidLat,
                lng: cluster.centroidLng,
                zoom: 15,
              });
            }}
            onSelectH3Cell={(cell) => {
              setSelectedH3(cell);
              setFocusCoord({ lat: cell.centerLat, lng: cell.centerLng, zoom: 15 });
            }}
          />
        </div>

        <div className="xl:col-span-4 neu-card p-4 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[14px] font-bold text-[#17243A]">
              <Layers className="h-4 w-4 text-[#0F8B8D]" />
              Cluster Composite Priority Ranking
            </div>
            <p className="mt-0.5 text-[11px] text-[#718096]">
              Computed strictly from geolocated Firestore potholes (eps {epsMeters}m, minPts {minPts})
            </p>
            <div className="neu-inset mt-3.5 h-[248px] w-full p-2.5">
              {chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-center font-mono text-[11px] text-[#718096]">
                  No DBSCAN clusters formed yet (requires at least {minPts} geolocated potholes within{' '}
                  {epsMeters}m).
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 177, 198, 0.42)" />
                    <XAxis
                      dataKey="id"
                      tick={{ fontSize: 10, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#EEF2F7',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.75)',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="priority" name="Priority Score" radius={[6, 6, 0, 0]}>
                      {chartData.map((item) => (
                        <Cell key={item.id} fill={item.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {selectedCluster ? (
            <div className="neu-inset p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] font-bold text-[#17243A]">
                  {selectedCluster.id}
                </span>
                <SeverityBadge severity={selectedCluster.riskTier} showTier={false} />
              </div>
              <div className="mt-1.5 text-[13px] font-bold text-[#17243A]">
                {selectedCluster.name}
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono text-[11px] text-[#52627A]">
                <div>Count: {selectedCluster.potholeCount}</div>
                <div>IRI: {formatNumberOrNA(selectedCluster.avgIri, 1)}</div>
                <div>Max: {formatPeakG(selectedCluster.maxPeakG)}</div>
              </div>
              <button
                type="button"
                onClick={() => onCreateClusterRepair(selectedCluster)}
                className="neu-btn-primary mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 px-3 text-[12px] font-semibold"
              >
                <Wrench className="h-3.5 w-3.5" />
                Create Batch Repair Order ({selectedCluster.potholeCount} Potholes)
              </button>
            </div>
          ) : (
            <div className="neu-inset p-3.5 text-center font-mono text-[11px] text-[#718096]">
              No hotspot cluster selected. Adjust DBSCAN parameters or await additional geolocated
              detections.
            </div>
          )}
        </div>
      </div>

      {/* Frequently Affected Road Sections (Derived from Actual Geolocated Potholes) */}
      <div className="neu-card overflow-hidden">
        <div className="border-b neu-divider px-4 py-3">
          <span className="text-[14px] font-bold text-[#17243A]">
            Frequently Affected Road Sections (Actual Geolocated Potholes)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="h-10 border-b neu-divider bg-[#E3E8F1]/65 text-[#52627A]">
                <th className="label-caps px-3.5">Road Section / GPS Sector</th>
                <th className="label-caps px-3.5">District / Area</th>
                <th className="label-caps px-3.5 text-right">Verified Potholes</th>
                <th className="label-caps px-3.5 text-right">Critical P1</th>
                <th className="label-caps px-3.5 text-right">Centroid GPS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(163,177,198,0.28)] text-[12px]">
              {frequentRoadSections.map((sec) => (
                <tr
                  key={sec.section}
                  onClick={() =>
                    setFocusCoord({ lat: sec.centerLat, lng: sec.centerLng, zoom: 15 })
                  }
                  className="h-11 cursor-pointer hover:bg-[#F5F8FC]/80 transition-colors"
                >
                  <td className="px-3.5 font-semibold text-[#17243A]">{sec.section}</td>
                  <td className="px-3.5 text-[#52627A]">{displayOrNA(sec.district)}</td>
                  <td className="px-3.5 text-right font-mono font-bold text-[#17243A]">
                    {sec.count}
                  </td>
                  <td className="px-3.5 text-right font-mono font-bold text-[#DC2626]">
                    {sec.criticalCount}
                  </td>
                  <td className="px-3.5 text-right font-mono text-[11px] text-[#52627A]">
                    {sec.centerLat.toFixed(5)}, {sec.centerLng.toFixed(5)}
                  </td>
                </tr>
              ))}
              {frequentRoadSections.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#718096]">
                    No geolocated pothole records available for road section hotspot analysis.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ranked DBSCAN Hotspot Corridors Table */}
      <div className="neu-card overflow-hidden">
        <div className="border-b neu-divider px-4 py-3">
          <span className="text-[14px] font-bold text-[#17243A]">
            Ranked Hotspot Corridors (DBSCAN Output)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="h-10 border-b neu-divider bg-[#E3E8F1]/65 text-[#52627A]">
                <th className="label-caps px-3.5">Cluster ID</th>
                <th className="label-caps px-3.5">Road Corridor & District</th>
                <th className="label-caps px-3.5">Risk Tier</th>
                <th className="label-caps px-3.5 text-right">Potholes</th>
                <th className="label-caps px-3.5 text-right">Critical P1</th>
                <th className="label-caps px-3.5 text-right">Avg IRI</th>
                <th className="label-caps px-3.5 text-right">Radius</th>
                <th className="label-caps px-3.5 text-right">Priority</th>
                <th className="label-caps px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(163,177,198,0.28)] text-[12px]">
              {workspace.clusters.map((cluster) => (
                <tr
                  key={cluster.id}
                  onClick={() => {
                    setSelectedClusterId(cluster.id);
                    setFocusCoord({
                      lat: cluster.centroidLat,
                      lng: cluster.centroidLng,
                      zoom: 15,
                    });
                  }}
                  className={`h-12 cursor-pointer transition-colors ${
                    selectedCluster?.id === cluster.id
                      ? 'bg-[#356AE6]/10'
                      : 'hover:bg-[#F5F8FC]/80'
                  }`}
                >
                  <td className="px-3.5 font-mono font-bold text-[#17243A]">{cluster.id}</td>
                  <td className="px-3.5">
                    <div className="font-semibold text-[#17243A]">{cluster.name}</div>
                    <div className="text-[11px] text-[#718096]">{displayOrNA(cluster.district)}</div>
                  </td>
                  <td className="px-3.5">
                    <SeverityBadge severity={cluster.riskTier} showTier={false} />
                  </td>
                  <td className="px-3.5 text-right font-mono font-bold text-[#17243A]">
                    {cluster.potholeCount}
                  </td>
                  <td className="px-3.5 text-right font-mono font-bold text-[#DC2626]">
                    {cluster.criticalCount}
                  </td>
                  <td className="px-3.5 text-right font-mono">
                    {formatNumberOrNA(cluster.avgIri, 2)}
                  </td>
                  <td className="px-3.5 text-right font-mono">{cluster.radiusMeters} m</td>
                  <td className="px-3.5 text-right font-mono font-bold text-[#17243A]">
                    {cluster.priorityScore !== null ? cluster.priorityScore : 'N/A'}
                  </td>
                  <td
                    className="px-3.5 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onCreateClusterRepair(cluster)}
                      className="neu-btn inline-flex h-7 items-center gap-1 px-2.5 text-[11px] font-semibold text-[#17243A] hover:text-[#356AE6]"
                    >
                      Batch Dispatch
                    </button>
                  </td>
                </tr>
              ))}
              {workspace.clusters.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-[#718096]">
                    No DBSCAN clusters detected with current radius ({epsMeters}m) and minPts ({minPts}).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
