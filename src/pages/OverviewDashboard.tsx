import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import {
  ArrowRight,
  MapPin,
  ShieldAlert,
  Wrench,
  Activity,
} from 'lucide-react';
import { MetricTile } from '../components/common/MetricTile';
import {
  DataSourceTag,
  PotholeStatusBadge,
  SeverityBadge,
  VerificationBadge,
} from '../components/common/Badges';
import { RoadMapCanvas } from '../components/map/RoadMapCanvas';
import {
  displayOrNA,
  formatConfidence,
  formatIri,
  formatLatLngPair,
  formatNumberOrNA,
  formatPeakG,
  formatRelativeTime,
} from '../utilities/formatters';
import type {
  PotholeRecord,
  ScreenId,
  TerraWorkspaceState,
} from '../types';

interface OverviewDashboardProps {
  workspace: TerraWorkspaceState;
  onNavigate: (screen: ScreenId) => void;
  onInspectPotholeOnMap: (pothole: PotholeRecord) => void;
  onQuickCreateRepair: (pothole: PotholeRecord) => void;
}

const NEU_TOOLTIP_STYLE = {
  backgroundColor: '#EEF2F7',
  borderRadius: 12,
  border: '1px solid rgba(255, 255, 255, 0.78)',
  boxShadow: '5px 5px 12px rgba(163, 177, 198, 0.45), -4px -4px 10px rgba(255, 255, 255, 0.85)',
  fontSize: 12,
  color: '#17243A',
};

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  workspace,
  onNavigate,
  onInspectPotholeOnMap,
  onQuickCreateRepair,
}) => {
  const isLive = Boolean(workspace.isLiveFirestore && workspace.liveMetrics);
  const liveMetrics = workspace.liveMetrics;

  const activePotholes = useMemo(
    () => workspace.potholes.filter((p) => p.status !== 'Repaired'),
    [workspace.potholes]
  );

  const criticalCount = useMemo(
    () => activePotholes.filter((p) => p.severity === 'Critical').length,
    [activePotholes]
  );

  const avgIri = useMemo(() => {
    const validIris = activePotholes
      .map((p) => p.telemetry.iriScore)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (validIris.length === 0) return null;
    return validIris.reduce((sum, v) => sum + v, 0) / validIris.length;
  }, [activePotholes]);

  const onlineDevices = useMemo(
    () => workspace.devices.filter((d) => d.status === 'Online').length,
    [workspace.devices]
  );

  const totalPacketsToday = useMemo(() => {
    const values = workspace.devices
      .map((d) => d.packetsToday)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0);
  }, [workspace.devices]);

  const activeSosAlerts = useMemo(
    () => workspace.alerts.filter((a) => a.isManualSos && a.status === 'Active'),
    [workspace.alerts]
  );

  const topTriageQueue = useMemo(
    () =>
      [...activePotholes]
        .sort((a, b) => (b.priorityScore ?? -1) - (a.priorityScore ?? -1))
        .slice(0, 6),
    [activePotholes]
  );

  // Trend chart: in Live Firestore mode, aggregate strictly by actual detection dates (zero fabricated series)
  const trendData = useMemo(() => {
    if (isLive) {
      const byDay = new Map<string, { sortKey: string; day: string; detected: number; repaired: number }>();
      for (const p of workspace.potholes) {
        if (!p.detectedAt) continue;
        const dt = new Date(p.detectedAt);
        if (Number.isNaN(dt.getTime())) continue;
        const sortKey = dt.toISOString().slice(0, 10);
        const day = dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
        const bucket = byDay.get(sortKey) || { sortKey, day, detected: 0, repaired: 0 };
        bucket.detected += 1;
        if (p.status === 'Repaired') bucket.repaired += 1;
        byDay.set(sortKey, bucket);
      }
      return Array.from(byDay.values())
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .slice(-14)
        .map(({ day, detected, repaired }) => ({ day, detected, repaired }));
    }

    return [
      { day: 'Nov 07', detected: 9, repaired: 6 },
      { day: 'Nov 09', detected: 12, repaired: 8 },
      { day: 'Nov 11', detected: 15, repaired: 10 },
      { day: 'Nov 13', detected: 11, repaired: 12 },
      { day: 'Nov 15', detected: 18, repaired: 13 },
      { day: 'Nov 17', detected: 14, repaired: 15 },
      { day: 'Nov 19', detected: 16, repaired: 14 },
      {
        day: 'Today',
        detected: Math.max(8, activePotholes.filter((p) => p.status === 'Detected').length + 6),
        repaired: workspace.potholes.filter((p) => p.status === 'Repaired').length + 4,
      },
    ];
  }, [isLive, activePotholes, workspace.potholes]);

  // Pothole Severity Distribution — strictly pothole records only
  const potholeSeverityData = useMemo(() => {
    const critical = workspace.potholes.filter(
      (p) => p.severity === 'Critical' && p.status !== 'Repaired'
    ).length;
    const high = workspace.potholes.filter(
      (p) => p.severity === 'High' && p.status !== 'Repaired'
    ).length;
    const moderate = workspace.potholes.filter(
      (p) => p.severity === 'Moderate' && p.status !== 'Repaired'
    ).length;
    const repaired = workspace.potholes.filter((p) => p.status === 'Repaired').length;

    return [
      { name: 'Critical (P1)', count: critical, color: '#DC2626' },
      { name: 'High (P2)', count: high, color: '#EA580C' },
      { name: 'Moderate (P3)', count: moderate, color: '#D97706' },
      { name: 'Repaired', count: repaired, color: '#1E9E63' },
    ];
  }, [workspace.potholes]);

  const verifiedPotholesCount = useMemo(
    () => workspace.potholes.filter((p) => p.verified === true).length,
    [workspace.potholes]
  );

  const notVerifiedPotholesCount = useMemo(
    () => workspace.potholes.filter((p) => p.verified === false).length,
    [workspace.potholes]
  );

  return (
    <div className="space-y-5">
      {/* Active Independent Manual SOS Banner (Only rendered when active) */}
      {activeSosAlerts.length > 0 && (
        <div className="neu-sos-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#DC2626]/12 text-[#DC2626]">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-bold text-[#991B1B]">
                  Independent Physical SOS Triggered ({activeSosAlerts[0].id})
                </span>
                <DataSourceTag source={activeSosAlerts[0].dataSource} compact />
              </div>
              <p className="mt-0.5 text-[12px] text-[#7F1D1D]">
                {displayOrNA(activeSosAlerts[0].deviceId)} · {displayOrNA(activeSosAlerts[0].roadName)} · Operator:{' '}
                {displayOrNA(activeSosAlerts[0].operatorName)} ·{' '}
                {formatRelativeTime(activeSosAlerts[0].timestamp)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('alerts')}
            className="neu-btn-danger inline-flex h-9 shrink-0 items-center justify-center gap-1.5 px-3.5 text-[12px] font-semibold"
          >
            Open SOS Console
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Row 1: Strictly Pothole-Only Municipal KPIs */}
      {isLive && liveMetrics ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="Total Pothole Detections"
            value={liveMetrics.totalPotholeDetections}
            delta={`${liveMetrics.reliableGpsPotholesCount} mapped GPS`}
            deltaTone="telemetry"
            subtext={
              liveMetrics.unreliableGpsPotholesCount > 0
                ? `${liveMetrics.unreliableGpsPotholesCount} unreliable GPS · ${workspace.clusters.length} clusters`
                : `${workspace.clusters.length} DBSCAN hotspot clusters`
            }
            onClick={() => onNavigate('potholes')}
          />
          <MetricTile
            label="Total Verified Potholes"
            value={liveMetrics.totalVerifiedPotholes}
            delta={`${liveMetrics.notVerifiedPotholesCount} not verified`}
            deltaTone={liveMetrics.notVerifiedPotholesCount > 0 ? 'negative' : 'positive'}
            subtext={`C:${liveMetrics.criticalPotholesCount} · H:${liveMetrics.highPotholesCount} · M:${liveMetrics.moderatePotholesCount}`}
            onClick={() => onNavigate('potholes')}
          />
          <MetricTile
            label="Active ESP32 Devices"
            value={`${liveMetrics.activeDevices} / ${liveMetrics.totalDevices}`}
            delta="Online Fleet Nodes"
            deltaTone="positive"
            subtext={
              totalPacketsToday !== null
                ? `${totalPacketsToday.toLocaleString()} pkts today`
                : 'Packets today: N/A'
            }
            onClick={() => onNavigate('devices')}
          />
          <MetricTile
            label="Pothole & Device Alerts"
            value={liveMetrics.unresolvedAlerts}
            delta={`${liveMetrics.deviceHealthWarnings} sensor warnings`}
            deltaTone={
              liveMetrics.deviceHealthWarnings > 0 || liveMetrics.unresolvedAlerts > 0
                ? 'negative'
                : 'positive'
            }
            subtext="Active pothole hazards & GPS/MPU6050 alerts"
            onClick={() => onNavigate('alerts')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="Active Potholes (Validated ML)"
            value={activePotholes.length}
            delta={`${workspace.potholes.filter((p) => p.status === 'Repaired').length} repaired`}
            deltaTone="positive"
            subtext={`${workspace.clusters.length} DBSCAN clusters`}
            onClick={() => onNavigate('potholes')}
          />
          <MetricTile
            label="Critical P1 Hazards"
            value={criticalCount}
            delta="24h SLA Window"
            deltaTone="negative"
            subtext={`${workspace.repairs.filter((r) => r.priority === 'P1' && r.status !== 'Completed').length} active P1 orders`}
            onClick={() => onNavigate('repairs')}
          />
          <MetricTile
            label="Network Avg Roughness (IRI)"
            value={formatIri(avgIri)}
            delta="MPU6050 Z-Axis"
            deltaTone="neutral"
            subtext={`${workspace.h3Cells.length} H3 Res-${workspace.settings.h3DefaultResolution} cells`}
            onClick={() => onNavigate('hotspots')}
          />
          <MetricTile
            label="ESP32 Telemetry Fleet"
            value={`${onlineDevices} / ${workspace.devices.length}`}
            delta="Online & 3D GPS Fix"
            deltaTone="telemetry"
            subtext={
              totalPacketsToday !== null
                ? `${totalPacketsToday.toLocaleString()} pkts today`
                : 'Packets today: N/A'
            }
            onClick={() => onNavigate('devices')}
          />
        </div>
      )}

      {/* Row 2: 60/40 Cockpit Split — GIS Map Preview + Priority Triage Queue */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* GIS Overview Map */}
        <div className="xl:col-span-7 neu-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b neu-divider px-4 py-3.5">
            <div>
              <div className="text-[14px] font-bold text-[#17243A]">
                Municipal Road Hazard GIS Overview
              </div>
              <div className="font-mono text-[11px] text-[#718096] mt-0.5">
                {workspace.settings.coordinateReferenceLabel} · Click any marker to inspect
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('map')}
              className="neu-btn inline-flex h-8 items-center gap-1.5 px-3 text-[12px] font-semibold text-[#17243A] hover:text-[#356AE6] whitespace-nowrap shrink-0"
            >
              Full GIS Map
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-4">
            <RoadMapCanvas
              potholes={workspace.potholes}
              clusters={workspace.clusters}
              devices={workspace.devices}
              sosAlerts={workspace.alerts}
              layers={{
                potholes: true,
                heatmap: false,
                dbscanClusters: true,
                h3HexGrid: false,
                devices: true,
                sosAlerts: true,
              }}
              heightClass="h-[340px]"
              onSelectPothole={onInspectPotholeOnMap}
            />
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#52627A]">
              <div className="flex flex-wrap items-center gap-3.5">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#DC2626]" />
                  Critical P1
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#EA580C]" />
                  High P2
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#D97706]" />
                  Moderate P3
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#1E9E63]" />
                  Repaired
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#0F8B8D]" />
                  ESP32 Unit
                </span>
              </div>
              <DataSourceTag source={isLive ? 'LIVE_ESP32' : 'SIMULATED_DEMO'} compact />
            </div>
          </div>
        </div>

        {/* Priority Engine Triage Queue */}
        <div className="xl:col-span-5 neu-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b neu-divider px-4 py-3.5">
            <div>
              <div className="text-[14px] font-bold text-[#17243A]">
                Priority Triage Queue
              </div>
              <div className="font-mono text-[11px] text-[#718096] mt-0.5">
                Ranked by Municipal Priority Calculation Engine
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('potholes')}
              className="neu-btn inline-flex h-8 items-center gap-1 px-3 text-[12px] font-semibold text-[#17243A] hover:text-[#356AE6] whitespace-nowrap shrink-0"
            >
              All Records
            </button>
          </div>
          <div className="divide-y divide-[rgba(163,177,198,0.28)] flex-1 overflow-y-auto px-1">
            {topTriageQueue.length === 0 ? (
              <div className="flex h-full min-h-[220px] items-center justify-center p-6 text-center text-[12px] text-[#718096]">
                No active pothole records found in Cloud Firestore.
              </div>
            ) : (
              topTriageQueue.map((item) => {
                const hasGps =
                  item.hasReliableGps !== false && item.lat !== null && item.lng !== null;
                const locationText = item.roadName
                  ? item.roadName
                  : hasGps
                    ? formatLatLngPair(item.lat, item.lng)
                    : 'Location unavailable / unreliable GPS';
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-3 hover:bg-[#F5F8FC]/75 transition-colors rounded-xl"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-bold text-[#17243A]">
                          {item.eventId ?? item.id}
                        </span>
                        <SeverityBadge
                          severity={item.severity}
                          rawLabel={item.rawSeverity}
                          showTier={false}
                        />
                        <PotholeStatusBadge status={item.status} rawLabel={item.rawStatus} />
                        <VerificationBadge verified={item.verified} />
                      </div>
                      <div className="mt-1 truncate text-[12px] font-semibold text-[#17243A]">
                        {locationText}{' '}
                        <span className="font-normal text-[#718096]">
                          · {displayOrNA(item.district)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#52627A]">
                        <span>
                          Score{' '}
                          {item.priorityScore !== null ? `${item.priorityScore}/100` : 'N/A'}
                        </span>
                        <span>Conf {formatConfidence(item.telemetry.mlConfidence)}</span>
                        <span>Peak {formatPeakG(item.telemetry.peakAccelG)}</span>
                        <span>IRI {formatNumberOrNA(item.telemetry.iriScore, 1)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!hasGps}
                        onClick={() => onInspectPotholeOnMap(item)}
                        className="neu-btn flex h-8 w-8 items-center justify-center text-[#52627A] hover:text-[#356AE6] disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          hasGps
                            ? 'Locate on Live Road Map'
                            : 'No reliable GPS coordinates available'
                        }
                      >
                        <MapPin className="h-3.5 w-3.5" />
                      </button>
                      {!item.assignedWorkOrderId && (
                        <button
                          type="button"
                          onClick={() => onQuickCreateRepair(item)}
                          className="neu-btn-primary inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-semibold whitespace-nowrap"
                        >
                          <Wrench className="h-3 w-3" />
                          Dispatch
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Analytics Charts — Recessed Inset Chart Wells inside Elevated Cards */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7 neu-card p-4">
          <div className="mb-3.5 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-bold text-[#17243A]">
                Pothole Detections vs. Municipal Repairs ({isLive ? 'Firestore Timeline' : '14-Day Velocity'})
              </h2>
              <p className="text-[11px] text-[#718096] mt-0.5">
                Validated ESP32 Pothole events compared against verified asphalt patches
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="neu-btn px-3 py-1.5 text-[12px] font-semibold text-[#356AE6] whitespace-nowrap shrink-0"
            >
              Open Analytics
            </button>
          </div>
          <div className="neu-inset h-[232px] w-full p-3">
            {trendData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center font-mono text-[12px] text-[#718096]">
                No dated pothole records available in Firestore yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 177, 198, 0.42)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                  />
                  <Tooltip contentStyle={NEU_TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="detected"
                    name="Detected Potholes"
                    stroke="#DC2626"
                    fill="rgba(220, 38, 38, 0.16)"
                    strokeWidth={2.2}
                  />
                  <Area
                    type="monotone"
                    dataKey="repaired"
                    name="Completed Repairs"
                    stroke="#1E9E63"
                    fill="rgba(30, 158, 99, 0.18)"
                    strokeWidth={2.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 neu-card p-4 flex flex-col justify-between">
          <div>
            <div className="mb-3.5 flex items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-[#17243A]">
                  <Activity className="h-4 w-4 text-[#0F8B8D]" />
                  Pothole Severity Distribution
                </h2>
                <p className="text-[11px] text-[#718096] mt-0.5">
                  Active pothole breakdown by municipal repair severity and completed patches
                </p>
              </div>
            </div>
            <div className="neu-inset h-[186px] w-full p-3">
              {workspace.potholes.length === 0 ? (
                <div className="flex h-full items-center justify-center font-mono text-[12px] text-[#718096]">
                  No pothole records in Firestore yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={potholeSeverityData}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 16, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(163, 177, 198, 0.42)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: '#52627A', fontFamily: 'JetBrains Mono' }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={96}
                      tick={{ fontSize: 11, fill: '#17243A', fontFamily: 'Public Sans', fontWeight: 500 }}
                    />
                    <Tooltip contentStyle={NEU_TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Pothole Records" radius={[0, 6, 6, 0]}>
                      {potholeSeverityData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t neu-divider pt-2.5 text-[11px] text-[#52627A]">
            <span className="font-mono">
              <span className="font-bold text-[#15803D]">Verified: {verifiedPotholesCount}</span>
              {' · '}
              <span className="font-bold text-[#DC2626]">Not Verified: {notVerifiedPotholesCount}</span>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('potholes')}
              className="font-mono font-bold text-[#356AE6] hover:underline"
            >
              Manage {workspace.potholes.length} potholes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
