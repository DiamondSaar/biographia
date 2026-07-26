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
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;

    setError(null);
    setUploading(true);
    // Backend takes one file per request - upload sequentially so a
    // failure part-way through leaves a clear "N of M attached" state
    // instead of a pile of parallel requests racing each other.
    const failed = [];
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const attachment = await api.uploadAttachment(record.id, formData);
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
            <a key={a.id} className="file-item" href={`/attachments/${a.id}`} target="_blank" rel="noreferrer">
              <div className="file-icon">📎</div>
              <div className="file-meta">
                <div className="file-name">{a.filename}</div>
                <div className="file-size">{formatSize(a.size_bytes)}</div>
              </div>
            </a>
          ))}
        </div>
      )}

      {canUpload && record.zone !== "personal" && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка..." : "Прикрепить файлы"}
            <input type="file" multiple onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
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
