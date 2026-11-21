import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ComposedChart,
  Line,
  Legend,
} from 'recharts';
import { Download, FileJson, FileSpreadsheet, FileText } from 'lucide-react';
import { MetricTile } from '../components/common/MetricTile';
import { Modal } from '../components/common/Modal';
import { downloadCsvFile, downloadJsonFile } from '../utilities/exportUtils';
import {
  displayOrNA,
  formatCurrency,
  formatIri,
  formatNumberOrNA,
  formatVoltage,
} from '../utilities/formatters';
import type { TerraWorkspaceState } from '../types';

interface AnalyticsReportsProps {
  workspace: TerraWorkspaceState;
}

const NEU_TOOLTIP_STYLE = {
  backgroundColor: '#EEF2F7',
  borderRadius: 12,
  border: '1px solid rgba(255, 255, 255, 0.78)',
  boxShadow:
    '5px 5px 12px rgba(163, 177, 198, 0.45), -4px -4px 10px rgba(255, 255, 255, 0.85)',
  fontSize: 12,
  color: '#17243A',
};

export const AnalyticsReports: React.FC<AnalyticsReportsProps> = ({ workspace }) => {
  const [timeframe, setTimeframe] = useState<'7D' | '30D' | '90D' | 'YTD'>('30D');
  const [districtFilter, setDistrictFilter] = useState<string>('All');
  const [briefOpen, setBriefOpen] = useState(false);

  const isLive = Boolean(workspace.isLiveFirestore);

  const districts = useMemo(
    () =>
      Array.from(
        new Set(
          workspace.potholes
            .map((p) => p.district)
            .filter((d): d is string => Boolean(d && d.trim()))
        )
      ).sort(),
    [workspace.potholes]
  );

  const scopedPotholes = useMemo(
    () =>
      workspace.potholes.filter((p) =>
        districtFilter === 'All' ? true : p.district === districtFilter
      ),
    [workspace.potholes, districtFilter]
  );

  const timeframeMultiplier = isLive
    ? 1
    : { '7D': 1, '30D': 3.4, '90D': 8.2, YTD: 14.5 }[timeframe];

  const districtStats = useMemo(() => {
    const map = new Map<
      string,
      { district: string; active: number; repaired: number; iriSum: number; iriCount: number }
    >();
    for (const p of workspace.potholes) {
      const distName = p.district ?? 'Unassigned Area';
      const existing = map.get(distName) || {
        district: distName,
        active: 0,
        repaired: 0,
        iriSum: 0,
        iriCount: 0,
      };
      if (p.status === 'Repaired') existing.repaired += 1;
      else existing.active += 1;
      if (typeof p.telemetry.iriScore === 'number' && Number.isFinite(p.telemetry.iriScore)) {
        existing.iriSum += p.telemetry.iriScore;
        existing.iriCount += 1;
      }
      map.set(distName, existing);
    }
    return Array.from(map.values()).map((row) => ({
      district: row.district.replace(' District', '').replace(' Ward', ''),
      fullDistrict: row.district,
      active: row.active,
      repaired: row.repaired,
      avgIri: row.iriCount > 0 ? Number((row.iriSum / row.iriCount).toFixed(2)) : 0,
    }));
  }, [workspace.potholes]);

  const velocitySeries = useMemo(() => {
    if (isLive) {
      const byDay = new Map<string, { sortKey: string; period: string; detected: number; repaired: number; avgCost: number }>();
      for (const p of scopedPotholes) {
        if (!p.detectedAt) continue;
        const dt = new Date(p.detectedAt);
        if (Number.isNaN(dt.getTime())) continue;
        const sortKey = dt.toISOString().slice(0, 10);
        const period = dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
        const bucket = byDay.get(sortKey) || { sortKey, period, detected: 0, repaired: 0, avgCost: 0 };
        bucket.detected += 1;
        if (p.status === 'Repaired') bucket.repaired += 1;
        byDay.set(sortKey, bucket);
      }
      return Array.from(byDay.values())
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .slice(-14)
        .map(({ period, detected, repaired, avgCost }) => ({ period, detected, repaired, avgCost }));
    }

    const scale = timeframe === '7D' ? 1 : timeframe === '30D' ? 2 : timeframe === '90D' ? 4 : 6;
    return [
      { period: 'P1', detected: 12 * scale, repaired: 9 * scale, avgCost: 2450 },
      { period: 'P2', detected: 16 * scale, repaired: 13 * scale, avgCost: 2290 },
      { period: 'P3', detected: 14 * scale, repaired: 15 * scale, avgCost: 2180 },
      { period: 'P4', detected: 19 * scale, repaired: 16 * scale, avgCost: 2310 },
      { period: 'P5', detected: 15 * scale, repaired: 17 * scale, avgCost: 2120 },
      { period: 'Current', detected: Math.round(scopedPotholes.length * (scale * 0.6)), repaired: Math.round((scopedPotholes.filter((p) => p.status === 'Repaired').length + 4) * scale), avgCost: 2040 },
    ];
  }, [isLive, timeframe, scopedPotholes]);

  const avgNetworkIri = useMemo(() => {
    const valid = scopedPotholes
      .map((p) => p.telemetry.iriScore)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return null;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
  }, [scopedPotholes]);

  const totalRepairSpend = useMemo(() => {
    const validCosts = workspace.repairs
      .map((r) => r.estimatedCostUsd)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (validCosts.length === 0) return null;
    const rawSum = validCosts.reduce((s, v) => s + v, 0);
    if (isLive) return Math.round(rawSum);
    return Math.round(rawSum * (timeframe === '7D' ? 1 : timeframe === '30D' ? 1.8 : 3.2));
  }, [workspace.repairs, timeframe, isLive]);

  const exportPotholeInventoryCsv = () => {
    downloadCsvFile(
      `terra-track-pothole-inventory-${timeframe.toLowerCase()}.csv`,
      [
        'Pothole ID',
        'Event ID',
        'Road Name',
        'District',
        'Arterial Class',
        'Severity',
        'Verification Status',
        'Status',
        'GPS Reliable',
        'Priority Score',
        'Peak G',
        'IRI',
        'H3 Index',
        'DBSCAN Cluster',
        'Detection Source',
      ],
      scopedPotholes.map((p) => [
        p.id,
        displayOrNA(p.eventId),
        displayOrNA(p.roadName),
        displayOrNA(p.district),
        displayOrNA(p.arterialClass),
        p.severity ?? p.rawSeverity ?? 'N/A',
        p.verified === true ? 'Verified' : p.verified === false ? 'Not Verified' : 'N/A',
        p.status ?? p.rawStatus ?? 'N/A',
        p.hasReliableGps === true && p.lat !== null && p.lng !== null ? 'Yes' : 'No',
        p.priorityScore !== null ? p.priorityScore : 'N/A',
        formatNumberOrNA(p.telemetry.peakAccelG, 2),
        formatNumberOrNA(p.telemetry.iriScore, 1),
        displayOrNA(p.h3Index),
        p.clusterId || 'None',
        displayOrNA(p.detectionSource),
      ])
    );
  };

  const exportHotspotBriefJson = () => {
    downloadJsonFile(`terra-track-hotspot-report-${timeframe.toLowerCase()}.json`, {
      generatedAt: new Date().toISOString(),
      municipality: workspace.settings.municipalityName,
      mode: workspace.settings.demoModeEnabled ? 'DEMO_MODE_SIMULATED' : 'LIVE_FIRESTORE',
      timeframe,
      districtFilter,
      dbscanParameters: {
        epsMeters: workspace.settings.dbscanDefaultEpsMeters,
        minPts: workspace.settings.dbscanDefaultMinPts,
      },
      h3Resolution: workspace.settings.h3DefaultResolution,
      clusters: workspace.clusters,
      h3Cells: workspace.h3Cells,
    });
  };

  const exportRepairSlaCsv = () => {
    downloadCsvFile(
      `terra-track-repair-sla-${timeframe.toLowerCase()}.csv`,
      [
        'Work Order ID',
        'Title',
        'District',
        'Priority',
        'Status',
        'Linked Potholes',
        'Est. Asphalt (Tons)',
        'Est. Cost (USD)',
        'SLA Deadline',
      ],
      workspace.repairs.map((r) => [
        r.id,
        r.title,
        r.district,
        r.priority,
        r.status,
        r.potholeIds.length,
        r.estimatedAsphaltTons,
        r.estimatedCostUsd,
        r.slaDeadline || 'N/A',
      ])
    );
  };

  const exportFleetAuditCsv = () => {
    downloadCsvFile(
      `terra-track-esp32-fleet-audit.csv`,
      [
        'Device ID',
        'Vehicle',
        'Status',
        'GPS Status',
        'MPU6050 Status',
        'Battery Voltage',
        'Firmware',
        'Satellites',
        'Last Communication',
      ],
      workspace.devices.map((d) => [
        d.id,
        displayOrNA(d.vehicleLabel),
        d.rawStatus ?? d.status ?? 'N/A',
        d.rawGpsStatus ?? d.gpsFix ?? 'N/A',
        d.rawMpu6050Status ?? d.mpu6050Status ?? 'N/A',
        formatVoltage(d.batteryVoltage),
        displayOrNA(d.firmwareVersion),
        d.satellites !== null ? d.satellites : 'N/A',
        displayOrNA(d.lastHeartbeat),
      ])
    );
  };

  return (
    <div className="space-y-5">
      {/* Filter & Timeframe Bar */}
      <div className="neu-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="label-caps text-[#718096]">Reporting Window:</span>
          <div className="neu-tab-track inline-flex gap-1">
            {(['7D', '30D', '90D', 'YTD'] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`h-6.5 px-2.5 font-mono text-[11px] font-semibold cursor-pointer ${
                  timeframe === tf ? 'neu-tab-active' : 'neu-tab-inactive'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <select
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
            className="neu-input h-8 px-2.5 text-[12px]"
          >
            <option value="All">All Municipal Districts</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setBriefOpen(true)}
          className="neu-btn-primary inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold cursor-pointer"
        >
          <FileText className="h-3.5 w-3.5" />
          Executive Brief Preview
        </button>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={isLive ? 'Verified Potholes (Firestore)' : `Verified Potholes (${timeframe})`}
          value={Math.round(
            scopedPotholes.filter((p) => p.verified === true).length * timeframeMultiplier
          )}
          delta={`${scopedPotholes.length} total pothole records`}
          deltaTone="positive"
        />
        <MetricTile
          label="Mean Time to Repair (P1)"
          value={isLive ? 'N/A' : '17.4 hrs'}
          delta={isLive ? 'Awaiting completed repairs' : 'Under 24h SLA target'}
          deltaTone={isLive ? 'neutral' : 'positive'}
        />
        <MetricTile
          label="Scoped Avg Roughness (IRI)"
          value={formatIri(avgNetworkIri)}
          delta={
            avgNetworkIri === null
              ? 'IRI telemetry unavailable'
              : avgNetworkIri > 6
                ? 'Resurfacing Recommended'
                : 'Acceptable Range'
          }
          deltaTone={
            avgNetworkIri === null
              ? 'neutral'
              : avgNetworkIri > 6
                ? 'negative'
                : 'positive'
          }
        />
        <MetricTile
          label={`Est. Maintenance Spend (${timeframe})`}
          value={formatCurrency(totalRepairSpend)}
          delta="Hot-Mix & Milling"
          deltaTone="telemetry"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7 neu-card p-4">
          <h2 className="text-[13px] font-semibold text-[#17243A]">
            Pothole Detection vs. Repair Throughput ({isLive ? 'Actual Firestore Dates' : timeframe})
          </h2>
          <p className="text-[11px] text-[#718096]">
            Tracks municipal backlog closure velocity across verified pothole detections
          </p>
          <div className="neu-inset mt-3 h-[265px] w-full p-2.5">
            {velocitySeries.length === 0 ? (
              <div className="flex h-full items-center justify-center font-mono text-[12px] text-[#718096]">
                No dated pothole detections available in Firestore.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={velocitySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 177, 198, 0.35)" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                  />
                  <YAxis
                    yAxisId="left"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                  />
                  {!isLive && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                    />
                  )}
                  <Tooltip contentStyle={NEU_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    yAxisId="left"
                    dataKey="detected"
                    name="Detected Potholes"
                    fill="#DC2626"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="repaired"
                    name="Repaired Potholes"
                    fill="#1E9E63"
                    radius={[4, 4, 0, 0]}
                  />
                  {!isLive && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="avgCost"
                      name="Avg Cost ($)"
                      stroke="#356AE6"
                      strokeWidth={2.2}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 neu-card p-4">
          <h2 className="text-[13px] font-semibold text-[#17243A]">
            District Roughness Index (IRI) & Active Hazards
          </h2>
          <p className="text-[11px] text-[#718096]">
            Higher IRI (m/km) indicates accelerated surface fatigue across ward corridors
          </p>
          <div className="neu-inset mt-3 h-[265px] w-full p-2.5">
            {districtStats.length === 0 ? (
              <div className="flex h-full items-center justify-center font-mono text-[12px] text-[#718096]">
                No district pothole data available in Firestore.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={districtStats}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 177, 198, 0.35)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="district"
                    width={100}
                    tick={{ fontSize: 11, fill: '#17243A' }}
                  />
                  <Tooltip contentStyle={NEU_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="avgIri" name="Avg IRI (m/km)" fill="#EA580C" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="active" name="Active Potholes" fill="#356AE6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Municipal Report Generation Center */}
      <div className="neu-card overflow-hidden">
        <div className="border-b neu-divider bg-[#E3E8F1]/45 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-[#17243A]">
            Municipal Report Export Center
          </h2>
          <p className="text-[11px] text-[#718096]">
            Generate structured datasets for public works council briefings, GIS pipelines, and
            contractor audits ({isLive ? 'Live Cloud Firestore' : 'Demo Mode'}).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3.5 p-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="neu-inset flex flex-col justify-between p-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#17243A]">
                <FileSpreadsheet className="h-4 w-4 text-[#1E9E63]" />
                Pothole Inventory CSV
              </div>
              <p className="mt-1.5 text-[11px] text-[#52627A]">
                All validated pothole records with MPU6050 G-force, IRI, H3 index, and priority
                scores.
              </p>
            </div>
            <button
              type="button"
              onClick={exportPotholeInventoryCsv}
              className="neu-btn mt-3.5 inline-flex h-8.5 w-full items-center justify-center gap-1.5 text-[12px] font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#356AE6]" /> Download CSV
            </button>
          </div>

          <div className="neu-inset flex flex-col justify-between p-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#17243A]">
                <FileJson className="h-4 w-4 text-[#356AE6]" />
                Hotspot Spatial Brief JSON
              </div>
              <p className="mt-1.5 text-[11px] text-[#52627A]">
                DBSCAN cluster footprints, centroids, and H3 hexagonal bins ready for QGIS /
                GeoJSON pipelines.
              </p>
            </div>
            <button
              type="button"
              onClick={exportHotspotBriefJson}
              className="neu-btn mt-3.5 inline-flex h-8.5 w-full items-center justify-center gap-1.5 text-[12px] font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#356AE6]" /> Download JSON
            </button>
          </div>

          <div className="neu-inset flex flex-col justify-between p-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#17243A]">
                <FileSpreadsheet className="h-4 w-4 text-[#EA580C]" />
                Repair SLA & Budget CSV
              </div>
              <p className="mt-1.5 text-[11px] text-[#52627A]">
                Work order dispatch logs, asphalt tonnage estimates, crew assignments, and SLA
                compliance.
              </p>
            </div>
            <button
              type="button"
              onClick={exportRepairSlaCsv}
              className="neu-btn mt-3.5 inline-flex h-8.5 w-full items-center justify-center gap-1.5 text-[12px] font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#356AE6]" /> Download CSV
            </button>
          </div>

          <div className="neu-inset flex flex-col justify-between p-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#17243A]">
                <FileSpreadsheet className="h-4 w-4 text-[#0F8B8D]" />
                ESP32 Fleet Audit CSV
              </div>
              <p className="mt-1.5 text-[11px] text-[#52627A]">
                Firmware inventory, MPU6050 calibration status, GNSS lock performance, and packet
                volume.
              </p>
            </div>
            <button
              type="button"
              onClick={exportFleetAuditCsv}
              className="neu-btn mt-3.5 inline-flex h-8.5 w-full items-center justify-center gap-1.5 text-[12px] font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#356AE6]" /> Download CSV
            </button>
          </div>
        </div>
      </div>

      {/* Executive Brief Preview Modal */}
      <Modal
        open={briefOpen}
        onClose={() => setBriefOpen(false)}
        title="Municipal Infrastructure Executive Brief"
        subtitle={`${workspace.settings.municipalityName} · Reporting Window: ${timeframe}`}
        maxWidthClass="max-w-2xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setBriefOpen(false)}
              className="neu-btn h-8 px-3.5 text-[12px] font-medium cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={exportHotspotBriefJson}
              className="neu-btn-primary inline-flex h-8 items-center gap-1.5 px-3.5 text-[12px] font-semibold cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Export Brief JSON
            </button>
          </>
        }
      >
        <div className="space-y-3.5 text-[12px] text-[#334155]">
          <div className="neu-inset p-3.5 font-mono text-[11px] space-y-1 text-[#17243A]">
            <div>DATA MODE: {workspace.settings.demoModeEnabled ? 'DEMO MODE (SIMULATED TELEMETRY)' : 'LIVE'}</div>
            <div>TOTAL POTHOLE DETECTIONS: {workspace.potholes.length}</div>
            <div>
              VERIFICATION BREAKDOWN: {workspace.potholes.filter((p) => p.verified === true).length} Verified ·{' '}
              {workspace.potholes.filter((p) => p.verified === false).length} Not Verified ·{' '}
              {workspace.potholes.filter((p) => p.verified === null || p.verified === undefined).length} N/A
            </div>
            <div>
              RELIABLE GPS POTHOLES: {workspace.potholes.filter((p) => p.hasReliableGps === true && p.lat !== null && p.lng !== null).length} / {workspace.potholes.length}
            </div>
            <div>ACTIVE DBSCAN HOTSPOT CORRIDORS: {workspace.clusters.length}</div>
            <div>INDEPENDENT MANUAL SOS EVENTS LOGGED: {workspace.alerts.filter((a) => a.isManualSos).length}</div>
          </div>
          <div>
            <h3 className="font-semibold text-[#17243A]">Top Priority Corridors Requiring Action</h3>
            <ul className="mt-1.5 list-disc pl-5 space-y-1 text-[#52627A]">
              {workspace.clusters.length === 0 ? (
                <li>No geolocated pothole hotspot corridors currently active.</li>
              ) : (
                workspace.clusters.slice(0, 4).map((c) => (
                  <li key={c.id}>
                    <span className="font-mono font-semibold text-[#17243A]">{c.id}</span> ({displayOrNA(c.name)}, {displayOrNA(c.district)}) —{' '}
                    {c.potholeCount} active potholes, Avg IRI {formatIri(c.avgIri)}, Priority Score{' '}
                    <strong className="text-[#17243A]">
                      {c.priorityScore !== null ? `${c.priorityScore}/100` : 'N/A'}
                    </strong>.
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
};
