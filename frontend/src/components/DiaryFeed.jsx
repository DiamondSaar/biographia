import React from "react";
import RecordCard from "./RecordCard.jsx";
import { formatDayHeading, groupByDay, groupBySegment } from "../utils/dates.js";

// TZ 7.4: "лента (по дням, по убыванию; группировка по дню, сегменты по
// времени)".
export default function DiaryFeed({ records }) {
  const days = groupByDay(records);

  if (days.length === 0) {
    return <div className="empty-state">Пока нет ни одной личной записи.</div>;
  }

  return (
    <div>
      {days.map(([key, dayRecords]) => (
        <div key={key} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>{formatDayHeading(key)}</h2>
          {groupBySegment(dayRecords).map(([segment, segmentRecords]) => (
            <div key={segment} style={{ marginBottom: 10 }}>
              <div className="text-muted text-sm" style={{ marginBottom: 6 }}>
                {segment}
              </div>
              {segmentRecords.map((r) => (
                <RecordCard key={r.id} record={r} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
