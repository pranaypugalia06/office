import assert from "node:assert/strict";
import {
  hasReplayStartingBaseline,
  findNewOrWorsenedNegativeBalanceReplayEntry,
  replayBalanceHistory,
  sortAuditRowsByActualTime,
} from "../client/src/lib/history-replay";
import type { Transaction } from "../client/src/lib/types";

const transactions: Transaction[] = [
  {
    id: "demo-adjustment-1",
    itemId: "Test Item",
    category: "Demo",
    type: "adjustment",
    quantityChange: 29,
    timestamp: new Date("2026-05-11T14:02:46+05:30"),
    businessDate: new Date("2026-05-11T00:00:00+05:30"),
    newHTBalance: 5,
    newFABalance: 7,
    newOFBalance: 11,
    previousHTBalance: 0,
    previousFABalance: 0,
    previousOFBalance: 0,
    notes: "Test adjustment",
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "demo-transfer-1",
    itemId: "Test Item",
    category: "Demo",
    type: "office_transfer_created",
    quantityChange: 2,
    timestamp: new Date("2026-05-11T14:11:38+05:30"),
    businessDate: new Date("2026-05-11T00:00:00+05:30"),
    notes: "Test transfer after adjustment",
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];

const rows = replayBalanceHistory(transactions);
const editedOfficeTransfer = rows[1];

assert.deepEqual(editedOfficeTransfer.before, { ht: 5, fa: 7, of: 11 });
assert.deepEqual(editedOfficeTransfer.after, { ht: 5, fa: 5, of: 13 });

const outOfBusinessDateOrderTransactions: Transaction[] = [
  {
    id: "heat-treatment-created-later-business-day",
    itemId: "65 LH",
    category: "CUTTER M15",
    type: "heat_treatment_created",
    quantityChange: 216,
    timestamp: new Date("2026-09-10T14:00:06+05:30"),
    businessDate: new Date("2026-09-10T00:00:00+05:30"),
    previousBalance: 0,
    balance: 216,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "manual-adjustment-created-earlier-business-later",
    itemId: "65 LH",
    category: "CUTTER M15",
    type: "adjustment",
    quantityChange: -5,
    timestamp: new Date("2026-09-10T14:03:07+05:30"),
    businessDate: new Date("2026-09-08T00:00:00+05:30"),
    previousHTBalance: 216,
    previousFABalance: 25,
    previousOFBalance: 254,
    newHTBalance: 216,
    newFABalance: 25,
    newOFBalance: 249,
    previousBalance: 495,
    balance: 490,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];

const chronologicalRows = replayBalanceHistory(outOfBusinessDateOrderTransactions);
const heatTreatmentReplay = chronologicalRows[0];
const adjustmentReplay = chronologicalRows[1];

assert.equal(heatTreatmentReplay.tx.id, "heat-treatment-created-later-business-day");
assert.deepEqual(heatTreatmentReplay.before, { ht: 0, fa: 0, of: 0 });
assert.deepEqual(heatTreatmentReplay.after, { ht: 216, fa: 0, of: 0 });
assert.equal(adjustmentReplay.tx.id, "manual-adjustment-created-earlier-business-later");
assert.deepEqual(adjustmentReplay.before, { ht: 216, fa: 0, of: 0 });
assert.deepEqual(adjustmentReplay.after, { ht: 216, fa: 25, of: 249 });

const backdatedAuditRows = sortAuditRowsByActualTime([
  { id: "later-sale", timestamp: new Date("2026-10-03T14:08:46Z"), businessDate: new Date("2026-09-29T00:00:00Z") },
  { id: "earlier-sale", timestamp: new Date("2026-09-29T15:48:19Z"), businessDate: new Date("2026-09-29T00:00:00Z") },
  { id: "adjustment", timestamp: new Date("2026-09-30T12:19:24Z") },
]);
assert.deepEqual(backdatedAuditRows.map((row) => row.id), ["earlier-sale", "adjustment", "later-sale"]);

const officeTransferAfterManualAdjustment: Transaction[] = [
  {
    id: "manual-adjustment-one-to-factory",
    itemId: "62 LH",
    category: "CUTTER M15",
    type: "adjustment",
    quantityChange: 1,
    timestamp: new Date("2026-09-30T12:19:24Z"),
    previousHTBalance: 0,
    previousFABalance: 0,
    previousOFBalance: 23,
    newHTBalance: 0,
    newFABalance: 1,
    newOFBalance: 23,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "office-transfer-of-adjusted-unit",
    itemId: "62 LH",
    category: "CUTTER M15",
    type: "office_transfer_created",
    quantityChange: 1,
    timestamp: new Date("2026-09-30T12:20:36Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "october-sale-one",
    itemId: "62 LH",
    category: "CUTTER M15",
    type: "sales",
    quantityChange: -12,
    timestamp: new Date("2026-10-03T14:08:46Z"),
    businessDate: new Date("2026-10-01T00:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];

const officeTransferReplay = replayBalanceHistory(officeTransferAfterManualAdjustment);
assert.deepEqual(officeTransferReplay[0].after, { ht: 0, fa: 1, of: 23 });
assert.deepEqual(officeTransferReplay[1].after, { ht: 0, fa: 0, of: 24 });
assert.deepEqual(officeTransferReplay[2].after, { ht: 0, fa: 0, of: 12 });
const duplicateSaleReplay = replayBalanceHistory([
  ...officeTransferAfterManualAdjustment,
  {
    id: "second-recorded-sale",
    itemId: "62 LH",
    category: "CUTTER M15",
    type: "sales",
    quantityChange: -12,
    timestamp: new Date("2026-10-03T14:09:51Z"),
    businessDate: new Date("2026-10-01T00:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
]);
assert.deepEqual(duplicateSaleReplay.at(-1)?.after, { ht: 0, fa: 0, of: 0 });

const temporarilyNegativeFactoryHistory: Transaction[] = [
  {
    id: "factory-opening-baseline",
    itemId: "Negative Test Item",
    category: "Demo",
    type: "balance_baseline_accepted",
    quantityChange: 0,
    timestamp: new Date("2026-07-16T00:00:00Z"),
    previousHTBalance: 0,
    previousFABalance: 0,
    previousOFBalance: 0,
    newHTBalance: 0,
    newFABalance: 0,
    newOFBalance: 0,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "office-transfer-overdraws-factory",
    itemId: "Negative Test Item",
    category: "Demo",
    type: "office_transfer_created",
    quantityChange: 3,
    timestamp: new Date("2026-07-17T00:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "later-adjustment-hides-overdraw",
    itemId: "Negative Test Item",
    category: "Demo",
    type: "adjustment",
    quantityChange: 3,
    timestamp: new Date("2026-07-18T00:00:00Z"),
    previousHTBalance: 0,
    previousFABalance: -3,
    previousOFBalance: 3,
    newHTBalance: 0,
    newFABalance: 0,
    newOFBalance: 3,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];

assert.equal(
  findNewOrWorsenedNegativeBalanceReplayEntry(
    temporarilyNegativeFactoryHistory,
    temporarilyNegativeFactoryHistory
  ),
  undefined
);
const worsenedFactoryHistory = temporarilyNegativeFactoryHistory.map((tx) =>
  tx.id === "office-transfer-overdraws-factory" ? { ...tx, quantityChange: 4 } : tx
);
assert.equal(
  findNewOrWorsenedNegativeBalanceReplayEntry(
    worsenedFactoryHistory,
    temporarilyNegativeFactoryHistory
  )?.tx.id,
  "office-transfer-overdraws-factory"
);

const existingNegativeOfficeBalance: Transaction[] = [
  {
    id: "existing-office-overdraw",
    itemId: "Changed Product",
    category: "Chaser",
    type: "sales",
    quantityChange: -2,
    timestamp: new Date("2026-08-01T10:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];
const changedHeatTreatment = [
  ...existingNegativeOfficeBalance,
  {
    id: "new-heat-treatment-row",
    itemId: "Changed Product",
    category: "Chaser",
    type: "heat_treatment_created",
    quantityChange: 5,
    timestamp: new Date("2026-08-02T10:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];
assert.equal(
  findNewOrWorsenedNegativeBalanceReplayEntry(
    changedHeatTreatment,
    existingNegativeOfficeBalance,
    new Set(["changed product::chaser"])
  ),
  undefined
);

const newOverdrawnTransfer: Transaction[] = [
  {
    id: "new-office-overdraw",
    itemId: "Changed Product",
    category: "Chaser",
    type: "office_transfer_created",
    quantityChange: 2,
    timestamp: new Date("2026-08-02T10:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];
assert.equal(
  findNewOrWorsenedNegativeBalanceReplayEntry(
    newOverdrawnTransfer,
    [],
    new Set(["changed product::chaser"])
  )?.tx.id,
  "new-office-overdraw"
);

const missingOpeningBalanceTransactions: Transaction[] = [
  {
    id: "first-transaction",
    itemId: "Old Item",
    category: "Demo",
    type: "office_transfer_created",
    quantityChange: 5,
    timestamp: new Date("2025-01-04T10:00:00Z"),
    businessDate: new Date("2025-01-04T00:00:00Z"),
    previousHTBalance: 4,
    previousFABalance: 9,
    previousOFBalance: 2,
    newHTBalance: 4,
    newFABalance: 4,
    newOFBalance: 7,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "second-transaction",
    itemId: "Old Item",
    category: "Demo",
    type: "sales",
    quantityChange: 2,
    timestamp: new Date("2025-01-05T10:00:00Z"),
    businessDate: new Date("2025-01-05T00:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];

const replayStartingFromEarliestAuditSnapshot = replayBalanceHistory(missingOpeningBalanceTransactions);
assert.equal(replayStartingFromEarliestAuditSnapshot.length, 2);
assert.deepEqual(replayStartingFromEarliestAuditSnapshot[0].before, { ht: 4, fa: 9, of: 2 });
assert.deepEqual(replayStartingFromEarliestAuditSnapshot[0].after, { ht: 4, fa: 4, of: 7 });
assert.deepEqual(replayStartingFromEarliestAuditSnapshot[1].before, { ht: 4, fa: 4, of: 7 });
assert.deepEqual(replayStartingFromEarliestAuditSnapshot[1].after, { ht: 4, fa: 4, of: 5 });

const itemWithoutAnyAuditBaseline: Transaction[] = [
  {
    id: "no-baseline-sales",
    itemId: "Never Audited",
    category: "Demo",
    type: "sales",
    quantityChange: 3,
    timestamp: new Date("2025-02-01T10:00:00Z"),
    businessDate: new Date("2025-02-01T00:00:00Z"),
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];

assert.equal(hasReplayStartingBaseline(itemWithoutAnyAuditBaseline, "Never Audited", "Demo"), false);
assert.equal(hasReplayStartingBaseline(missingOpeningBalanceTransactions, "Old Item", "Demo"), true);

const acceptedStoredBalanceTransactions: Transaction[] = [
  {
    id: "old-history-before-acceptance",
    itemId: "Verified Item",
    category: "Demo",
    type: "sales",
    quantityChange: 4,
    timestamp: new Date("2025-03-01T10:00:00Z"),
    previousBalance: 20,
    balance: 16,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
  {
    id: "verified-stored-balance",
    itemId: "Verified Item",
    category: "Demo",
    type: "balance_baseline_accepted",
    quantityChange: 0,
    timestamp: new Date("2025-03-02T10:00:00Z"),
    previousBalance: 25,
    balance: 25,
    previousHTBalance: 5,
    previousFABalance: 8,
    previousOFBalance: 12,
    newHTBalance: 5,
    newFABalance: 8,
    newOFBalance: 12,
    user: { id: "demo", name: "Demo" },
  } as Transaction,
];

const acceptedStoredBalanceRows = replayBalanceHistory(acceptedStoredBalanceTransactions);
assert.deepEqual(acceptedStoredBalanceRows.at(-1)?.before, { ht: 0, fa: 0, of: 16 });
assert.deepEqual(acceptedStoredBalanceRows.at(-1)?.after, { ht: 5, fa: 8, of: 12 });

console.log("advanced history replay checks passed");
