import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { uploadRecordAttachment } from "../crypto/attachmentUpload.js";
import { usePersonalKey } from "../crypto/PersonalKeyContext.jsx";
import { decryptBytes, decryptFileMeta, unpackEncryptedBlob } from "../crypto/masterKey.ts";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

const OFFICE_CONTENT_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function iconForMimeType(contentType) {
  const type = contentType || "";
  if (type.startsWith("image/")) return "🖼️";
  if (type.startsWith("video/")) return "🎬";
  if (type === "application/pdf") return "📄";
  if (type.startsWith("text/")) return "📝";
  if (OFFICE_CONTENT_TYPES.has(type)) return "📃";
  return "📎";
}

/**
 * Одно вложение. Личная зона (attachment.filename === null - сервер
 * никогда не хранит настоящее имя/тип в открытом виде, см. корневой
 * README бэкенда/TZ раздел 9) требует расшифровки на месте - и метаданных
 * (encrypted_meta/meta_nonce), и, если есть, миниатюры/самого файла по
 * клику. Open/org - как раньше, обычная ссылка, браузер сам умеет
 * показать картинку/видео/PDF по прямому URL (cookie-авторизация,
 * отдельный fetch не нужен).
 */
function AttachmentItem({ attachment, subkey }) {
  const isPersonal = attachment.filename === null;
  const [meta, setMeta] = useState(
    isPersonal ? null : { filename: attachment.filename, content_type: attachment.content_type },
  );
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!isPersonal || !subkey || !attachment.encrypted_meta || !attachment.meta_nonce) return;
    try {
      setMeta(decryptFileMeta(subkey, attachment.encrypted_meta, attachment.meta_nonce));
    } catch {
      setMeta(null);
    }
  }, [isPersonal, subkey, attachment.encrypted_meta, attachment.meta_nonce]);

  useEffect(() => {
    if (!attachment.has_thumbnail) return;
    if (!isPersonal) {
      // Открытая/org-зона: прямой URL, куки уже авторизуют запрос - JS
      // тут вообще не нужен, ровно как для самого файла.
      setThumbnailUrl(`/attachments/${attachment.id}/thumbnail`);
      return;
    }
    if (!subkey) return;
    let cancelled = false;
    let objectUrl = null;
    api
      .attachmentThumbnail(attachment.id)
      .then((blob) => {
        if (cancelled) return;
        const { ciphertext, nonce } = unpackEncryptedBlob(blob);
        const plaintext = decryptBytes(subkey, ciphertext, nonce);
        objectUrl = URL.createObjectURL(new Blob([plaintext], { type: "image/jpeg" }));
        setThumbnailUrl(objectUrl);
      })
      .catch(() => {
        // Битая/недоступная миниатюра - остаёмся на иконке-заглушке.
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, attachment.has_thumbnail, isPersonal, subkey]);

  const contentType = meta?.content_type || "";
  const displayName = meta?.filename || (isPersonal ? "Личный файл" : attachment.filename);

  // Личная зона: сам файл - шифртекст, обычная <a href> не сработает -
  // качаем+расшифровываем по клику и открываем как blob-URL. Ровно тот
  // же принцип, что уже применяется к тексту записи (usePersonalContent
  // в RecordCard.jsx), просто с другим типом содержимого.
  const handleOpenPersonal = async (event) => {
    event.preventDefault();
    if (!subkey || opening) return;
    setOpening(true);
    try {
      const blob = await api.attachmentFile(attachment.id);
      const { ciphertext, nonce } = unpackEncryptedBlob(blob);
      const plaintext = decryptBytes(subkey, ciphertext, nonce);
      const objectUrl = URL.createObjectURL(new Blob([plaintext], { type: contentType || "application/octet-stream" }));
      window.open(objectUrl, "_blank", "noopener");
      // Отложенный revoke - вкладке нужно время открыть содержимое blob-URL.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } finally {
      setOpening(false);
    }
  };

  const href = isPersonal
    ? "#"
    : attachment.has_preview && OFFICE_CONTENT_TYPES.has(attachment.content_type)
      ? `/attachments/${attachment.id}/preview`
      : `/attachments/${attachment.id}`;

  return (
    <a
      className="file-item"
      href={href}
      target={isPersonal ? undefined : "_blank"}
      rel={isPersonal ? undefined : "noreferrer"}
      onClick={isPersonal ? handleOpenPersonal : undefined}>
      <div className="file-icon">
        {thumbnailUrl ? <img className="file-thumb" src={thumbnailUrl} alt="" /> : iconForMimeType(contentType)}
      </div>
      <div className="file-meta">
        <div className="file-name">{opening ? "Открываем..." : displayName}</div>
        <div className="file-size">{formatSize(attachment.size_bytes)}</div>
      </div>
    </a>
  );
}

export default function AttachmentList({ record, canUpload, onAttached }) {
  const { subkey } = usePersonalKey();
  const [attachments, setAttachments] = useState(record.attachments || []);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const isPersonal = record.zone === "personal";

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    if (isPersonal && !subkey) return; // дневник заблокирован - кнопка и так не должна была быть видна

    setError(null);
    setUploading(true);
    // Один файл за запрос - последовательно, чтобы обрыв посреди списка
    // давал понятное "N из M прикрепилось", а не гонку параллельных
    // запросов (та же причина, что была тут и раньше).
    const failed = [];
    for (const file of files) {
      try {
        const attachment = await uploadRecordAttachment(record.id, record.zone, file, subkey);
        setAttachments((prev) => [...prev, attachment]);
        onAttached?.(attachment);
      } catch (err) {
        failed.push(`${file.name}: ${(err.data && err.data.error) || err.message}`);
      }
    }
    if (failed.length > 0) setError(failed.join("; "));
    setUploading(false);
  };

  return (
    <div style={{ marginTop: 12 }}>
      {attachments.length > 0 && (
        <div className="file-list">
          {attachments.map((a) => (
            <AttachmentItem key={a.id} attachment={a} subkey={subkey} />
          ))}
        </div>
      )}

      {canUpload && (!isPersonal || subkey) && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка..." : "Прикрепить файлы"}
            <input type="file" multiple onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
          </label>
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
            Сделать фото
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
        </div>
      )}
      {canUpload && isPersonal && !subkey && (
        <p className="text-sm text-muted" style={{ marginTop: 8 }}>
          Разблокируйте личный дневник, чтобы прикреплять файлы.
        </p>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
