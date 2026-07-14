import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { usePersonalKey } from "../crypto/PersonalKeyContext.jsx";
import { encryptText } from "../crypto/masterKey.ts";
import { ACCESS_CLASSES, RECORD_TYPE_LABELS, ZONE_LABELS } from "./RecordCard.jsx";

function EntityPicker({ value, onChange }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  // TZ 7.1/8: "по умолчанию доступны только родительские сущности; тумблер
  // «показать составные элементы»" - unchecked = parents_only=true.
  const [showComposite, setShowComposite] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .entityLookup(query, !showComposite)
        .then((data) => setResults(data.results || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, showComposite]);

  if (value) {
    return (
      <div className="field">
        <label>Привязано к</label>
        <div className="vpn-card">
          <div className="vpn-info">
            <div className="vpn-name">{value.display_name}</div>
            <div className="vpn-desc">
              {value.kind === "organization" ? "Юрлицо" : value.template_name} · класс {value.access_class}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            Убрать
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field" style={{ position: "relative" }}>
      <label>Прикрепить к сущности (необязательно)</label>
      <input
        type="text"
        placeholder="Начните вводить название..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      <label className="check-field" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={showComposite} onChange={(e) => setShowComposite(e.target.checked)} />
        Показать составные элементы
      </label>
      {open && results.length > 0 && (
        <div className="card" style={{ position: "absolute", zIndex: 5, width: "100%", marginTop: 4, padding: 8 }}>
          {results.map((r) => (
            <div
              key={`${r.kind}-${r.id}`}
              className="file-item"
              style={{ cursor: "pointer" }}
              onClick={() => {
                onChange(r);
                setQuery("");
                setOpen(false);
              }}
            >
              <div className="file-meta">
                <div className="file-name">{r.display_name}</div>
                <div className="file-size">{r.kind === "organization" ? "Юрлицо" : r.template_name}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// fixedEntity - when set (opened from an object page, TZ 7.5), the
// binding is pre-filled and not editable - "прикрепить запись
// биографии" from the object side of the two-way attach mechanism.
// fixedZone - when set (opened from the diary, TZ 7.4), the zone
// selector/access-level field disappear entirely instead of just
// defaulting to "open" and making the user switch it by hand every time.
export default function AddRecordForm({ onCreated, onCancel, fixedEntity = null, fixedZone = null }) {
  const [zone, setZone] = useState(fixedZone || "open");
  const [recordType, setRecordType] = useState("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [accessLevel, setAccessLevel] = useState("G");
  const [entity, setEntity] = useState(fixedEntity);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const { status: keyStatus, subkey } = usePersonalKey();

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() && !body.trim()) {
      setError("Нужен заголовок или текст.");
      return;
    }

    const base = {
      zone,
      record_type: recordType,
      entity_kind: entity ? entity.kind : null,
      entity_id: entity ? entity.id : null,
    };

    let payload;
    if (zone === "personal") {
      // Plaintext title/body never leave the browser for the personal
      // zone - encrypted together as one AEAD payload (see
      // app/models/biography.py's encrypted_content docstring for why
      // not two separate ciphertexts).
      if (keyStatus !== "unlocked") {
        setError("Сначала разблокируйте личный дневник.");
        return;
      }
      const { ciphertext, nonce } = encryptText(
        subkey,
        JSON.stringify({ title: title.trim() || null, body: body.trim() || null }),
      );
      payload = { ...base, encrypted_content: ciphertext, nonce };
    } else {
      payload = { ...base, title: title.trim() || null, body: body.trim() || null, access_level: accessLevel };
    }

    setSaving(true);
    try {
      const record = await api.createRecord(payload);
      // Second call under the hood (backend has no combined create+upload
      // endpoint), but one button/one submit from the user's side - the
      // attach-a-file part of TZ 7.1's "текст + вложения" in one motion.
      // Personal zone skipped here on purpose - file encryption (per-file
      // DEK, TZ section 9) isn't built yet, same 501 the backend returns.
      if (file && zone !== "personal") {
        const formData = new FormData();
        formData.append("file", file);
        if (caption.trim()) formData.append("caption", caption.trim());
        await api.uploadAttachment(record.id, formData);
      }
      onCreated();
    } catch (err) {
      setError((err.data && err.data.error) || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Добавить запись</h2>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {zone === "personal" && keyStatus !== "unlocked" && (
          <div className="alert alert-warn">
            Личный дневник заблокирован — <Link to="/diary">разблокируйте его</Link>, прежде чем сохранять личные
            записи.
          </div>
        )}

        <div className="two-col">
          {!fixedZone && (
            <div className="field">
              <label>Зона</label>
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                {Object.entries(ZONE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Тип события</label>
            <select value={recordType} onChange={(e) => setRecordType(e.target.value)}>
              {Object.entries(RECORD_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {zone !== "personal" && (
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

        {fixedEntity ? (
          <div className="field">
            <label>Привязано к</label>
            <div className="vpn-card">
              <div className="vpn-info">
                <div className="vpn-name">{fixedEntity.display_name}</div>
              </div>
            </div>
          </div>
        ) : (
          <EntityPicker value={entity} onChange={setEntity} />
        )}

        <div className="field">
          <label>Заголовок</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Текст</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </div>

        {zone !== "personal" ? (
          <div className="field">
            <label>Вложение (необязательно)</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                {file ? file.name : "Выбрать файл"}
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  style={{ display: "none" }}
                />
              </label>
              {file && (
                <>
                  <input
                    type="text"
                    placeholder="Подпись (необязательно)"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    style={{ maxWidth: 200 }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>
                    Убрать
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Вложения для личной зоны пока не поддерживаются.</p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Сохраняем..." : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}
