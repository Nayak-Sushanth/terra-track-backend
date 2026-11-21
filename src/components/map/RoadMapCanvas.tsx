import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import type {
  AlertRecord,
  DbscanCluster,
  Esp32Device,
  H3HexCell,
  PotholeRecord,
} from '../../types';
import { formatNumberOrNA, formatShortTimestamp } from '../../utilities/formatters';

export type BaseMapStyle = 'osm' | 'light' | 'dark';

export interface MapLayerVisibility {
  potholes: boolean;
  heatmap: boolean;
  dbscanClusters: boolean;
  h3HexGrid: boolean;
  devices: boolean;
  sosAlerts: boolean;
}

interface RoadMapCanvasProps {
  potholes: PotholeRecord[];
  clusters?: DbscanCluster[];
  h3Cells?: H3HexCell[];
  devices?: Esp32Device[];
  sosAlerts?: AlertRecord[];
  selectedPotholeId?: string | null;
  selectedClusterId?: string | null;
  focusCoord?: { lat: number; lng: number; zoom?: number } | null;
  layers: MapLayerVisibility;
  baseStyle?: BaseMapStyle;
  heightClass?: string;
  onSelectPothole?: (pothole: PotholeRecord) => void;
  onSelectCluster?: (cluster: DbscanCluster) => void;
  onSelectH3Cell?: (cell: H3HexCell) => void;
  onSelectDevice?: (device: Esp32Device) => void;
}

const TILE_LAYERS: Record<BaseMapStyle, { url: string; attribution: string }> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
};

// Default map configuration: Bengaluru, Karnataka, India (unrestricted navigation across India)
export const DEFAULT_MAP_CENTER: [number, number] = [12.9716, 77.5946];
export const DEFAULT_MAP_ZOOM = 12;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hasValidMapCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
  dataSource?: string,
  hasReliableGps?: boolean
): boolean {
  if (hasReliableGps === false) return false;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return false;
  }
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !isLegacyUsDemoCoordinate(lat, lng, dataSource);
}

/**
 * Excludes legacy San Francisco / continental US demo sample coordinates from the map
 * while keeping all layers ready for real coordinates from Firebase / backend.
 */
export function isLegacyUsDemoCoordinate(
  lat: number | null | undefined,
  lng: number | null | undefined,
  dataSource?: string
): boolean {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    Number.isNaN(lat) ||
    Number.isNaN(lng)
  ) {
    return true;
  }
  const inContinentalUs = lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66;
  if (!inContinentalUs) return false;
  return dataSource !== 'LIVE_ESP32';
}

function getPotholeMarkerColor(pothole: PotholeRecord): string {
  if (pothole.status === 'Repaired') return '#16A34A';
  if (pothole.severity === 'Critical') return '#DC2626';
  if (pothole.severity === 'High') return '#EA580C';
  return '#EAB308';
}

export const RoadMapCanvas: React.FC<RoadMapCanvasProps> = ({
  potholes,
  clusters = [],
  h3Cells = [],
  devices = [],
  sosAlerts = [],
  selectedPotholeId = null,
  selectedClusterId = null,
  focusCoord = null,
  layers,
  baseStyle = 'osm',
  heightClass = 'h-[520px]',
  onSelectPothole,
  onSelectCluster,
  onSelectH3Cell,
  onSelectDevice,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const layerGroupsRef = useRef<{
    heatmap: L.LayerGroup;
    h3: L.LayerGroup;
    dbscan: L.LayerGroup;
    potholes: L.LayerGroup;
    devices: L.LayerGroup;
    sos: L.LayerGroup;
  } | null>(null);

  // Initialize Leaflet map once — opens in Bengaluru, Karnataka, India with unrestricted pan/zoom across India
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      minZoom: 3,
      maxZoom: 19,
      zoomControl: true,
      preferCanvas: true,
    });

    const tileCfg = TILE_LAYERS[baseStyle];
    tileLayerRef.current = L.tileLayer(tileCfg.url, {
      attribution: tileCfg.attribution,
      maxZoom: 19,
    }).addTo(map);

    layerGroupsRef.current = {
      heatmap: L.layerGroup().addTo(map),
      h3: L.layerGroup().addTo(map),
      dbscan: L.layerGroup().addTo(map),
      potholes: L.layerGroup().addTo(map),
      devices: L.layerGroup().addTo(map),
      sos: L.layerGroup().addTo(map),
    };

    mapRef.current = map;

    // Ensure crisp sizing after flex container layout settles
    const resizeTimer = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      layerGroupsRef.current = null;
    };
  }, []);

  // Switch tile base style dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const cfg = TILE_LAYERS[baseStyle];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19,
    }).addTo(map);
  }, [baseStyle]);

  // Fly/pan when focusCoord changes (skip invalid or legacy US demo coordinates)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusCoord) return;
    if (!hasValidMapCoordinates(focusCoord.lat, focusCoord.lng)) return;
    map.flyTo([focusCoord.lat, focusCoord.lng], focusCoord.zoom ?? 15, {
      duration: 0.45,
    });
  }, [focusCoord]);

  // Render vector layers whenever data or layer visibility changes
  useEffect(() => {
    const groups = layerGroupsRef.current;
    if (!groups) return;

    groups.heatmap.clearLayers();
    groups.h3.clearLayers();
    groups.dbscan.clearLayers();
    groups.potholes.clearLayers();
    groups.devices.clearLayers();
    groups.sos.clearLayers();

    // Only verified potholes with reliable GPS coordinates appear as confirmed pothole markers
    const activePotholes = potholes.filter(
      (p) =>
        p.isVerifiedForMap !== false &&
        hasValidMapCoordinates(p.lat, p.lng, p.dataSource, p.hasReliableGps)
    );
    const activeClusters = clusters.filter((c) =>
      hasValidMapCoordinates(c.centroidLat, c.centroidLng, c.dataSource)
    );
    const activeH3Cells = h3Cells.filter((cell) =>
      hasValidMapCoordinates(cell.centerLat, cell.centerLng)
    );
    const activeDevices = devices.filter((d) =>
      hasValidMapCoordinates(d.lat, d.lng, d.dataSource)
    );
    const activeSosAlerts = sosAlerts.filter((a) =>
      hasValidMapCoordinates(a.lat, a.lng, a.dataSource)
    );

    // 1. Severity Heatmap Layer
    if (layers.heatmap) {
      activePotholes
        .filter((p) => p.status !== 'Repaired')
        .forEach((p) => {
          const color = getPotholeMarkerColor(p);
          const radius =
            p.severity === 'Critical' ? 210 : p.severity === 'High' ? 160 : 120;
          L.circle([p.lat as number, p.lng as number], {
            radius,
            color: 'transparent',
            fillColor: color,
            fillOpacity: p.severity === 'Critical' ? 0.24 : 0.16,
            interactive: false,
          }).addTo(groups.heatmap);
        });
    }

    // 2. H3 Hexagonal Grid Layer
    if (layers.h3HexGrid && activeH3Cells.length > 0) {
      activeH3Cells.forEach((cell) => {
        const fill =
          cell.compositePriority >= 80
            ? '#DC2626'
            : cell.compositePriority >= 62
              ? '#EA580C'
              : '#2563EB';
        const hex = L.polygon(cell.vertices, {
          color: fill,
          weight: 1.5,
          opacity: 0.85,
          fillColor: fill,
          fillOpacity: 0.2,
        });
        hex.bindTooltip(
          `<div style="font-family:JetBrains Mono,monospace;font-size:11px;line-height:1.4;">
            <strong>H3 ${escapeHtml(cell.h3Index)}</strong> (Res ${cell.resolution})<br/>
            Potholes: ${cell.potholeCount} · Avg IRI: ${escapeHtml(formatNumberOrNA(cell.avgIri, 1))}<br/>
            Priority: ${cell.compositePriority}/100
          </div>`,
          { sticky: true }
        );
        if (onSelectH3Cell) {
          hex.on('click', () => onSelectH3Cell(cell));
        }
        hex.addTo(groups.h3);
      });
    }

    // 3. DBSCAN Cluster Polygons Layer
    if (layers.dbscanClusters && activeClusters.length > 0) {
      activeClusters.forEach((cluster) => {
        const isSelected = cluster.id === selectedClusterId;
        const stroke =
          cluster.riskTier === 'Critical'
            ? '#DC2626'
            : cluster.riskTier === 'High'
              ? '#EA580C'
              : '#2563EB';

        const poly = L.polygon(cluster.hullPoints, {
          color: isSelected ? '#2563EB' : stroke,
          weight: isSelected ? 3 : 2,
          dashArray: isSelected ? undefined : '6, 4',
          fillColor: stroke,
          fillOpacity: isSelected ? 0.22 : 0.12,
        });

        const priorityText =
          cluster.priorityScore !== null ? `${cluster.priorityScore}/100` : 'N/A';

        poly.bindTooltip(
          `<div style="font-family:Public Sans,sans-serif;font-size:11px;">
            <strong style="font-family:JetBrains Mono,monospace;">${escapeHtml(cluster.id)}</strong> · ${escapeHtml(cluster.name)}<br/>
            <span style="font-family:JetBrains Mono,monospace;">${cluster.potholeCount} potholes · Priority ${escapeHtml(priorityText)}</span>
          </div>`,
          { sticky: true }
        );

        if (onSelectCluster) {
          poly.on('click', () => onSelectCluster(cluster));
        }
        poly.addTo(groups.dbscan);

        // Centroid badge
        const badgeIcon = L.divIcon({
          className: '',
          html: `<div style="background:#0F172A;color:#FFFFFF;border:1.5px solid ${stroke};border-radius:4px;padding:1px 5px;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:600;white-space:nowrap;box-shadow:0 2px 4px rgba(15,23,42,0.25);">${escapeHtml(cluster.id)} (${cluster.potholeCount})</div>`,
          iconSize: [74, 18],
          iconAnchor: [37, 9],
        });
        const labelMarker = L.marker([cluster.centroidLat, cluster.centroidLng], {
          icon: badgeIcon,
        });
        if (onSelectCluster) {
          labelMarker.on('click', () => onSelectCluster(cluster));
        }
        labelMarker.addTo(groups.dbscan);
      });
    }

    // 4. Severity-Based Pothole Markers (Event ID, Severity, Detection Time, Status)
    if (layers.potholes) {
      activePotholes.forEach((pothole) => {
        const isSelected = pothole.id === selectedPotholeId;
        const fillColor = getPotholeMarkerColor(pothole);
        const radius = isSelected ? 10 : pothole.severity === 'Critical' ? 8 : 6.5;

        const marker = L.circleMarker([pothole.lat as number, pothole.lng as number], {
          radius,
          fillColor,
          color: isSelected ? '#2563EB' : '#FFFFFF',
          weight: isSelected ? 3 : 2,
          opacity: 1,
          fillOpacity: 0.95,
        });

        const eventLabel = pothole.eventId ?? pothole.id;
        const severityLabel = pothole.severity ?? pothole.rawSeverity ?? 'N/A';
        const statusLabel = pothole.status ?? pothole.rawStatus ?? 'N/A';
        const verificationLabel =
          pothole.verified === true
            ? 'Verified'
            : pothole.verified === false
              ? 'Not Verified'
              : 'N/A';
        const verificationColor =
          pothole.verified === true
            ? '#15803D'
            : pothole.verified === false
              ? '#DC2626'
              : '#52627A';
        const detectedTimeLabel = formatShortTimestamp(pothole.detectedAt);

        marker.bindTooltip(
          `<div style="font-family:Public Sans,sans-serif;font-size:11px;min-width:190px;line-height:1.45;">
            <div style="font-family:JetBrains Mono,monospace;font-weight:700;color:#0F172A;">Event: ${escapeHtml(eventLabel)}</div>
            <div style="color:#334155;margin-top:2px;">Severity: <strong>${escapeHtml(severityLabel)}</strong> · Status: <strong>${escapeHtml(statusLabel)}</strong></div>
            <div style="color:${verificationColor};font-weight:700;margin-top:2px;">Verification: ${escapeHtml(verificationLabel)}</div>
            <div style="font-family:JetBrains Mono,monospace;color:#64748B;margin-top:2px;">Detected: ${escapeHtml(detectedTimeLabel)}</div>
          </div>`,
          { direction: 'top', offset: [0, -8] }
        );

        if (onSelectPothole) {
          marker.on('click', () => onSelectPothole(pothole));
        }
        marker.addTo(groups.potholes);
      });
    }

    // 5. ESP32 Patrol Devices Layer
    if (layers.devices && activeDevices.length > 0) {
      activeDevices
        .filter((d) => d.status !== 'Offline')
        .forEach((device) => {
          const dotColor = device.status === 'Online' ? '#0D9488' : '#EA580C';
          const shortId = device.id.replace(/^ESP32-/, '');
          const icon = L.divIcon({
            className: '',
            html: `<div style="display:flex;align-items:center;gap:4px;background:#FFFFFF;border:1.5px solid ${dotColor};border-radius:4px;padding:2px 5px;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:600;color:#0F172A;white-space:nowrap;box-shadow:0 2px 4px rgba(15,23,42,0.16);">
              <span style="width:6px;height:6px;border-radius:9999px;background:${dotColor};display:inline-block;"></span>
              ${escapeHtml(shortId)}
            </div>`,
            iconSize: [90, 20],
            iconAnchor: [45, 10],
          });

          const gpsLabel = device.rawGpsStatus ?? device.gpsFix ?? 'N/A';
          const satsLabel =
            device.satellites !== null ? `${device.satellites} sats` : 'N/A sats';
          const speedLabel =
            device.speedKmh !== null ? `${device.speedKmh} km/h` : 'N/A';

          const marker = L.marker([device.lat as number, device.lng as number], { icon });
          marker.bindTooltip(
            `<div style="font-family:JetBrains Mono,monospace;font-size:11px;">
              <strong>${escapeHtml(device.id)}</strong> (${escapeHtml(device.vehicleLabel ?? 'N/A')})<br/>
              GPS: ${escapeHtml(gpsLabel)} (${escapeHtml(satsLabel)}) · Speed: ${escapeHtml(speedLabel)}
            </div>`,
            { direction: 'top' }
          );
          if (onSelectDevice) {
            marker.on('click', () => onSelectDevice(device));
          }
          marker.addTo(groups.devices);
        });
    }

    // 6. Active Manual SOS Alert Pins
    if (layers.sosAlerts && activeSosAlerts.length > 0) {
      activeSosAlerts
        .filter((a) => a.isManualSos && a.status !== 'Resolved')
        .forEach((alert) => {
          const icon = L.divIcon({
            className: '',
            html: `<div style="display:flex;align-items:center;gap:4px;background:#DC2626;color:#FFFFFF;border:2px solid #FFFFFF;border-radius:4px;padding:2px 6px;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 3px 8px rgba(220,38,38,0.45);">
              SOS · ${escapeHtml(alert.deviceId?.replace(/^ESP32-/, '') || 'N/A')}
            </div>`,
            iconSize: [86, 22],
            iconAnchor: [43, 11],
          });
          L.marker([alert.lat as number, alert.lng as number], { icon })
            .bindTooltip(
              `<div style="font-family:Public Sans,sans-serif;font-size:11px;">
                <strong style="color:#DC2626;">MANUAL SOS BUTTON</strong><br/>
                ${escapeHtml(alert.roadName ?? 'N/A')} · ${escapeHtml(alert.operatorName ?? 'N/A')}
              </div>`,
              { direction: 'top' }
            )
            .addTo(groups.sos);
        });
    }
  }, [
    potholes,
    clusters,
    h3Cells,
    devices,
    sosAlerts,
    selectedPotholeId,
    selectedClusterId,
    layers,
    onSelectPothole,
    onSelectCluster,
    onSelectH3Cell,
    onSelectDevice,
  ]);

  return (
    <div className="neu-map-frame">
      <div
        ref={containerRef}
        className={`w-full ${heightClass} rounded-[11px] border border-[#CBD5E1]/70 overflow-hidden`}
      />
    </div>
  );
};
