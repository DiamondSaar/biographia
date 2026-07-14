import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import AttachmentList from "./AttachmentList.jsx";
import UserPicker from "./UserPicker.jsx";
import { usePersonalKey } from "../crypto/PersonalKeyContext.jsx";
import { decryptText } from "../crypto/masterKey.ts";
import { useViewer } from "../ViewerContext.jsx";

export const RECORD_TYPE_LABELS = {
  installation: "Установка",
  documents: "Документы",
  maintenance: "Обслуживание",
  component_replacement: "Замена компонента",
  relocation: "Перемещение",
  incident: "Инцидент",
  note: "Свободная заметка",
};

export const ZONE_LABELS = { open: "Открытая", org: "Юрлицо", personal: "Личная" };
export const ACCESS_CLASSES = ["G", "F", "E", "D", "C", "B", "A", "S"];

// Personal-zone records store only ciphertext (see app/models/biography.py's
// encrypted_content) - decryption happens here, client-side, using the
// subkey from PersonalKeyContext. Never sent anywhere, never cached
// outside this component's render.
function usePersonalContent(record) {
  const { status, subkey } = usePersonalKey();
  const [content, setContent] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (record.zone !== "personal") return;
    if (status !== "unlocked" || !subkey || !record.encrypted_content) return;
    try {
      const json = decryptText(subkey, record.encrypted_content, record.nonce);
      setContent(JSON.parse(json));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.encrypted_content, status]);

  return { content, failed, locked: record.zone === "personal" && status !== "unlocked" };
}

// Title/body only (zone/entity/attachment binding aren't editable here -
// editing an existing record is a content change, not a re-creation).
// access_level is offered only when canEdit (server enforces the same
// gate + the owner-rank ceiling regardless, this just avoids showing a
// control that would just 400 for a proposer).
function EditRecordForm({ record, canEdit, onDone, onCancel }) {
  const [title, setTitle] = useState(record.title || "");
  const [body, setBody] = useState(record.body || "");
  const [accessLevel, setAccessLevel] = useState(record.access_level || "G");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = { title, body };
      if (canEdit && record.zone !== "personal") payload.access_level = accessLevel;
      const result = await api.editRecord(record.id, payload);
      onDone(result, result.pending);
    } catch (err) {
      setError((err.data && err.data.error) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      {error && <div className="alert alert-error">{error}</div>}
      {!canEdit && (
        <div className="alert alert-warn">
          Вы не владелец этой записи — правка уйдёт на согласование и не применится сразу.
        </div>
      )}
      <div className="field">
        <label>Заголовок</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Текст</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {canEdit && record.zone !== "personal" && (
        <div className="field">
          <label>Уровень доступа</label>
          <select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)}>
            {ACCESS_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Сохраняем..." : canEdit ? "Сохранить" : "Отправить на согласование"}
        </button>
      </div>
    </form>
  );
}

function VersionHistory({ recordId }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .recordDetail(recordId)
      .then((data) => setVersions((data.versions || []).filter((v) => v.status === "applied")))
      .catch((err) => setError(err.message));
  }, [recordId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (versions === null) return <div className="empty-state small">Загрузка...</div>;
  if (versions.length <= 1) return <p className="text-sm text-muted">Других версий пока нет.</p>;

  return (
    <ul style={{ marginTop: 8 }}>
      {[...versions].reverse().map((v) => (
        <li key={v.version_number} style={{ marginBottom: 8 }}>
          <div className="text-sm text-muted">
            v{v.version_number} · {v.author_username} · {new Date(v.created_at).toLocaleString("ru-RU")}
          </div>
          <div>{v.title}</div>
          <div className="text-sm">{v.body}</div>
        </li>
      ))}
    </ul>
  );
}

function ProposalQueue({ recordId, onResolved }) {
  const [proposals, setProposals] = useState(null);
  const [error, setError] = useState(null);
  const [busyVersion, setBusyVersion] = useState(null);

  const load = () => {
    api
      .recordProposals(recordId)
      .then((data) => setProposals(data.results || []))
      .catch((err) => setError(err.message));
  };

  useEffect(load, [recordId]);

  const act = async (versionNumber, action) => {
    setBusyVersion(versionNumber);
    setError(null);
    try {
      const result = action === "approve" ? await api.approveProposal(recordId, versionNumber) : await api.rejectProposal(recordId, versionNumber);
      load();
      if (action === "approve") onResolved(result);
    } catch (err) {
      setError((err.data && err.data.error) || err.message);
    } finally {
      setBusyVersion(null);
    }
  };

  if (error) return <div className="alert alert-error">{error}</div>;
  if (proposals === null) return <div className="empty-state small">Загрузка...</div>;
  if (proposals.length === 0) return <p className="text-sm text-muted">Предложенных изменений нет.</p>;

  return (
    <ul style={{ marginTop: 8 }}>
      {proposals.map((p) => (
        <li key={p.version_number} style={{ marginBottom: 10 }}>
          <div className="text-sm text-muted">
            {p.author_username} предлагает · {new Date(p.created_at).toLocaleString("ru-RU")}
          </div>
          <div>{p.title}</div>
          <div className="text-sm">{p.body}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyVersion === p.version_number}
              onClick={() => act(p.version_number, "approve")}
            >
              Принять
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busyVersion === p.version_number}
              onClick={() => act(p.version_number, "reject")}
            >
              Отклонить
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function RecordCard({ record: initialRecord, showEntityLink = true }) {
  const [record, setRecord] = useState(initialRecord);
  const { content, failed, locked } = usePersonalContent(record);
  const viewer = useViewer();
  const [showEdit, setShowEdit] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showProposals, setShowProposals] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => setRecord(initialRecord), [initialRecord]);

  const title = record.zone === "personal" ? content?.title : record.title;
  const body = record.zone === "personal" ? content?.body : record.body;
  // Matches app/records/routes.py::can_edit_record exactly - direct edit/
  // reassign/hide rights follow ownership, not authorship.
  const canEdit = viewer && (viewer.role === "superadmin" || viewer.username === record.owner_username);

  const reassignTo = async (user) => {
    setActionError(null);
    try {
      const updated = await api.reassignOwner(record.id, user.username);
      setRecord(updated);
      setShowReassign(false);
    } catch (err) {
      setActionError((err.data && err.data.error) || err.message);
    }
  };

  const toggleHide = async () => {
    setActionError(null);
    try {
      const updated = record.status === "hidden" ? await api.unhideRecord(record.id) : await api.hideRecord(record.id);
      setRecord(updated);
    } catch (err) {
      setActionError((err.data && err.data.error) || err.message);
    }
  };

  return (
    <div className={`card${record.access_level ? ` access-panel access-border-${record.access_level}` : ""}`}>
      {record.access_level && (
        <span className={`access-badge access-${record.access_level} field-corner-badge`}>{record.access_level}</span>
      )}
      <div className="card-header">
        <h2>{locked ? "🔒 Личная запись" : title || "(без заголовка)"}</h2>
        <span className="dept-badge">{ZONE_LABELS[record.zone]}</span>
        {record.status === "hidden" && <span className="count-badge">Скрыта</span>}
      </div>
      {locked && (
        <p className="text-muted">
          Разблокируйте <Link to="/diary">личный дневник</Link>, чтобы увидеть содержимое.
        </p>
      )}
      {!locked && failed && <div className="alert alert-error">Не удалось расшифровать запись.</div>}
      {!locked && !failed && !showEdit && body && <p>{body}</p>}
      {showEntityLink && record.entity_id != null && (
        <p className="text-sm text-muted">
          Привязано к:{" "}
          <Link to={`/entity/${record.entity_kind}/${record.entity_id}`}>
            {record.entity_kind === "organization" ? "юрлицу" : "объекту"} #{record.entity_id}
          </Link>
        </p>
      )}
      <div className="detail-list compact" style={{ marginTop: 12 }}>
        <dt>Автор</dt>
        <dd>{record.author_display_name || record.author_username}</dd>
        <dt>Ответственный</dt>
        <dd>
          {record.owner_display_name || record.owner_username}
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setShowReassign((v) => !v)}>
              Переназначить
            </button>
          )}
        </dd>
        <dt>Тип</dt>
        <dd>{RECORD_TYPE_LABELS[record.record_type] || record.record_type}</dd>
        <dt>Создано</dt>
        <dd>{new Date(record.created_at).toLocaleString("ru-RU")}</dd>
      </div>
      {actionError && <div className="alert alert-error">{actionError}</div>}
      {showReassign && <UserPicker onPick={reassignTo} onCancel={() => setShowReassign(false)} />}

      {!locked && !showEdit && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)}>
            Редактировать
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowVersions((v) => !v)}>
            {showVersions ? "Скрыть версии" : "Предыдущие версии"}
          </button>
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowProposals((v) => !v)}>
              {showProposals ? "Скрыть предложения" : `Предложенные изменения${record.pending_count ? ` (${record.pending_count})` : ""}`}
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleHide}>
              {record.status === "hidden" ? "Вернуть" : "Скрыть"}
            </button>
          )}
        </div>
      )}

      {showEdit && (
        <EditRecordForm
          record={record}
          canEdit={canEdit}
          onCancel={() => setShowEdit(false)}
          onDone={(result, pending) => {
            setShowEdit(false);
            if (!pending) setRecord(result);
          }}
        />
      )}
      {showVersions && <VersionHistory recordId={record.id} />}
      {showProposals && canEdit && <ProposalQueue recordId={record.id} onResolved={setRecord} />}

      {!locked && <AttachmentList record={record} canUpload={canEdit} />}
    </div>
  );
}
