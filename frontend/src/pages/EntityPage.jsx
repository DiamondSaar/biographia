import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import AddRecordForm from "../components/AddRecordForm.jsx";
import RecordCard from "../components/RecordCard.jsx";

export default function EntityPage() {
  const { kind, id } = useParams();
  const [entity, setEntity] = useState(null);
  const [records, setRecords] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  const loadFeed = () => {
    api
      .entityFeed(kind, id)
      .then((data) => setRecords(data.results || []))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    setEntity(null);
    setRecords(null);
    setError(null);
    api.entityCard(kind, id).then(setEntity).catch((err) => setError(err.message));
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  return (
    <div>
      <Link to="/" className="back-link">
        ← Вики
      </Link>

      {entity && (
        <div className="page-header">
          <h1>{entity.display_name}</h1>
        </div>
      )}

      {entity && (
        <div className="card">
          <div className="detail-list">
            <dt>Тип</dt>
            <dd>{kind === "organization" ? "Юрлицо" : entity.template_name}</dd>
            <dt>Класс доступа</dt>
            <dd>{entity.access_class}</dd>
            {kind === "entity" && entity.parent && (
              <>
                <dt>Родитель</dt>
                <dd>
                  <Link to={`/entity/entity/${entity.parent.id}`}>{entity.parent.display_name}</Link>
                </dd>
              </>
            )}
            {kind === "entity" && entity.children && entity.children.length > 0 && (
              <>
                <dt>Составные элементы</dt>
                <dd>
                  {entity.children.map((c) => (
                    <div key={c.id}>
                      <Link to={`/entity/entity/${c.id}`}>{c.display_name}</Link>
                    </div>
                  ))}
                </dd>
              </>
            )}
          </div>
        </div>
      )}

      <div className="page-header">
        <h2 style={{ fontSize: 16 }}>Лента биографии</h2>
        <button
          type="button"
          className={`btn btn-primary btn-sm${showForm ? "" : " fab"}`}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Закрыть форму" : "Прикрепить запись"}
        </button>
      </div>

      {showForm && entity && (
        <AddRecordForm
          fixedEntity={{ kind, id: Number(id), display_name: entity.display_name }}
          onCreated={() => {
            setShowForm(false);
            loadFeed();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {records === null && <div className="empty-state">Загрузка...</div>}
      {records && records.length === 0 && <div className="empty-state">Для этого объекта пока нет записей.</div>}
      {records && records.map((r) => <RecordCard key={r.id} record={r} showEntityLink={false} />)}
    </div>
  );
}
