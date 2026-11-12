import assert from "node:assert/strict";
import { getHeatTreatmentRebuildScope } from "../client/src/lib/heat-treatment-rebuild-scope";

const transactions = [
  {
    type: "heat_treatment_created",
    processId: "process-1",
    itemId: "52 LH",
    category: "CUTTER M15",
  },
  {
    type: "heat_treatment_created",
    processId: "process-1",
    itemId: "58 LH",
    category: "CUTTER M15",
  },
  {
    type: "heat_treatment_created",
    processId: "unrelated-process",
    itemId: "8 V 3/8",
    category: "CHASER",
  },
];

const scope = getHeatTreatmentRebuildScope(
  transactions,
  new Set(["52 lh::cutter m15"])
);

assert.deepEqual(Array.from(scope.processIds), ["process-1"]);
assert.deepEqual(
  Array.from(scope.itemKeys).sort(),
  ["52 lh::cutter m15", "58 lh::cutter m15"]
);

console.log("heat-treatment rebuild scope checks passed");