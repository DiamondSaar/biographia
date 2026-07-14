import React, { useEffect, useState } from "react";
import { api } from "../api.js";

// "Владелец/Ответственный" picker - same shape as AddRecordForm.jsx's
// EntityPicker (type-to-search with debounce), but searches Dominex Users
// (see app/core/dominex_client.py::search_users) rather than entities -
// only a real ecosystem participant with a login can be an owner.
export default function UserPicker({ onPick, onCancel }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .userLookup(query)
        .then((data) => setResults(data.results || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="Начните вводить имя или логин..."
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="card" style={{ position: "absolute", zIndex: 5, width: "100%", marginTop: 4, padding: 8 }}>
          {results.map((u) => (
            <div
              key={u.username}
              className="file-item"
              style={{ cursor: "pointer" }}
              onClick={() => {
                onPick(u);
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
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}
