import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import {
  ensureFirebaseInitialized,
  FIRESTORE_COLLECTIONS,
  handleFirestoreError,
  OperationType,
} from '../config/firebase';
import type {
  AlertRecord,
  DataSourceType,
  DbscanCluster,
  Esp32Device,
  MaintenanceCrew,
  MunicipalUser,
  MunicipalZone,
  PotholeRecord,
  RepairHistoryRecord,
  RepairWorkOrder,
  UserRole,
} from '../types';

async function requireDb(path: string, op: OperationType): Promise<Firestore> {
  const init = await ensureFirebaseInitialized();
  if (!init.ready || !init.db) {
    handleFirestoreError(
      new Error(`Firestore not initialized (${init.missingFields.join(', ')})`),
      op,
      path
    );
  }
  return init.db;
}

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function clampString(val: string | undefined | null, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

// ============================================================================
// 1. users collection CRUD
// ============================================================================
export const usersFirestoreService = {
  async getById(uid: string): Promise<MunicipalUser | null> {
    const safeUid = sanitizeId(uid);
    const path = `${FIRESTORE_COLLECTIONS.users}/${safeUid}`;
    const db = await requireDb(path, OperationType.GET);
    try {
      const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.users, safeUid));
      if (!snap.exists()) return null;
      const d = snap.data();
      return {
        id: safeUid,
        uid: safeUid,
        fullName: String(d.fullName || ''),
        email: String(d.email || ''),
        role: (d.role as UserRole) || 'Field Maintenance Team',
        department: String(d.department || 'Public Works'),
        districtScope: String(d.districtScope || 'All Municipal Districts'),
        phone: String(d.phone || ''),
        status: d.status === 'Suspended' ? 'Suspended' : 'Active',
        lastLogin: toIsoString(d.updatedAt || d.createdAt),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  },

  async list(): Promise<MunicipalUser[]> {
    const path = FIRESTORE_COLLECTIONS.users;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const snap = await getDocs(collection(db, FIRESTORE_COLLECTIONS.users));
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          uid: String(d.uid || docSnap.id),
          fullName: String(d.fullName || ''),
          email: String(d.email || ''),
          role: (d.role as UserRole) || 'Field Maintenance Team',
          department: String(d.department || ''),
          districtScope: String(d.districtScope || ''),
          phone: String(d.phone || ''),
          status: d.status === 'Suspended' ? 'Suspended' : 'Active',
          lastLogin: toIsoString(d.updatedAt || d.createdAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async createProfile(input: {
    uid: string;
    fullName: string;
    email: string;
    role?: UserRole;
    department: string;
    districtScope: string;
    phone?: string;
  }): Promise<void> {
    const safeUid = sanitizeId(input.uid);
    const path = `${FIRESTORE_COLLECTIONS.users}/${safeUid}`;
    const db = await requireDb(path, OperationType.CREATE);
    try {
      // Self-registration always defaults to least-privilege Field Maintenance Team.
      // Firestore rules block any non-Admin attempt to self-assign elevated roles.
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.users, safeUid), {
        uid: safeUid,
        fullName: clampString(input.fullName || 'Municipal Operator', 120),
        email: clampString(input.email, 200),
        role: input.role || 'Field Maintenance Team',
        department: clampString(input.department || 'Road Maintenance Operations', 120),
        districtScope: clampString(input.districtScope || 'All Municipal Districts', 120),
        phone: clampString(input.phone || '', 40),
        status: 'Active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async updateOwnProfile(
    uid: string,
    patch: { fullName?: string; department?: string; districtScope?: string; phone?: string }
  ): Promise<void> {
    const safeUid = sanitizeId(uid);
    const path = `${FIRESTORE_COLLECTIONS.users}/${safeUid}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      // Strictly allow only non-privileged profile fields (never role or status)
      const updatePayload: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
      };
      if (patch.fullName !== undefined)
        updatePayload.fullName = clampString(patch.fullName, 120);
      if (patch.department !== undefined)
        updatePayload.department = clampString(patch.department, 120);
      if (patch.districtScope !== undefined)
        updatePayload.districtScope = clampString(patch.districtScope, 120);
      if (patch.phone !== undefined) updatePayload.phone = clampString(patch.phone, 40);

      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.users, safeUid), updatePayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async adminUpdateUser(
    uid: string,
    patch: Partial<Pick<MunicipalUser, 'fullName' | 'role' | 'department' | 'districtScope' | 'phone' | 'status'>>
  ): Promise<void> {
    const safeUid = sanitizeId(uid);
    const path = `${FIRESTORE_COLLECTIONS.users}/${safeUid}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (patch.fullName !== undefined) payload.fullName = clampString(patch.fullName, 120);
      if (patch.role !== undefined) payload.role = patch.role;
      if (patch.department !== undefined) payload.department = clampString(patch.department, 120);
      if (patch.districtScope !== undefined)
        payload.districtScope = clampString(patch.districtScope, 120);
      if (patch.phone !== undefined) payload.phone = clampString(patch.phone, 40);
      if (patch.status !== undefined) payload.status = patch.status;
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.users, safeUid), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async remove(uid: string): Promise<void> {
    const safeUid = sanitizeId(uid);
    const path = `${FIRESTORE_COLLECTIONS.users}/${safeUid}`;
    const db = await requireDb(path, OperationType.DELETE);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.users, safeUid));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },
};

// ============================================================================
// 2. devices collection CRUD
// ============================================================================
export const devicesFirestoreService = {
  async list(dataSource?: DataSourceType): Promise<Esp32Device[]> {
    const path = FIRESTORE_COLLECTIONS.devices;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const q = dataSource
        ? query(collection(db, path), where('dataSource', '==', dataSource))
        : collection(db, path);
      const snap = await getDocs(q);
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          vehicleLabel: String(d.vehicleLabel || ''),
          mountType: d.mountType || 'Municipal Patrol Van',
          district: String(d.district || ''),
          status: d.status || 'Online',
          firmwareVersion: String(d.firmwareVersion || '2.4.1-mpu-ml'),
          mpu6050Status: d.mpu6050Status || 'Calibrated',
          gpsFix: d.gpsFix || '3D Fix',
          satellites: Number(d.satellites || 0),
          batteryVoltage: Number(d.batteryVoltage || 12.6),
          signalRssi: Number(d.signalRssi || -70),
          packetsToday: Number(d.packetsToday || 0),
          potholesDetectedToday: Number(d.potholesDetectedToday || 0),
          lastHeartbeat: toIsoString(d.updatedAt),
          lat: Number(d.lat || 0),
          lng: Number(d.lng || 0),
          speedKmh: Number(d.speedKmh || 0),
          manualSosButtonState: d.manualSosButtonState || 'Armed',
          recentAccelSamples: [],
          dataSource: (d.dataSource as DataSourceType) || 'LIVE_ESP32',
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async create(device: Omit<Esp32Device, 'recentAccelSamples' | 'lastHeartbeat'>): Promise<void> {
    const safeId = sanitizeId(device.id);
    const path = `${FIRESTORE_COLLECTIONS.devices}/${safeId}`;
    const db = await requireDb(path, OperationType.CREATE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.devices, safeId), {
        id: safeId,
        vehicleLabel: clampString(device.vehicleLabel, 120),
        mountType: device.mountType,
        district: clampString(device.district, 120),
        status: device.status,
        firmwareVersion: clampString(device.firmwareVersion, 40),
        mpu6050Status: device.mpu6050Status,
        gpsFix: device.gpsFix,
        satellites: device.satellites,
        batteryVoltage: device.batteryVoltage,
        signalRssi: device.signalRssi,
        packetsToday: device.packetsToday,
        potholesDetectedToday: device.potholesDetectedToday,
        lat: device.lat,
        lng: device.lng,
        speedKmh: device.speedKmh,
        manualSosButtonState: device.manualSosButtonState,
        dataSource: device.dataSource,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async update(
    deviceId: string,
    patch: Partial<
      Pick<
        Esp32Device,
        'status' | 'firmwareVersion' | 'mpu6050Status' | 'gpsFix' | 'satellites' | 'manualSosButtonState'
      >
    >
  ): Promise<void> {
    const safeId = sanitizeId(deviceId);
    const path = `${FIRESTORE_COLLECTIONS.devices}/${safeId}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.devices, safeId), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async remove(deviceId: string): Promise<void> {
    const safeId = sanitizeId(deviceId);
    const path = `${FIRESTORE_COLLECTIONS.devices}/${safeId}`;
    const db = await requireDb(path, OperationType.DELETE);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.devices, safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },
};

// ============================================================================
// 3. pothole_events collection CRUD
// ============================================================================
export const potholeEventsFirestoreService = {
  async list(dataSource?: DataSourceType): Promise<PotholeRecord[]> {
    const path = FIRESTORE_COLLECTIONS.potholeEvents;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const q = dataSource
        ? query(collection(db, path), where('dataSource', '==', dataSource))
        : collection(db, path);
      const snap = await getDocs(q);
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const peakAccelG = Number(d.peakAccelG ?? 3.0);
        return {
          id: docSnap.id,
          roadName: String(d.roadName || ''),
          segmentCode: String(d.segmentCode || 'SEG-000'),
          district: String(d.district || ''),
          arterialClass: d.arterialClass || 'Arterial',
          lat: Number(d.lat || 0),
          lng: Number(d.lng || 0),
          h3Index: String(d.h3Index || ''),
          clusterId: d.clusterId ? String(d.clusterId) : null,
          classification: 'Pothole',
          severity: d.severity || 'Moderate',
          status: d.status || 'Detected',
          priorityScore: Number(d.priorityScore || 50),
          priorityTier: d.priorityTier || 'P2',
          detectedAt: toIsoString(d.createdAt),
          updatedAt: toIsoString(d.updatedAt),
          deviceId: String(d.deviceId || 'ESP32-UNKNOWN'),
          telemetry: {
            peakAccelG,
            rmsVibration: Number(d.rmsVibration ?? 1.8),
            iriScore: Number(d.iriScore ?? 5.0),
            durationMs: 140,
            speedKmh: 35,
            mlConfidence: Number(d.mlConfidence ?? 90),
            waveformSample: [1, 1.02, 0.99, peakAccelG * 0.6, peakAccelG, -peakAccelG * 0.3, 1.05, 1],
          },
          detectionCount: Number(d.detectionCount ?? 1),
          assignedWorkOrderId: d.assignedWorkOrderId ? String(d.assignedWorkOrderId) : null,
          notes: String(d.notes || ''),
          dataSource: (d.dataSource as DataSourceType) || 'LIVE_ESP32',
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async create(record: PotholeRecord): Promise<void> {
    const safeId = sanitizeId(record.id);
    const path = `${FIRESTORE_COLLECTIONS.potholeEvents}/${safeId}`;
    const db = await requireDb(path, OperationType.CREATE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.potholeEvents, safeId), {
        id: safeId,
        roadName: clampString(record.roadName, 160),
        segmentCode: clampString(record.segmentCode, 64),
        district: clampString(record.district, 120),
        arterialClass: record.arterialClass,
        lat: record.lat,
        lng: record.lng,
        h3Index: clampString(record.h3Index, 32),
        clusterId: record.clusterId ? clampString(record.clusterId, 64) : null,
        classification: 'Pothole',
        severity: record.severity,
        status: record.status,
        priorityScore: record.priorityScore,
        priorityTier: record.priorityTier,
        deviceId: clampString(record.deviceId, 64),
        peakAccelG: record.telemetry.peakAccelG,
        rmsVibration: record.telemetry.rmsVibration,
        iriScore: record.telemetry.iriScore,
        mlConfidence: record.telemetry.mlConfidence,
        detectionCount: record.detectionCount,
        assignedWorkOrderId: record.assignedWorkOrderId,
        notes: clampString(record.notes, 1000),
        dataSource: record.dataSource,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async update(
    eventId: string,
    patch: Partial<Pick<PotholeRecord, 'status' | 'severity' | 'notes' | 'assignedWorkOrderId'>>
  ): Promise<void> {
    const safeId = sanitizeId(eventId);
    const path = `${FIRESTORE_COLLECTIONS.potholeEvents}/${safeId}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (patch.status !== undefined) payload.status = patch.status;
      if (patch.severity !== undefined) payload.severity = patch.severity;
      if (patch.notes !== undefined) payload.notes = clampString(patch.notes, 1000);
      if (patch.assignedWorkOrderId !== undefined)
        payload.assignedWorkOrderId = patch.assignedWorkOrderId;
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.potholeEvents, safeId), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async remove(eventId: string): Promise<void> {
    const safeId = sanitizeId(eventId);
    const path = `${FIRESTORE_COLLECTIONS.potholeEvents}/${safeId}`;
    const db = await requireDb(path, OperationType.DELETE);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.potholeEvents, safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },
};

// ============================================================================
// 4. pothole_clusters collection CRUD
// ============================================================================
export const potholeClustersFirestoreService = {
  async list(): Promise<DbscanCluster[]> {
    const path = FIRESTORE_COLLECTIONS.potholeClusters;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          name: String(d.name || ''),
          district: String(d.district || ''),
          centroidLat: Number(d.centroidLat || 0),
          centroidLng: Number(d.centroidLng || 0),
          radiusMeters: Number(d.radiusMeters || 150),
          potholeIds: Array.isArray(d.potholeIds) ? d.potholeIds : [],
          potholeCount: Number(d.potholeCount || 0),
          criticalCount: Number(d.criticalCount || 0),
          avgIri: Number(d.avgIri || 0),
          maxPeakG: Number(d.maxPeakG || 0),
          priorityScore: Number(d.priorityScore || 0),
          riskTier: d.riskTier || 'Moderate',
          hullPoints: [],
          dataSource: (d.dataSource as DataSourceType) || 'LIVE_ESP32',
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async upsert(cluster: DbscanCluster): Promise<void> {
    const safeId = sanitizeId(cluster.id);
    const path = `${FIRESTORE_COLLECTIONS.potholeClusters}/${safeId}`;
    const db = await requireDb(path, OperationType.WRITE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.potholeClusters, safeId), {
        id: safeId,
        name: clampString(cluster.name, 160),
        district: clampString(cluster.district, 120),
        centroidLat: cluster.centroidLat,
        centroidLng: cluster.centroidLng,
        radiusMeters: cluster.radiusMeters,
        potholeIds: cluster.potholeIds.slice(0, 200),
        potholeCount: cluster.potholeCount,
        criticalCount: cluster.criticalCount,
        avgIri: cluster.avgIri,
        maxPeakG: cluster.maxPeakG,
        priorityScore: cluster.priorityScore,
        riskTier: cluster.riskTier,
        dataSource: cluster.dataSource,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async remove(clusterId: string): Promise<void> {
    const safeId = sanitizeId(clusterId);
    const path = `${FIRESTORE_COLLECTIONS.potholeClusters}/${safeId}`;
    const db = await requireDb(path, OperationType.DELETE);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.potholeClusters, safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },
};

// ============================================================================
// 5. municipal_zones collection CRUD
// ============================================================================
export const municipalZonesFirestoreService = {
  async list(): Promise<MunicipalZone[]> {
    const path = FIRESTORE_COLLECTIONS.municipalZones;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          name: String(d.name || ''),
          code: String(d.code || ''),
          slaCriticalHours: Number(d.slaCriticalHours || 24),
          slaHighHours: Number(d.slaHighHours || 72),
          targetIriMax: Number(d.targetIriMax || 3.5),
          roadKmMonitored: Number(d.roadKmMonitored || 0),
          updatedAt: toIsoString(d.updatedAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async upsert(zone: Omit<MunicipalZone, 'updatedAt'>): Promise<void> {
    const safeId = sanitizeId(zone.id);
    const path = `${FIRESTORE_COLLECTIONS.municipalZones}/${safeId}`;
    const db = await requireDb(path, OperationType.WRITE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.municipalZones, safeId), {
        id: safeId,
        name: clampString(zone.name, 120),
        code: clampString(zone.code, 32),
        slaCriticalHours: zone.slaCriticalHours,
        slaHighHours: zone.slaHighHours,
        targetIriMax: zone.targetIriMax,
        roadKmMonitored: zone.roadKmMonitored,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async remove(zoneId: string): Promise<void> {
    const safeId = sanitizeId(zoneId);
    const path = `${FIRESTORE_COLLECTIONS.municipalZones}/${safeId}`;
    const db = await requireDb(path, OperationType.DELETE);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.municipalZones, safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },
};

// ============================================================================
// 6. maintenance_teams collection CRUD
// ============================================================================
export const maintenanceTeamsFirestoreService = {
  async list(): Promise<MaintenanceCrew[]> {
    const path = FIRESTORE_COLLECTIONS.maintenanceTeams;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          name: String(d.name || ''),
          leadEngineer: String(d.leadEngineer || ''),
          district: String(d.district || ''),
          status: d.status || 'Available',
          vehicleUnit: String(d.vehicleUnit || ''),
          activeOrderCount: Number(d.activeOrderCount || 0),
          membersCount: Number(d.membersCount || 4),
          contactRadio: String(d.contactRadio || ''),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async upsert(team: MaintenanceCrew): Promise<void> {
    const safeId = sanitizeId(team.id);
    const path = `${FIRESTORE_COLLECTIONS.maintenanceTeams}/${safeId}`;
    const db = await requireDb(path, OperationType.WRITE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.maintenanceTeams, safeId), {
        id: safeId,
        name: clampString(team.name, 120),
        leadEngineer: clampString(team.leadEngineer, 120),
        district: clampString(team.district, 120),
        status: team.status,
        vehicleUnit: clampString(team.vehicleUnit, 64),
        activeOrderCount: team.activeOrderCount,
        membersCount: team.membersCount,
        contactRadio: clampString(team.contactRadio, 64),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async updateStatus(teamId: string, status: MaintenanceCrew['status']): Promise<void> {
    const safeId = sanitizeId(teamId);
    const path = `${FIRESTORE_COLLECTIONS.maintenanceTeams}/${safeId}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.maintenanceTeams, safeId), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async remove(teamId: string): Promise<void> {
    const safeId = sanitizeId(teamId);
    const path = `${FIRESTORE_COLLECTIONS.maintenanceTeams}/${safeId}`;
    const db = await requireDb(path, OperationType.DELETE);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.maintenanceTeams, safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },
};

// ============================================================================
// 7. repair_tasks collection CRUD
// ============================================================================
export const repairTasksFirestoreService = {
  async list(dataSource?: DataSourceType): Promise<RepairWorkOrder[]> {
    const path = FIRESTORE_COLLECTIONS.repairTasks;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const q = dataSource
        ? query(collection(db, path), where('dataSource', '==', dataSource))
        : collection(db, path);
      const snap = await getDocs(q);
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          title: String(d.title || ''),
          roadName: String(d.roadName || ''),
          district: String(d.district || ''),
          potholeIds: Array.isArray(d.potholeIds) ? d.potholeIds : [],
          clusterId: d.clusterId ? String(d.clusterId) : null,
          priority: d.priority || 'P2',
          status: d.status || 'Queued',
          assignedCrewId: d.assignedCrewId ? String(d.assignedCrewId) : null,
          createdAt: toIsoString(d.createdAt),
          scheduledDate: String(d.scheduledDate || toIsoString(d.createdAt)),
          slaDeadline: String(d.slaDeadline || toIsoString(d.createdAt)),
          completedAt: d.completedAt ? String(d.completedAt) : null,
          estimatedAsphaltTons: Number(d.estimatedAsphaltTons || 0),
          estimatedCostUsd: Number(d.estimatedCostUsd || 0),
          notes: String(d.notes || ''),
          dataSource: (d.dataSource as DataSourceType) || 'LIVE_ESP32',
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async create(order: RepairWorkOrder, createdByUid: string): Promise<void> {
    const safeId = sanitizeId(order.id);
    const path = `${FIRESTORE_COLLECTIONS.repairTasks}/${safeId}`;
    const db = await requireDb(path, OperationType.CREATE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.repairTasks, safeId), {
        id: safeId,
        title: clampString(order.title, 180),
        roadName: clampString(order.roadName, 160),
        district: clampString(order.district, 120),
        potholeIds: order.potholeIds.slice(0, 50),
        clusterId: order.clusterId ? clampString(order.clusterId, 64) : null,
        priority: order.priority,
        status: order.status,
        assignedCrewId: order.assignedCrewId ? clampString(order.assignedCrewId, 64) : null,
        scheduledDate: clampString(order.scheduledDate, 64),
        slaDeadline: clampString(order.slaDeadline, 64),
        completedAt: order.completedAt ? clampString(order.completedAt, 64) : null,
        estimatedAsphaltTons: order.estimatedAsphaltTons,
        estimatedCostUsd: order.estimatedCostUsd,
        notes: clampString(order.notes, 1000),
        dataSource: order.dataSource,
        createdBy: sanitizeId(createdByUid),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async update(
    taskId: string,
    patch: Partial<Pick<RepairWorkOrder, 'status' | 'assignedCrewId' | 'priority' | 'notes' | 'completedAt'>>
  ): Promise<void> {
    const safeId = sanitizeId(taskId);
    const path = `${FIRESTORE_COLLECTIONS.repairTasks}/${safeId}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (patch.status !== undefined) payload.status = patch.status;
      if (patch.assignedCrewId !== undefined) payload.assignedCrewId = patch.assignedCrewId;
      if (patch.priority !== undefined) payload.priority = patch.priority;
      if (patch.notes !== undefined) payload.notes = clampString(patch.notes, 1000);
      if (patch.completedAt !== undefined) payload.completedAt = patch.completedAt;
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.repairTasks, safeId), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async remove(taskId: string): Promise<void> {
    const safeId = sanitizeId(taskId);
    const path = `${FIRESTORE_COLLECTIONS.repairTasks}/${safeId}`;
    const db = await requireDb(path, OperationType.DELETE);
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.repairTasks, safeId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },
};

// ============================================================================
// 8. repair_history collection (Append-Only Audit Log)
// ============================================================================
export const repairHistoryFirestoreService = {
  async listByTask(taskId: string): Promise<RepairHistoryRecord[]> {
    const path = FIRESTORE_COLLECTIONS.repairHistory;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const q = query(
        collection(db, path),
        where('taskId', '==', sanitizeId(taskId)),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const snap = await getDocs(q);
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          taskId: String(d.taskId || ''),
          previousStatus: d.previousStatus || 'Created',
          newStatus: d.newStatus || 'Queued',
          actorUid: String(d.actorUid || ''),
          actorName: String(d.actorName || ''),
          notes: String(d.notes || ''),
          postRepairIri: d.postRepairIri !== undefined ? Number(d.postRepairIri) : undefined,
          createdAt: toIsoString(d.createdAt),
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async append(entry: Omit<RepairHistoryRecord, 'createdAt'>): Promise<void> {
    const safeId = sanitizeId(entry.id);
    const path = `${FIRESTORE_COLLECTIONS.repairHistory}/${safeId}`;
    const db = await requireDb(path, OperationType.CREATE);
    try {
      const payload: Record<string, unknown> = {
        id: safeId,
        taskId: sanitizeId(entry.taskId),
        previousStatus: clampString(entry.previousStatus, 40),
        newStatus: clampString(entry.newStatus, 40),
        actorUid: sanitizeId(entry.actorUid),
        actorName: clampString(entry.actorName, 120),
        notes: clampString(entry.notes, 1000),
        createdAt: serverTimestamp(),
      };
      if (entry.postRepairIri !== undefined) {
        payload.postRepairIri = entry.postRepairIri;
      }
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.repairHistory, safeId), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },
};

// ============================================================================
// 9. sos_alerts collection CRUD (Independent Manual SOS Button Channel)
// ============================================================================
export const sosAlertsFirestoreService = {
  async list(): Promise<AlertRecord[]> {
    const path = FIRESTORE_COLLECTIONS.sosAlerts;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          category: 'MANUAL_SOS',
          isManualSos: true,
          severity: 'Critical',
          title: String(d.title || ''),
          message: String(d.message || ''),
          timestamp: toIsoString(d.createdAt),
          deviceId: d.deviceId ? String(d.deviceId) : null,
          potholeId: null,
          lat: d.lat !== undefined && d.lat !== null ? Number(d.lat) : null,
          lng: d.lng !== undefined && d.lng !== null ? Number(d.lng) : null,
          roadName: d.roadName ? String(d.roadName) : null,
          operatorName: d.operatorName ? String(d.operatorName) : null,
          status: d.status || 'Active',
          acknowledgedBy: d.acknowledgedBy ? String(d.acknowledgedBy) : null,
          acknowledgedAt: d.acknowledgedAt ? String(d.acknowledgedAt) : null,
          dataSource: (d.dataSource as DataSourceType) || 'LIVE_ESP32',
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async create(alert: AlertRecord): Promise<void> {
    const safeId = sanitizeId(alert.id);
    const path = `${FIRESTORE_COLLECTIONS.sosAlerts}/${safeId}`;
    const db = await requireDb(path, OperationType.CREATE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.sosAlerts, safeId), {
        id: safeId,
        isManualSos: true,
        title: clampString(alert.title, 200),
        message: clampString(alert.message, 1000),
        deviceId: alert.deviceId ? clampString(alert.deviceId, 64) : null,
        roadName: alert.roadName ? clampString(alert.roadName, 160) : null,
        operatorName: alert.operatorName ? clampString(alert.operatorName, 120) : null,
        lat: alert.lat,
        lng: alert.lng,
        status: alert.status,
        acknowledgedBy: alert.acknowledgedBy,
        acknowledgedAt: alert.acknowledgedAt,
        dataSource: alert.dataSource,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async updateStatus(
    alertId: string,
    status: AlertRecord['status'],
    acknowledgedBy: string
  ): Promise<void> {
    const safeId = sanitizeId(alertId);
    const path = `${FIRESTORE_COLLECTIONS.sosAlerts}/${safeId}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.sosAlerts, safeId), {
        status,
        acknowledgedBy: clampString(acknowledgedBy, 120),
        acknowledgedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },
};

// ============================================================================
// 10. notifications collection CRUD
// ============================================================================
export const notificationsFirestoreService = {
  async list(): Promise<AlertRecord[]> {
    const path = FIRESTORE_COLLECTIONS.notifications;
    const db = await requireDb(path, OperationType.LIST);
    try {
      const snap = await getDocs(collection(db, path));
      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          category: d.category || 'CRITICAL_POTHOLE',
          isManualSos: false,
          severity: d.severity || 'High',
          title: String(d.title || ''),
          message: String(d.message || ''),
          timestamp: toIsoString(d.createdAt),
          deviceId: d.deviceId ? String(d.deviceId) : null,
          potholeId: d.potholeId ? String(d.potholeId) : null,
          lat: d.lat !== undefined && d.lat !== null ? Number(d.lat) : null,
          lng: d.lng !== undefined && d.lng !== null ? Number(d.lng) : null,
          roadName: d.roadName ? String(d.roadName) : null,
          operatorName: null,
          status: d.status || 'Active',
          acknowledgedBy: d.acknowledgedBy ? String(d.acknowledgedBy) : null,
          acknowledgedAt: d.acknowledgedAt ? String(d.acknowledgedAt) : null,
          dataSource: (d.dataSource as DataSourceType) || 'LIVE_ESP32',
        };
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async create(alert: AlertRecord): Promise<void> {
    const safeId = sanitizeId(alert.id);
    const path = `${FIRESTORE_COLLECTIONS.notifications}/${safeId}`;
    const db = await requireDb(path, OperationType.CREATE);
    try {
      await setDoc(doc(db, FIRESTORE_COLLECTIONS.notifications, safeId), {
        id: safeId,
        category: alert.category === 'MANUAL_SOS' ? 'CRITICAL_POTHOLE' : alert.category,
        severity: alert.severity,
        title: clampString(alert.title, 200),
        message: clampString(alert.message, 1000),
        deviceId: alert.deviceId ? clampString(alert.deviceId, 64) : null,
        potholeId: alert.potholeId ? clampString(alert.potholeId, 64) : null,
        lat: alert.lat,
        lng: alert.lng,
        roadName: alert.roadName ? clampString(alert.roadName, 160) : null,
        status: alert.status,
        acknowledgedBy: alert.acknowledgedBy,
        acknowledgedAt: alert.acknowledgedAt,
        dataSource: alert.dataSource,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async updateStatus(
    notificationId: string,
    status: AlertRecord['status'],
    acknowledgedBy: string
  ): Promise<void> {
    const safeId = sanitizeId(notificationId);
    const path = `${FIRESTORE_COLLECTIONS.notifications}/${safeId}`;
    const db = await requireDb(path, OperationType.UPDATE);
    try {
      await updateDoc(doc(db, FIRESTORE_COLLECTIONS.notifications, safeId), {
        status,
        acknowledgedBy: clampString(acknowledgedBy, 120),
        acknowledgedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },
};

export const firestoreServices = {
  users: usersFirestoreService,
  devices: devicesFirestoreService,
  potholeEvents: potholeEventsFirestoreService,
  potholeClusters: potholeClustersFirestoreService,
  municipalZones: municipalZonesFirestoreService,
  maintenanceTeams: maintenanceTeamsFirestoreService,
  repairTasks: repairTasksFirestoreService,
  repairHistory: repairHistoryFirestoreService,
  sosAlerts: sosAlertsFirestoreService,
  notifications: notificationsFirestoreService,
};
