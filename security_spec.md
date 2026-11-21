# TERRA Track Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **No Unauthenticated Access**: Every collection rejects unauthenticated requests (`request.auth == null`).
2. **Authoritative Role Lookup**: Roles (`Admin`, `Municipal Officer`, `Field Maintenance Team`) are read strictly from `/users/{uid}` in Firestore (never from client-supplied claims or request headers).
3. **Zero Self-Role Escalation**: A user creating their own `/users/{uid}` profile may only register with `role == 'Field Maintenance Team'` and `status == 'Active'` (unless their verified email matches the bootstrap Admin). Users updating their own profile may only modify `fullName`, `department`, `districtScope`, `phone`, and `updatedAt` — never `role` or `status`.
4. **PII Isolation**: `/users/{uid}` documents are readable strictly by the profile owner (`request.auth.uid == userId`) or an `Admin`.
5. **Pothole-Only Workflow Integrity**: `/pothole_events` requires `classification == 'Pothole'` and explicit `dataSource in ['LIVE_ESP32', 'SIMULATED_DEMO']`.
6. **Immutable Audit Trail**: `/repair_history` is append-only (`update` and `delete` denied for non-admins) and requires `actorUid == request.auth.uid`.
7. **Terminal State Locking**: Once a `/repair_tasks` document reaches `status == 'Completed'` or an `/sos_alerts` document reaches `status == 'Resolved'`, non-Admin roles cannot mutate it further.
8. **Temporal Integrity & Bounded Fields**: Every string and array is size-bounded; `createdAt`/`updatedAt` are validated against `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read** on `/pothole_events/PTH-001` (`auth: null`).
2. **Self-Assigned Admin Registration**: New user creating `/users/{uid}` with `{ "role": "Admin" }`.
3. **Self-Role Escalation Update**: `Field Maintenance Team` updating `/users/{uid}` with `{ "role": "Admin" }`.
4. **Cross-User PII Read**: `Municipal Officer` reading `/users/other-uid`.
5. **Shadow Field Injection**: `Admin` updating `/pothole_events/PTH-001` with ghost field `{ "isSuperAdminBypass": true }`.
6. **Non-Pothole Injection**: Creating `/pothole_events/PTH-999` with `{ "classification": "Speed Breaker" }`.
7. **Field Team Unauthorized Task Creation**: `Field Maintenance Team` creating a `/repair_tasks` document.
8. **Field Team Cost Tampering**: `Field Maintenance Team` updating `/repair_tasks/WO-1` with `{ "estimatedCostUsd": 999999 }` (outside allowed `['status', 'notes', 'updatedAt']`).
9. **Terminal State Re-Open**: `Municipal Officer` mutating `/repair_tasks/WO-115` after `status == 'Completed'`.
10. **Repair History Impersonation**: Creating `/repair_history/H-1` with `actorUid: "another-user-uid"`.
11. **Repair History Tampering**: Non-Admin updating or deleting an existing `/repair_history/H-1` record.
12. **Path ID Poisoning / Oversized Payload**: Writing `/devices/../../../etc/passwd` or a 5,000-char `notes` string to `/pothole_events/PTH-1`.
