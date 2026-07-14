import React, { useState } from "react";
import { api } from "../api.js";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// Plaintext (open/org) attachments only - personal-zone files need
// per-file client-side encryption (TZ section 9's "пофайловый DEK"),
// a separate follow-up on top of this same upload UI, not built here.
export default function AttachmentList({ record, canUpload, onAttached }) {
  const [attachments, setAttachments] = useState(record.attachments || []);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (caption.trim()) formData.append("caption", caption.trim());
      const attachment = await api.uploadAttachment(record.id, formData);
      setAttachments((prev) => [...prev, attachment]);
      setCaption("");
      onAttached?.(attachment);
    } catch (err) {
      setError((err.data && err.data.error) || err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      {attachments.length > 0 && (
        <div className="file-list">
          {attachments.map((a) => (
            <a key={a.id} className="file-item" href={`/attachments/${a.id}`} target="_blank" rel="noreferrer">
              <div className="file-icon">📎</div>
              <div className="file-meta">
                <div className="file-name">{a.filename}</div>
                <div className="file-size">
                  {formatSize(a.size_bytes)}
                  {a.caption ? ` · ${a.caption}` : ""}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {canUpload && record.zone !== "personal" && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Подпись (необязательно)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка..." : "Прикрепить файл"}
            <input type="file" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
          </label>
        </div>
      )}
      {canUpload && record.zone === "personal" && (
        <p className="text-sm text-muted" style={{ marginTop: 8 }}>
          Вложения для личной зоны пока не поддерживаются (нужно шифрование по файлу).
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
