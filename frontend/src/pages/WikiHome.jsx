import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import AddRecordForm from "../components/AddRecordForm.jsx";
import RecordCard from "../components/RecordCard.jsx";

export default function WikiHome() {
  const [records, setRecords] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    api
      .recentRecords(10)
      .then((data) => setRecords(data.results || []))
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  return (
    <div>
      <div className="page-header">
        <h1>Вики</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Закрыть форму" : "Добавить запись"}
        </button>
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

      {error && <div className="alert alert-error">{error}</div>}

      {records === null && <div className="empty-state">Загрузка...</div>}
      {records && records.length === 0 && <div className="empty-state">Пока нет ни одной записи.</div>}
      {records && records.map((r) => <RecordCard key={r.id} record={r} />)}
    </div>
  );
}
