import type {
  ActionPlanInput,
  CounterfactualDelta,
} from "./contracts";

const MISSING_LEAF = Symbol("MISSING_LEAF");
const MISSING_VALUE_LABEL = "MISSING";

type JsonLeaf = string | number | boolean | null;
type MaybeLeaf = JsonLeaf | typeof MISSING_LEAF;

export type InputLeafChange = {
  fieldPath: string;
  from: string;
  to: string;
};

export type CounterfactualComparison =
  | {
      comparable: true;
      change: InputLeafChange;
      counterfactual: CounterfactualDelta;
    }
  | {
      comparable: false;
      changes: InputLeafChange[];
      reason: "NO_CHANGED_FIELD" | "MULTIPLE_CHANGED_FIELDS";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayLeaf(value: MaybeLeaf): string {
  if (value === MISSING_LEAF) return MISSING_VALUE_LABEL;
  if (value === null) return "null";
  return String(value);
}

function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function arrayPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

function collectMissingLeaves(
  value: unknown,
  path: string,
  missingIsBefore: boolean,
): InputLeafChange[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [
        {
          fieldPath: path,
          from: missingIsBefore ? MISSING_VALUE_LABEL : "[]",
          to: missingIsBefore ? "[]" : MISSING_VALUE_LABEL,
        },
      ];
    }
    return value.flatMap((item, index) =>
      collectMissingLeaves(item, arrayPath(path, index), missingIsBefore),
    );
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      return [
        {
          fieldPath: path,
          from: missingIsBefore ? MISSING_VALUE_LABEL : "{}",
          to: missingIsBefore ? "{}" : MISSING_VALUE_LABEL,
        },
      ];
    }
    return keys.flatMap((key) =>
      collectMissingLeaves(value[key], childPath(path, key), missingIsBefore),
    );
  }

  const leaf = value as JsonLeaf;
  return [
    {
      fieldPath: path,
      from: displayLeaf(missingIsBefore ? MISSING_LEAF : leaf),
      to: displayLeaf(missingIsBefore ? leaf : MISSING_LEAF),
    },
  ];
}

function diffValues(before: unknown, after: unknown, path: string): InputLeafChange[] {
  if (Object.is(before, after)) return [];

  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: InputLeafChange[] = [];
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      const nextPath = arrayPath(path, index);
      if (index >= before.length) {
        changes.push(...collectMissingLeaves(after[index], nextPath, true));
      } else if (index >= after.length) {
        changes.push(...collectMissingLeaves(before[index], nextPath, false));
      } else {
        changes.push(...diffValues(before[index], after[index], nextPath));
      }
    }
    return changes;
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => {
      const nextPath = childPath(path, key);
      if (!(key in before)) {
        return collectMissingLeaves(after[key], nextPath, true);
      }
      if (!(key in after)) {
        return collectMissingLeaves(before[key], nextPath, false);
      }
      return diffValues(before[key], after[key], nextPath);
    });
  }

  return [
    {
      fieldPath: path,
      from: displayLeaf(before as JsonLeaf),
      to: displayLeaf(after as JsonLeaf),
    },
  ];
}

export function diffInputSnapshots(
  baseline: ActionPlanInput,
  comparison: ActionPlanInput,
): InputLeafChange[] {
  return diffValues(baseline, comparison, "");
}

function assumptionLabel(fieldPath: string): string {
  if (fieldPath === "subjectLabel") return "검토 대상";
  if (fieldPath === "intent") return "사용자 의도";
  if (fieldPath === "purpose.kind") return "검토 목적";
  if (fieldPath === "purpose.note") return "목적 설명";
  if (fieldPath === "horizon") return "검토 기간";
  if (fieldPath === "urgency") return "긴급도";
  if (fieldPath.startsWith("constraints")) return "사용자 제약";
  if (fieldPath.startsWith("userEvidence")) return "사용자 근거";
  return fieldPath;
}

function deterministicImpact(change: InputLeafChange): string {
  if (change.fieldPath === "horizon") {
    return `실제 입력 snapshot의 horizon이 ${change.from}에서 ${change.to}(으)로 바뀌어 목적과 기간의 일치 여부를 다시 확인해야 합니다.`;
  }

  return `실제 입력 snapshot의 ${change.fieldPath} 값이 바뀌었으므로 이 전제에 연결된 확인 행동과 결정 게이트를 다시 검토해야 합니다.`;
}

export function deriveCounterfactualFromSnapshots(
  baseline: ActionPlanInput,
  comparison: ActionPlanInput,
): CounterfactualComparison {
  const changes = diffInputSnapshots(baseline, comparison);

  if (changes.length !== 1) {
    return {
      comparable: false,
      changes,
      reason: changes.length === 0 ? "NO_CHANGED_FIELD" : "MULTIPLE_CHANGED_FIELDS",
    };
  }

  const change = changes[0];
  return {
    comparable: true,
    change,
    counterfactual: {
      fieldPath: change.fieldPath,
      changedAssumption: assumptionLabel(change.fieldPath),
      from: change.from,
      to: change.to,
      impact: deterministicImpact(change),
    },
  };
}

export function isExactlyOneFieldDifferent(
  baseline: ActionPlanInput,
  comparison: ActionPlanInput,
): boolean {
  return diffInputSnapshots(baseline, comparison).length === 1;
}
