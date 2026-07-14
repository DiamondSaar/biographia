import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import RecordCard from "../components/RecordCard.jsx";

const ROLE_LABELS = { superadmin: "Суперадмин", admin: "Администратор", user: "Пользователь" };

function Section({ title, records, emptyText }) {
  return (
    <div>
      <h2 style={{ fontSize: 16, margin: "20px 0 12px" }}>{title}</h2>
      {records.length === 0 && <div className="empty-state small">{emptyText}</div>}
      {records.map((r) => (
        <RecordCard key={r.id} record={r} />
      ))}
    </div>
  );
}

export default function AuthorProfile() {
  const [profile, setProfile] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [orgNames, setOrgNames] = useState({});

  useEffect(() => {
    api.profile().then(setProfile).catch((err) => setError(err.message));
    api
      .myRecords()
      .then((data) => setRecords(data.results || []))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!records) return;
    const uniqueOrgIds = [...new Set(records.filter((r) => r.zone === "org" && r.org_id != null).map((r) => r.org_id))];
    uniqueOrgIds
      .filter((id) => !(id in orgNames))
      .forEach((id) => {
        api
          .entityCard("organization", id)
          .then((org) => setOrgNames((prev) => ({ ...prev, [id]: org.display_name })))
          .catch(() => setOrgNames((prev) => ({ ...prev, [id]: null })));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  const general = (records || []).filter((r) => r.zone === "open");
  const byOrg = (records || []).filter((r) => r.zone === "org");
  const personal = (records || []).filter((r) => r.zone === "personal");

  // Group org-zone records by org_id, sorted by org_id (TZ 7.3: "по
  // организациям (с сортировкой)"); org names resolved separately below
  // via /entities/organization/<id> (record payload only carries org_id).
  const byOrgGrouped = Object.entries(
    byOrg.reduce((acc, r) => {
      const key = r.org_id ?? "—";
      (acc[key] = acc[key] || []).push(r);
      return acc;
    }, {}),
  ).sort(([a], [b]) => String(a).localeCompare(String(b)));

  return (
    <div>
      <div className="page-header">
        <h1>Личный кабинет</h1>
        <Link to="/diary" className="btn btn-secondary">
          Личный дневник
        </Link>
      </div>

      {profile && (
        <div className="card">
          <div className="card-header">
            <div className="user-avatar">{(profile.display_name || profile.username)[0].toUpperCase()}</div>
            <h2>{profile.display_name}</h2>
          </div>
          <div className="detail-list">
            <dt>Логин</dt>
            <dd>{profile.username}</dd>
            <dt>Должность</dt>
            <dd>{profile.position || "—"}</dd>
            <dt>Организация</dt>
            <dd>{profile.organization ? profile.organization.name : "—"}</dd>
            <dt>Роль</dt>
            <dd>{ROLE_LABELS[profile.role] || profile.role}</dd>
            <dt>Класс доступа</dt>
            <dd>{profile.access_class}</dd>
          </div>
        </div>
      )}

      {records === null && <div className="empty-state">Загрузка записей...</div>}

      {records && (
        <>
          <Section title="Общие" records={general} emptyText="Нет открытых записей." />

          <h2 style={{ fontSize: 16, margin: "20px 0 12px" }}>По организациям</h2>
          {byOrgGrouped.length === 0 && <div className="empty-state small">Нет записей по юрлицам.</div>}
          {byOrgGrouped.map(([orgId, orgRecords]) => (
            <div key={orgId} style={{ marginBottom: 16 }}>
              <div className="dept-badge" style={{ marginBottom: 8 }}>
                {orgNames[orgId] || `Юрлицо #${orgId}`}
              </div>
              {orgRecords.map((r) => (
                <RecordCard key={r.id} record={r} />
              ))}
            </div>
          ))}

          <Section title="Личные" records={personal} emptyText="Нет личных записей." />
        </>
      )}
    </div>
  );
}
