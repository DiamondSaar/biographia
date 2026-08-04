import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { listPending, onQueueChanged, removePending } from "../offline/queue.js";

// Two independent signals, both surfaced here since they're related but
// not the same thing: (a) "нет соединения прямо сейчас" (navigator.onLine),
// (b) "есть черновики, ждущие отправки" (the queue can be non-empty even
// while online - a draft sits there until the user presses "Отправить",
// per the plan's "no automatic background sync" decision).
export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState([]);
  const [sendingId, setSendingId] = useState(null);
  const [sendError, setSendError] = useState(null);

  const refresh = () => listPending().then(setPending);

  useEffect(() => {
    refresh();
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const unsubscribe = onQueueChanged(refresh);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      unsubscribe();
    };
  }, []);

  const send = async (item) => {
    setSendError(null);
    setSendingId(item.id);
    try {
      const record = await api.createRecord(item.payload);
      for (const file of item.files || []) {
        const formData = new FormData();
        formData.append("file", file);
        try {
          await api.uploadAttachment(record.id, formData);
        } catch {
          // Record itself is saved either way - a failed attachment on
          // retry is the same best-effort case AddRecordForm already
          // tolerates, not a reason to leave the draft stuck in the queue.
        }
      }
      await removePending(item.id);
    } catch (err) {
      setSendError(`«${item.payload.title || "без заголовка"}»: ${(err.data && err.data.error) || err.message}`);
    } finally {
      setSendingId(null);
    }
  };

  if (online && pending.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: "var(--warn-bdr)", background: "var(--warn-bg)" }}>
      {!online && <div style={{ fontWeight: 600, color: "var(--warn)" }}>Нет соединения</div>}
      {pending.length > 0 && (
        <div style={{ marginTop: online ? 0 : 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Не отправлено: {pending.length}</div>
          {sendError && <div className="alert alert-error" style={{ marginBottom: 6 }}>{sendError}</div>}
          <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pending.map((item) => (
              <li key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="text-sm">
                  {item.payload.zone === "personal"
                    ? "Личная запись"
                    : item.payload.title || item.payload.body?.slice(0, 40) || "(без заголовка)"}
                  {item.files?.length > 0 ? ` · файлов: ${item.files.length}` : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={sendingId === item.id}
                  onClick={() => send(item)}
                >
                  {sendingId === item.id ? "Отправка..." : "Отправить"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
