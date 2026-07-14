// Local-time day/segment grouping for the diary (TZ 7.4: "лента (по дням...
// группировка по дню, сегменты по времени)" and "календарь"). Deliberately
// local Date methods, not a date library - the grouping logic here is
// small enough not to need one.

// Genitive - correct for "8 <месяца> 2026" day headings.
const MONTH_NAMES = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

// Nominative - correct for a standalone calendar heading ("Июль 2026",
// not the grammatically wrong genitive "Июля 2026").
const MONTH_NAMES_NOMINATIVE = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function dayKey(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDayHeading(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const todayKey = dayKey(today.toISOString());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKey(yesterday.toISOString());

  if (key === todayKey) return "Сегодня";
  if (key === yesterdayKey) return "Вчера";
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

const TIME_SEGMENTS = [
  { label: "Ночь", from: 0, to: 6 },
  { label: "Утро", from: 6, to: 12 },
  { label: "День", from: 12, to: 18 },
  { label: "Вечер", from: 18, to: 24 },
];

export function segmentFor(isoString) {
  const hour = new Date(isoString).getHours();
  return TIME_SEGMENTS.find((s) => hour >= s.from && hour < s.to)?.label || "";
}

export function groupByDay(records) {
  const groups = new Map();
  for (const record of records) {
    const key = dayKey(record.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
}

export function groupBySegment(records) {
  const groups = new Map(TIME_SEGMENTS.map((s) => [s.label, []]));
  for (const record of records) {
    groups.get(segmentFor(record.created_at)).push(record);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 0);
}

// Calendar month grid - array of {date: Date|null, key: string|null} cells,
// Monday-first, padded to full weeks so the grid stays rectangular.
export function monthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlank = (firstDay.getDay() + 6) % 7; // Mon=0..Sun=6

  const cells = [];
  for (let i = 0; i < leadingBlank; i++) cells.push({ date: null, key: null });
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    cells.push({ date, key: dayKey(date.toISOString()) });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, key: null });
  return cells;
}

export function monthLabel(year, month) {
  return `${MONTH_NAMES_NOMINATIVE[month]} ${year}`;
}

export const WEEKDAY_LABELS = WEEKDAY_SHORT;
