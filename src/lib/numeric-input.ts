export function normalizeWholeNumberInput(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

export function formatWholeNumberInput(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "";

  const normalized = normalizeWholeNumberInput(String(value));
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function parseWholeNumberInput(value: string): number | null {
  const normalized = normalizeWholeNumberInput(value);
  return normalized === "" ? null : Number(normalized);
}
