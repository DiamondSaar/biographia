import React, { useMemo, useState } from "react";
import RecordCard from "./RecordCard.jsx";
import { dayKey, formatDayHeading, monthGrid, monthLabel, WEEKDAY_LABELS } from "../utils/dates.js";

// TZ 7.4: "календарь (месяц; дни с записями подсвечены, пустые —
// нейтральны... клик по дню → записи этого дня)" + optional "насыщенность
// цвета дня по количеству записей" (implemented - intensity scales with
// count relative to the month's busiest day).
export default function DiaryCalendar({ records }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const countsByDay = useMemo(() => {
    const counts = new Map();
    for (const record of records) {
      const key = dayKey(record.created_at);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [records]);

  const cells = monthGrid(year, month);
  const maxCount = Math.max(1, ...countsByDay.values());

  const selectedRecords = selectedDay
    ? records.filter((r) => dayKey(r.created_at) === selectedDay)
    : [];

  const changeMonth = (delta) => {
    setCursor(new Date(year, month + delta, 1));
    setSelectedDay(null);
  };

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeMonth(-1)}>
            ← Пред.
          </button>
          <strong>{monthLabel(year, month)}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => changeMonth(1)}>
            След. →
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-muted text-sm text-center">
              {w}
            </div>
          ))}
          {cells.map((cell, i) => {
            if (!cell.key) return <div key={`blank-${i}`} />;
            const count = countsByDay.get(cell.key) || 0;
            const intensity = count === 0 ? 0 : 0.18 + 0.55 * Math.min(1, count / maxCount);
            const isSelected = cell.key === selectedDay;
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => count > 0 && setSelectedDay(cell.key)}
                disabled={count === 0}
                title={count > 0 ? `${count} запис${count === 1 ? "ь" : "и"}` : undefined}
                style={{
                  aspectRatio: "1",
                  borderRadius: 6,
                  border: isSelected ? "2px solid var(--accent)" : "1px solid var(--border)",
                  background: count > 0 ? `rgba(59,130,246,${intensity})` : "transparent",
                  cursor: count > 0 ? "pointer" : "default",
                  fontSize: 12,
                  color: "var(--text)",
                }}
              >
                {cell.date.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <div>
          <h2 style={{ fontSize: 16, margin: "16px 0 10px" }}>{formatDayHeading(selectedDay)}</h2>
          {selectedRecords.map((r) => (
            <RecordCard key={r.id} record={r} />
          ))}
        </div>
      )}
    </div>
  );
}
