type HeatTreatmentTransaction = {
  type: string;
  processId?: string;
  itemId: string;
  category: string;
};

export interface HeatTreatmentRebuildScope {
  processIds: Set<string>;
  itemKeys: Set<string>;
}

const normalizeItemKeyPart = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

const toItemKey = (itemName: string, category: string) =>
  `${normalizeItemKeyPart(itemName)}::${normalizeItemKeyPart(category)}`;

export const getHeatTreatmentRebuildScope = (
  transactions: HeatTreatmentTransaction[],
  affectedItemKeys?: Set<string>
): HeatTreatmentRebuildScope => {
  const heatTreatmentTransactions = transactions.filter(
    (tx) => tx.type === "heat_treatment_created" && tx.processId
  );
  const shouldRebuildAll = !affectedItemKeys || affectedItemKeys.size === 0;
  const processIds = new Set<string>();
  const itemKeys = new Set(shouldRebuildAll ? [] : affectedItemKeys);

  for (const tx of heatTreatmentTransactions) {
    if (shouldRebuildAll || itemKeys.has(toItemKey(tx.itemId, tx.category))) {
      processIds.add(tx.processId!);
    }
  }

  for (const tx of heatTreatmentTransactions) {
    if (processIds.has(tx.processId!)) {
      itemKeys.add(toItemKey(tx.itemId, tx.category));
    }
  }

  return { processIds, itemKeys };
};