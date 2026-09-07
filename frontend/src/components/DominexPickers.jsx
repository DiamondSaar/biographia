import React, { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Общий поиск-по-мере-набора против Dominex - раньше жил только внутри
 * AddRecordForm.jsx (сущность/юрлицо при создании записи), вынесен сюда,
 * чтобы тот же компонент переиспользовал и фильтр поиска Вики
 * (WikiHome.jsx - фильтр по оборудованию/юрлицу тем же способом, что и
 * привязка записи).
 */
export function DominexLookupPicker({ value, onChange, label, attachedLabel, search, showCompositeToggle, describeResult }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // TZ 7.1/8: "по умолчанию доступны только родительские сущности; тумблер
  // «показать составные элементы»" - unchecked = parents_only=true.
  const [showComposite, setShowComposite] = useState(false);

  // Раньше ошибка поиска молча превращалась в пустой список - неотличимо
  // от "ничего не найдено", человек просто не понимал, почему пикер
  // "не даёт выбрать" (тот же класс бага, что уже правился в мобильном
  // приложении - см. EntityPicker.tsx там).
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      // searching могло остаться true из предыдущего запуска - см. тот же
      // фикс и комментарий в мобильном EntityPicker.tsx.
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      search(query, showComposite)
        .then((data) => {
          setResults(data.results || []);
          setSearchError(null);
        })
        .catch((err) => {
          setResults([]);
          setSearchError(err.message || "Не удалось выполнить поиск.");
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, showComposite]);

  if (value) {
    return (
      <div className="field">
        <label>{attachedLabel}</label>
        <div className="vpn-card">
          <div className="vpn-info">
            <div className="vpn-name">{value.display_name}</div>
            <div className="vpn-desc">{describeResult(value)}</div>
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
      <label>{label}</label>
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
      {showCompositeToggle && (
        <label className="check-field" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={showComposite} onChange={(e) => setShowComposite(e.target.checked)} />
          Показать составные элементы
        </label>
      )}
      {open && query.trim() && (
        <div className="card" style={{ position: "absolute", zIndex: 5, width: "100%", marginTop: 4, padding: 8 }}>
          {searching && <div className="file-size">Ищем...</div>}
          {!searching && searchError && <div className="alert alert-error" style={{ margin: 0 }}>{searchError}</div>}
          {!searching && !searchError && results.length === 0 && (
            <div className="file-size">Ничего не найдено в Доминекс.</div>
          )}
          {!searching &&
            !searchError &&
            results.map((r) => (
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
                  <div className="file-size">{describeResult(r)}</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function EntityPicker({ value, onChange }) {
  return (
    <DominexLookupPicker
      value={value}
      onChange={onChange}
      label="Прикрепить к сущности (необязательно)"
      attachedLabel="Привязано к"
      search={(q, showComposite) => api.entityLookup(q, !showComposite)}
      showCompositeToggle
      describeResult={(r) => (r.kind === "organization" ? `Юрлицо · класс ${r.access_class}` : `${r.template_name} · класс ${r.access_class}`)}
    />
  );
}

export function OrgPicker({ value, onChange }) {
  return (
    <DominexLookupPicker
      value={value}
      onChange={onChange}
      label="Юрлицо (необязательно)"
      attachedLabel="Юрлицо"
      search={(q) => api.organizationLookup(q)}
      showCompositeToggle={false}
      describeResult={(r) => `Юрлицо${r.access_class ? ` · класс ${r.access_class}` : ""}`}
    />
  );
}

// Только оборудование (entity_kind="entity") - для фильтра Вики
// (WikiHome.jsx). В отличие от EntityPicker выше, юрлица среди
// результатов не нужны - filter это отдельное поле (OrgPicker).
export function EquipmentPicker({ value, onChange, label = "Оборудование" }) {
  return (
    <DominexLookupPicker
      value={value}
      onChange={onChange}
      label={label}
      attachedLabel={label}
      search={(q, showComposite) => api.equipmentLookup(q, !showComposite)}
      showCompositeToggle
      describeResult={(r) => `${r.template_name} · класс ${r.access_class}`}
    />
  );
}

// Поиск по автору (Dominex Users, не entities/organizations) - тот же
// принцип "чип выбранного/поиск иначе", что и DominexLookupPicker выше,
// но результаты Dominex-пользователей имеют другую форму (username вместо
// numeric id, нет kind/access_class) - отдельный, не через
// DominexLookupPicker. Для фильтра Вики (WikiHome.jsx); UserPicker.jsx -
// одноразовый вариант той же идеи для переназначения владельца записи, с
// другим жизненным циклом (родитель сам скрывает его после выбора), не
// подошёл как есть.
export function AuthorPicker({ value, onChange }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .userLookup(query)
        .then((data) => {
          setResults(data.results || []);
          setSearchError(null);
        })
        .catch((err) => {
          setResults([]);
          setSearchError(err.message || "Не удалось выполнить поиск.");
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  if (value) {
    return (
      <div className="field">
        <label>Автор</label>
        <div className="vpn-card">
          <div className="vpn-info">
            <div className="vpn-name">{value.display_name || value.username}</div>
            <div className="vpn-desc">
              {value.username}
              {value.organization ? ` · ${value.organization}` : ""}
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
      <label>Автор</label>
      <input
        type="text"
        placeholder="Начните вводить имя или логин..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() && (
        <div className="card" style={{ position: "absolute", zIndex: 5, width: "100%", marginTop: 4, padding: 8 }}>
          {searching && <div className="file-size">Ищем...</div>}
          {!searching && searchError && <div className="alert alert-error" style={{ margin: 0 }}>{searchError}</div>}
          {!searching && !searchError && results.length === 0 && (
            <div className="file-size">Ничего не найдено.</div>
          )}
          {!searching &&
            !searchError &&
            results.map((u) => (
              <div
                key={u.username}
                className="file-item"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  onChange(u);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <div className="file-meta">
                  <div className="file-name">{u.display_name || u.username}</div>
                  <div className="file-size">
                    {u.username}
                    {u.organization ? ` · ${u.organization}` : ""}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
