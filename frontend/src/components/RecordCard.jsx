import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AttachmentList from "./AttachmentList.jsx";
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

export default function RecordCard({ record, showEntityLink = true }) {
  const { content, failed, locked } = usePersonalContent(record);
  const viewer = useViewer();

  const title = record.zone === "personal" ? content?.title : record.title;
  const body = record.zone === "personal" ? content?.body : record.body;
  const canEdit = viewer && (viewer.role === "superadmin" || viewer.username === record.author_username);

  return (
    <div className="card">
      <div className="card-header">
        <h2>{locked ? "🔒 Личная запись" : title || "(без заголовка)"}</h2>
        <span className="dept-badge">{ZONE_LABELS[record.zone]}</span>
        {record.access_level && <span className="count-badge">{record.access_level}</span>}
      </div>
      {locked && (
        <p className="text-muted">
          Разблокируйте <Link to="/diary">личный дневник</Link>, чтобы увидеть содержимое.
        </p>
      )}
      {!locked && failed && <div className="alert alert-error">Не удалось расшифровать запись.</div>}
      {!locked && !failed && body && <p>{body}</p>}
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
        <dt>Тип</dt>
        <dd>{RECORD_TYPE_LABELS[record.record_type] || record.record_type}</dd>
        <dt>Создано</dt>
        <dd>{new Date(record.created_at).toLocaleString("ru-RU")}</dd>
        {record.version_count > 1 && (
          <>
            <dt>Версий</dt>
            <dd>{record.version_count}</dd>
          </>
        )}
      </div>
      {!locked && <AttachmentList record={record} canUpload={canEdit} />}
    </div>
  );
}
