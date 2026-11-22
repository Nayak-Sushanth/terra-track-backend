import React, { useMemo, useState } from 'react';
import {
  Search,
  MapPin,
  Wrench,
  ArrowUpDown,
  Filter,
  CheckCircle2,
  Download,
  AlertTriangle,
} from 'lucide-react';
import {
  DataSourceTag,
  PotholeStatusBadge,
  SeverityBadge,
  VerificationBadge,
} from '../components/common/Badges';
import {
  displayOrNA,
  formatConfidence,
  formatLatLngPair,
  formatNumberOrNA,
  formatPeakG,
  formatShortTimestamp,
} from '../utilities/formatters';
import { downloadCsvFile } from '../utilities/exportUtils';
import type {
  PotholeRecord,
  PotholeStatus,
  SeverityLevel,
  TerraWorkspaceState,
} from '../types';

interface PotholeManagementProps {
  workspace: TerraWorkspaceState;
  onUpdatePothole: (
    id: string,
    patch: Partial<Pick<PotholeRecord, 'status' | 'severity' | 'notes' | 'verified'>>
  ) => Promise<void>;
  onLocateOnMap: (pothole: PotholeRecord) => void;
  onCreateRepair: (pothole: PotholeRecord) => void;
}

type SortKey = 'priorityScore' | 'mlConfidence' | 'detectedAt';
type VerificationFilter = 'All' | 'Verified' | 'Not Verified' | 'N/A';

export const PotholeManagement: React.FC<PotholeManagementProps> = ({
  workspace,
  onUpdatePothole,
  onLocateOnMap,
  onCreateRepair,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'All' | SeverityLevel>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | PotholeStatus>('All');
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>('All');
  const [districtFilter, setDistrictFilter] = useState<string>('All');
  const [sortKey, setSortKey] = useState<SortKey>('detectedAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    workspace.potholes[0]?.id || null
  );
  const [editNote, setEditNote] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

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

  const summaryCounts = useMemo(() => {
    const verified = workspace.potholes.filter((p) => p.verified === true).length;
    const notVerified = workspace.potholes.filter((p) => p.verified === false).length;
    const unreliableGps = workspace.potholes.filter(
      (p) => p.hasReliableGps === false || p.lat === null || p.lng === null
    ).length;
    return { verified, notVerified, unreliableGps };
  }, [workspace.potholes]);

  const filteredPotholes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return workspace.potholes
      .filter((p) => {
        if (severityFilter !== 'All' && p.severity !== severityFilter) return false;
        if (statusFilter !== 'All' && p.status !== statusFilter) return false;
        if (districtFilter !== 'All' && p.district !== districtFilter) return false;
        if (verificationFilter === 'Verified' && p.verified !== true) return false;
        if (verificationFilter === 'Not Verified' && p.verified !== false) return false;
        if (
          verificationFilter === 'N/A' &&
          p.verified !== null &&
          p.verified !== undefined
        ) {
          return false;
        }
        if (!q) return true;
        return (
          p.id.toLowerCase().includes(q) ||
          (p.eventId ?? '').toLowerCase().includes(q) ||
          (p.roadName ?? '').toLowerCase().includes(q) ||
          (p.district ?? '').toLowerCase().includes(q) ||
          (p.deviceId ?? '').toLowerCase().includes(q) ||
          (p.detectionSource ?? '').toLowerCase().includes(q) ||
          (p.segmentCode ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortKey === 'priorityScore') {
          diff = (a.priorityScore ?? -1) - (b.priorityScore ?? -1);
        } else if (sortKey === 'mlConfidence') {
          diff = (a.telemetry.mlConfidence ?? -1) - (b.telemetry.mlConfidence ?? -1);
        } else {
          const ta = a.detectedAt ? new Date(a.detectedAt).getTime() : 0;
          const tb = b.detectedAt ? new Date(b.detectedAt).getTime() : 0;
          diff = (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
        }
        return sortAsc ? diff : -diff;
      });
  }, [
    workspace.potholes,
    searchQuery,
    severityFilter,
    statusFilter,
    verificationFilter,
    districtFilter,
    sortKey,
    sortAsc,
  ]);

  const selectedPothole = useMemo(
    () =>
      workspace.potholes.find((p) => p.id === selectedId) ||
      filteredPotholes[0] ||
      null,
    [workspace.potholes, selectedId, filteredPotholes]
  );

  // Reset draft notes cleanly if the selected pothole changes or is deleted in Firestore
  React.useEffect(() => {
    setEditNote(selectedPothole?.notes ?? '');
    setNoteDirty(false);
  }, [selectedPothole?.id]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const handleSelectRow = (pothole: PotholeRecord) => {
    setSelectedId(pothole.id);
    setEditNote(pothole.notes ?? '');
    setNoteDirty(false);
  };

  const handleSaveNotes = async () => {
    if (!selectedPothole) return;
    setSavingNote(true);
    try {
      await onUpdatePothole(selectedPothole.id, { notes: editNote });
      setNoteDirty(false);
    } finally {
      setSavingNote(false);
    }
  };

  const handleExportCsv = () => {
    downloadCsvFile(
      'terra-track-potholes-export.csv',
      [
        'Pothole ID',
        'Event ID',
        'Location',
        'District',
        'Severity',
        'Verification Status',
        'Confidence',
        'Detection Date',
        'Repair Status',
        'GPS Reliable',
        'Lat',
        'Lng',
        'Detection Source',
        'ESP32 Device',
      ],
      filteredPotholes.map((p) => [
        p.id,
        displayOrNA(p.eventId),
        p.roadName ?? (p.hasReliableGps !== false ? formatLatLngPair(p.lat, p.lng) : 'Location unavailable / unreliable GPS'),
        displayOrNA(p.district),
        p.severity ?? p.rawSeverity ?? 'N/A',
        p.verified === true ? 'Verified' : p.verified === false ? 'Not Verified' : 'N/A',
        formatConfidence(p.telemetry.mlConfidence),
        formatShortTimestamp(p.detectedAt),
        p.status ?? p.rawStatus ?? 'N/A',
        p.hasReliableGps === true && p.lat !== null && p.lng !== null ? 'Yes' : 'No',
        p.hasReliableGps === true && p.lat !== null ? p.lat : 'N/A',
        p.hasReliableGps === true && p.lng !== null ? p.lng : 'N/A',
        displayOrNA(p.detectionSource),
        displayOrNA(p.deviceId),
      ])
    );
  };

  const formatRowLocation = (row: PotholeRecord): string => {
    if (row.roadName) return row.roadName;
    if (row.hasReliableGps !== false && row.lat !== null && row.lng !== null) {
      return formatLatLngPair(row.lat, row.lng);
    }
    return 'Location unavailable / unreliable GPS';
  };

  const canPlotOnMap = (row: PotholeRecord): boolean =>
    row.hasReliableGps !== false &&
    typeof row.lat === 'number' &&
    typeof row.lng === 'number' &&
    Number.isFinite(row.lat) &&
    Number.isFinite(row.lng) &&
    !(row.lat === 0 && row.lng === 0);

  return (
    <div className="space-y-5">
      {/* Pothole Registry Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="neu-surface-sm inline-flex items-center gap-2.5 px-3.5 py-2 text-[12px]">
            <span className="font-bold text-[#17243A]">
              Pothole Registry ({workspace.potholes.length})
            </span>
            <span className="text-[#CBD5E1]">|</span>
            <span className="font-mono text-[11px] font-bold text-[#15803D]">
              Verified: {summaryCounts.verified}
            </span>
            <span className="font-mono text-[11px] font-bold text-[#DC2626]">
              Not Verified: {summaryCounts.notVerified}
            </span>
            {summaryCounts.unreliableGps > 0 && (
              <span className="font-mono text-[11px] font-semibold text-[#C2410C]">
                Unreliable GPS: {summaryCounts.unreliableGps}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="neu-btn inline-flex h-9 items-center gap-1.5 px-3.5 text-[12px] font-semibold text-[#17243A]"
        >
          <Download className="h-3.5 w-3.5 text-[#356AE6]" />
          Export Filtered CSV
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="neu-card p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-4">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#718096]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Pothole ID, Event ID, road, source, or ESP32 node..."
              className="neu-input h-9 w-full pl-9 pr-3 text-[12px]"
            />
          </div>
          <div className="md:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | PotholeStatus)}
              className="neu-input h-9 w-full px-3 text-[12px]"
            >
              <option value="All">Status: All Repair States</option>
              <option value="Detected">Detected</option>
              <option value="Verified">Verified</option>
              <option value="Scheduled">Scheduled</option>
              <option value="In Progress">In Progress</option>
              <option value="Repaired">Repaired</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <select
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value as VerificationFilter)}
              className="neu-input h-9 w-full px-3 text-[12px]"
            >
              <option value="All">Verification: All</option>
              <option value="Verified">Verified</option>
              <option value="Not Verified">Not Verified</option>
              <option value="N/A">N/A</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <select
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="neu-input h-9 w-full px-3 text-[12px]"
            >
              <option value="All">District: All Municipal Wards</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label-caps flex items-center gap-1 text-[#718096]">
              <Filter className="h-3 w-3" />
              Severity:
            </span>
            {(['All', 'Critical', 'High', 'Moderate'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`h-7 px-3 text-[12px] font-semibold ${
                  severityFilter === sev
                    ? 'neu-btn-primary'
                    : 'neu-btn text-[#52627A] hover:text-[#17243A]'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
          <span className="font-mono text-[11px] font-medium text-[#718096]">
            {filteredPotholes.length} matching pothole records
          </span>
        </div>
      </div>

      {/* Enterprise GIS Data Grid + Side Triage Drawer */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8 neu-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="h-10 border-b neu-divider bg-[#E3E8F1]/65 text-[#52627A]">
                  <th className="label-caps px-3">Pothole / Event ID</th>
                  <th className="label-caps px-3">Location</th>
                  <th className="label-caps px-3">Severity</th>
                  <th className="label-caps px-3">Verification</th>
                  <th className="label-caps px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('mlConfidence')}
                      className="inline-flex items-center gap-1 hover:text-[#356AE6]"
                    >
                      Confidence <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="label-caps px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('detectedAt')}
                      className="inline-flex items-center gap-1 hover:text-[#356AE6]"
                    >
                      Detected <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="label-caps px-3">Repair Status</th>
                  <th className="label-caps px-3 text-right">Map</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(163,177,198,0.28)] text-[12px]">
                {filteredPotholes.map((row) => {
                  const isSelected = selectedPothole?.id === row.id;
                  const mappable = canPlotOnMap(row);
                  const unreliableGps = row.hasReliableGps === false || row.lat === null || row.lng === null;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => handleSelectRow(row)}
                      className={`h-12 cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#356AE6]/10' : 'hover:bg-[#F5F8FC]/80'
                      }`}
                    >
                      <td className="px-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-[#17243A]">{row.id}</div>
                        <div className="font-mono text-[10px] text-[#718096]">
                          Evt: {displayOrNA(row.eventId)}
                        </div>
                      </td>
                      <td className="px-3 max-w-[210px]">
                        <div
                          className={`truncate font-semibold ${
                            unreliableGps && !row.roadName ? 'text-[#C2410C]' : 'text-[#17243A]'
                          }`}
                        >
                          {formatRowLocation(row)}
                        </div>
                        <div className="truncate text-[11px] text-[#718096]">
                          {unreliableGps ? (
                            <span className="text-[#C2410C] font-medium">
                              GPS unavailable / unreliable · {displayOrNA(row.deviceId)}
                            </span>
                          ) : (
                            <>
                              {displayOrNA(row.district)} · {displayOrNA(row.deviceId)}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        <SeverityBadge
                          severity={row.status === 'Repaired' ? 'Repaired' : row.severity}
                          rawLabel={row.rawSeverity}
                          showTier={false}
                        />
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        <VerificationBadge verified={row.verified} />
                      </td>
                      <td className="px-3 text-right font-mono font-semibold text-[#17243A] whitespace-nowrap">
                        {formatConfidence(row.telemetry.mlConfidence)}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-[#52627A] whitespace-nowrap">
                        {formatShortTimestamp(row.detectedAt)}
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        <PotholeStatusBadge status={row.status} rawLabel={row.rawStatus} />
                      </td>
                      <td
                        className="px-3 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={!mappable}
                          onClick={() => onLocateOnMap(row)}
                          className="neu-btn inline-flex h-8 w-8 items-center justify-center text-[#52627A] hover:text-[#356AE6] disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            mappable
                              ? 'Open on Live Road Map'
                              : 'Location unavailable or unreliable GPS — excluded from map plotting'
                          }
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredPotholes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-[#718096]">
                      No pothole records match the active search or filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Record Triage Panel */}
        <div className="xl:col-span-4 neu-card p-4 space-y-4">
          {selectedPothole ? (
            <>
              <div className="flex items-start justify-between gap-2 border-b neu-divider pb-3">
                <div>
                  <div className="font-mono text-[14px] font-bold text-[#17243A]">
                    {selectedPothole.id}
                  </div>
                  <div className="font-mono text-[11px] text-[#356AE6] mt-0.5">
                    Event ID: {displayOrNA(selectedPothole.eventId)}
                  </div>
                  <div className="text-[12px] font-semibold text-[#52627A] mt-0.5">
                    {formatRowLocation(selectedPothole)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <VerificationBadge verified={selectedPothole.verified} />
                  <DataSourceTag source={selectedPothole.dataSource} compact />
                </div>
              </div>

              {(selectedPothole.hasReliableGps === false ||
                selectedPothole.lat === null ||
                selectedPothole.lng === null) && (
                <div className="flex items-start gap-2 rounded-xl border border-[#FDBA74] bg-[#FEF3E6] px-3 py-2 text-[11px] text-[#9A3412]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C2410C]" />
                  <div>
                    <span className="font-bold">Location unavailable / unreliable GPS.</span>{' '}
                    Detection telemetry is preserved below, but this record is excluded from
                    confirmed pothole map pins.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-caps block text-[#718096]">Repair Status</label>
                  <select
                    value={selectedPothole.status ?? ''}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      onUpdatePothole(selectedPothole.id, {
                        status: e.target.value as PotholeStatus,
                      });
                    }}
                    className="neu-input mt-1.5 h-9 w-full px-2.5 text-[12px]"
                  >
                    {!selectedPothole.status && <option value="">N/A</option>}
                    <option value="Detected">Detected</option>
                    <option value="Verified">Verified</option>
                    <option value="Scheduled">Scheduled</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Repaired">Repaired</option>
                  </select>
                </div>
                <div>
                  <label className="label-caps block text-[#718096]">Severity Rating</label>
                  <select
                    value={selectedPothole.severity ?? ''}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      onUpdatePothole(selectedPothole.id, {
                        severity: e.target.value as SeverityLevel,
                      });
                    }}
                    className="neu-input mt-1.5 h-9 w-full px-2.5 text-[12px]"
                  >
                    {!selectedPothole.severity && <option value="">N/A</option>}
                    <option value="Critical">Critical (P1)</option>
                    <option value="High">High (P2)</option>
                    <option value="Moderate">Moderate (P3)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/75 bg-[#E4E9F2]/65 px-3 py-2">
                <div className="text-[11px]">
                  <span className="label-caps text-[#718096]">Verification Status:</span>{' '}
                  <span
                    className={`font-mono font-bold ${
                      selectedPothole.verified === true
                        ? 'text-[#15803D]'
                        : selectedPothole.verified === false
                          ? 'text-[#DC2626]'
                          : 'text-[#52627A]'
                    }`}
                  >
                    {selectedPothole.verified === true
                      ? 'Verified'
                      : selectedPothole.verified === false
                        ? 'Not Verified'
                        : 'N/A'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUpdatePothole(selectedPothole.id, {
                      verified: selectedPothole.verified !== true,
                    })
                  }
                  className="neu-btn h-7 px-2.5 font-mono text-[10.5px] font-semibold text-[#17243A] hover:text-[#356AE6] cursor-pointer"
                >
                  {selectedPothole.verified === true ? 'Mark Not Verified' : 'Mark Verified'}
                </button>
              </div>

              <div className="neu-inset p-3.5 space-y-2 font-mono text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-[#718096]">Confidence</span>
                  <span className="font-bold text-[#DC2626]">
                    {formatConfidence(selectedPothole.telemetry.mlConfidence)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#718096]">Detection Source</span>
                  <span className="text-[#17243A] font-medium">
                    {displayOrNA(selectedPothole.detectionSource)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#718096]">ESP32 Device</span>
                  <span className="text-[#0F8B8D] font-semibold">
                    {displayOrNA(selectedPothole.deviceId)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#718096]">GPS Position</span>
                  <span
                    className={`font-medium ${
                      selectedPothole.hasReliableGps === false
                        ? 'text-[#C2410C]'
                        : 'text-[#17243A]'
                    }`}
                  >
                    {selectedPothole.hasReliableGps === false
                      ? 'Unavailable / Unreliable'
                      : formatLatLngPair(selectedPothole.lat, selectedPothole.lng)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#718096]">MPU6050 Z-Peak / RMS</span>
                  <span className="text-[#17243A] font-medium">
                    {formatPeakG(selectedPothole.telemetry.peakAccelG)} /{' '}
                    {selectedPothole.telemetry.rmsVibration !== null
                      ? `${formatNumberOrNA(selectedPothole.telemetry.rmsVibration, 2)} m/s²`
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#718096]">Detection Date</span>
                  <span className="text-[#17243A] font-medium">
                    {formatShortTimestamp(selectedPothole.detectedAt)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#718096]">Work Order</span>
                  <span className="font-bold text-[#356AE6]">
                    {selectedPothole.assignedWorkOrderId || 'Unassigned'}
                  </span>
                </div>
              </div>

              <div>
                <label className="label-caps block text-[#718096]">
                  Municipal Engineer Notes
                </label>
                <textarea
                  rows={3}
                  value={noteDirty ? editNote : selectedPothole.notes ?? ''}
                  onChange={(e) => {
                    setEditNote(e.target.value);
                    setNoteDirty(true);
                  }}
                  placeholder="Add municipal inspection or repair notes..."
                  className="neu-input mt-1.5 w-full p-2.5 text-[12px]"
                />
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  disabled={savingNote}
                  className="neu-btn mt-2 inline-flex h-8 items-center gap-1.5 px-3 text-[11px] font-semibold text-[#17243A]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#1E9E63]" />
                  {savingNote ? 'Saving...' : 'Save Notes'}
                </button>
              </div>

              <div className="flex items-center gap-2.5 border-t neu-divider pt-3.5">
                <button
                  type="button"
                  disabled={!canPlotOnMap(selectedPothole)}
                  onClick={() => onLocateOnMap(selectedPothole)}
                  className="neu-btn inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-[12px] font-semibold text-[#17243A] disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <MapPin className="h-3.5 w-3.5 text-[#356AE6]" />
                  View on Map
                </button>
                {selectedPothole.status !== 'Repaired' && (
                  <button
                    type="button"
                    onClick={() => onCreateRepair(selectedPothole)}
                    className="neu-btn-primary inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-[12px] font-semibold"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Create Work Order
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-[12px] text-[#718096]">
              Select a pothole row to inspect sensor telemetry and edit triage state.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
