export type ChartUnit = "MINUTE" | "DAY" | "WEEK" | "MONTH" | "YEAR";

export type ChartSeriesBar = Readonly<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

export const CHART_UNIT_LABELS: Record<ChartUnit, string> = {
  MINUTE: "분",
  DAY: "일",
  WEEK: "주",
  MONTH: "월",
  YEAR: "년",
};

export const CHART_UNIT_ACCESSIBLE_LABELS: Record<ChartUnit, string> = {
  MINUTE: "분 단위 차트",
  DAY: "일 단위 차트",
  WEEK: "주 단위 차트",
  MONTH: "월 단위 차트",
  YEAR: "년 단위 차트",
};

const ZOOM_RATIOS = [1, 0.6, 0.35, 0.2] as const;

type CalendarParts = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

function calendarParts(timestamp: number, timeZone: string | null): CalendarParts {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  if (timeZone) options.timeZone = timeZone;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(
      new Date(timestamp * 1_000),
    );
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: "Asia/Seoul",
    }).formatToParts(new Date(timestamp * 1_000));
  }

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function isoWeekKey(parts: CalendarParts): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function groupKey(
  timestamp: number,
  unit: Exclude<ChartUnit, "MINUTE" | "DAY">,
  timeZone: string | null,
): string {
  const parts = calendarParts(timestamp, timeZone);
  if (unit === "WEEK") return isoWeekKey(parts);
  if (unit === "MONTH") {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  }
  return String(parts.year);
}

export function aggregateChartBars(
  sourceBars: readonly ChartSeriesBar[],
  unit: Exclude<ChartUnit, "MINUTE" | "DAY">,
  timeZone: string | null,
): ChartSeriesBar[] {
  const bars = [...sourceBars].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const groups = new Map<string, ChartSeriesBar[]>();

  for (const bar of bars) {
    const key = groupKey(bar.timestamp, unit, timeZone);
    const group = groups.get(key) ?? [];
    group.push(bar);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) throw new Error("EMPTY_CHART_GROUP");
    return {
      timestamp: first.timestamp,
      open: first.open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: last.close,
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
    };
  });
}

export function zoomChartBars<T extends ChartSeriesBar>(
  sourceBars: readonly T[],
  zoomLevel: number,
): T[] {
  if (sourceBars.length <= 2) return [...sourceBars];
  const safeLevel = Math.max(0, Math.min(ZOOM_RATIOS.length - 1, zoomLevel));
  const targetCount = Math.max(
    2,
    Math.ceil(sourceBars.length * ZOOM_RATIOS[safeLevel]),
  );
  return sourceBars.slice(-targetCount);
}

export const MAX_CHART_ZOOM_LEVEL = ZOOM_RATIOS.length - 1;
