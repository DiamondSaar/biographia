import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import AddRecordForm from "../components/AddRecordForm.jsx";
import { AuthorPicker, EquipmentPicker } from "../components/DominexPickers.jsx";
import DiaryCalendar from "../components/DiaryCalendar.jsx";
import RecordCard, { RECORD_TYPE_LABELS } from "../components/RecordCard.jsx";

const WIKI_LIMIT = 50;

// По запросу пользователя: после подключения истории взаимодействий как
// источника записей (и вообще по мере роста базы) плоская лента
// перестаёт быть эффективной - нужен поиск/фильтр (по тексту, категории,
// оборудованию, автору) и альтернативный вид "Календарь" (тот же
// компонент, что уже есть в Личном дневнике - см. DiaryCalendar.jsx,
// он не завязан на personal-зону, принимает любой массив записей).
export default function WikiHome() {
  const [records, setRecords] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("feed"); // "feed" | "calendar"
  const [showFilters, setShowFilters] = useState(false);

  const [q, setQ] = useState("");
  const [recordType, setRecordType] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState(null);
  const [authorFilter, setAuthorFilter] = useState(null);

  const hasActiveFilters = Boolean(q || recordType || equipmentFilter || authorFilter);

  const load = () => {
    api
      .recentRecords(WIKI_LIMIT, {
        q,
        recordType,
        entityId: equipmentFilter?.id,
        author: authorFilter?.username,
      })
      .then((data) => setRecords(data.results || []))
      .catch((err) => setError(err.message));
  };

  // Дебаунс на весь набор фильтров разом - пикер оборудования/автора
  // выбирается одним кликом (задержка в 300 мс незаметна), а текстовый
  // поиск как раз и рассчитан на дебаунс по мере набора - один и тот же
  // эффект решает обе задачи, не нужно два отдельных пути перезагрузки.
  useEffect(() => {
    const handle = setTimeout(load, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, recordType, equipmentFilter, authorFilter]);

  const clearFilters = () => {
    setQ("");
    setRecordType("");
    setEquipmentFilter(null);
    setAuthorFilter(null);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Вики</h1>
        <div className="two-col" style={{ gap: 6 }}>
          <button
            type="button"
            className={mode === "feed" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            onClick={() => setMode("feed")}
          >
            Лента
          </button>
          <button
            type="button"
            className={mode === "calendar" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            onClick={() => setMode("calendar")}
          >
            Календарь
          </button>
          <button
            type="button"
            className={`btn btn-primary${showForm ? "" : " fab"}`}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Закрыть форму" : "Добавить запись"}
          </button>
        </div>
      </div>

      {showForm && (
        <AddRecordForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Поиск по тексту записи..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: "1 1 240px" }}
          />
          <select value={recordType} onChange={(e) => setRecordType(e.target.value)} style={{ flex: "0 0 auto" }}>
            <option value="">Все категории</option>
            {Object.entries(RECORD_TYPE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowFilters((v) => !v)}>
            {showFilters ? "Скрыть фильтры" : "Ещё фильтры"}
          </button>
          {hasActiveFilters && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              Сбросить
            </button>
          )}
        </div>

        {showFilters && (
          <div className="two-col" style={{ marginTop: 10 }}>
            <EquipmentPicker value={equipmentFilter} onChange={setEquipmentFilter} label="Оборудование" />
            <AuthorPicker value={authorFilter} onChange={setAuthorFilter} />
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {records === null && <div className="empty-state">Загрузка...</div>}

      {records && mode === "feed" && records.length === 0 && (
        <div className="empty-state">
          {hasActiveFilters ? "Ничего не найдено по этим условиям." : "Пока нет ни одной записи."}
        </div>
      )}
      {records && mode === "feed" && records.length > 0 && records.map((r) => <RecordCard key={r.id} record={r} />)}

      {records && mode === "calendar" && records.length === 0 && (
        <div className="empty-state">
          {hasActiveFilters ? "Ничего не найдено по этим условиям." : "Пока нет ни одной записи."}
        </div>
      )}
      {records && mode === "calendar" && records.length > 0 && <DiaryCalendar records={records} />}
    </div>
  );
}
