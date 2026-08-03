import React, { useMemo, useState } from "react";
import RecordCard from "./RecordCard.jsx";
import { dayKey, formatDayHeading, monthGrid, monthLabel, WEEKDAY_LABELS } from "../utils/dates.js";

// Photo/video get their own bucket (most common, most worth spotting at a
// glance); everything else (PDFs, docs, archives, ...) shares one "прочее"
// bucket - see the "4 квадрата" spec, only 4 colors were asked for, not a
// bucket per MIME family.
function classifyAttachment(attachment) {
  const type = (attachment.content_type || "").toLowerCase();
  if (type.startsWith("image/")) return "photo";
  if (type.startsWith("video/")) return "video";
  return "other";
}

const STAT_DEFS = [
  { key: "records", label: "Записи", className: "stat-records" },
  { key: "photo", label: "Фото", className: "stat-photo" },
  { key: "video", label: "Видео", className: "stat-video" },
  { key: "other", label: "Прочие файлы (документы, архивы)", className: "stat-other" },
];

// TZ 7.4: "календарь (месяц; дни с записями подсвечены, пустые —
// нейтральны... клик по дню → записи этого дня)" - each cell also breaks
// down what's in it (записи/фото/видео/прочее) instead of just an
// intensity tint, while staying compact enough for a full month to fit
// without scrolling.
export default function DiaryCalendar({ records }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const statsByDay = useMemo(() => {
    const stats = new Map();
    for (const record of records) {
      const key = dayKey(record.created_at);
      if (!stats.has(key)) stats.set(key, { records: 0, photo: 0, video: 0, other: 0 });
      const entry = stats.get(key);
      entry.records += 1;
      for (const attachment of record.attachments || []) {
        entry[classifyAttachment(attachment)] += 1;
      }
    }
    return stats;
  }, [records]);

  const cells = monthGrid(year, month);
  const todayKey = dayKey(new Date().toISOString());

  const selectedRecords = selectedDay ? records.filter((r) => dayKey(r.created_at) === selectedDay) : [];

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

        <div className="diary-month-grid">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-muted text-sm text-center">
              {w}
            </div>
          ))}
          {cells.map((cell, i) => {
            if (!cell.key) return <div key={`blank-${i}`} />;
            const stats = statsByDay.get(cell.key);
            const hasRecords = !!stats && stats.records > 0;
            const isSelected = cell.key === selectedDay;
            const isToday = cell.key === todayKey;
            return (
              <button
                key={cell.key}
                type="button"
                className={`diary-cell${hasRecords ? " diary-cell-active" : ""}${isSelected ? " diary-cell-selected" : ""}${isToday ? " diary-cell-today" : ""}`}
                onClick={() => hasRecords && setSelectedDay(cell.key)}
                disabled={!hasRecords}
              >
                <span className="diary-cell-date">{cell.date.getDate()}</span>
                {hasRecords && (
                  <span className="diary-cell-stats">
                    {STAT_DEFS.map((def) => {
                      const count = stats[def.key];
                      return (
                        <span
                          key={def.key}
                          className={`diary-stat-sq ${def.className}${count === 0 ? " diary-stat-sq-empty" : ""}`}
                          title={`${def.label}: ${count}`}
                        >
                          {count > 0 ? count : ""}
                        </span>
                      );
                    })}
                  </span>
                )}
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
