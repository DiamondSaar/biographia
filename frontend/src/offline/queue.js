import { createStore, del, set, values } from "idb-keyval";

// Scoped to record creation only (POST /records), not edits/proposals/etc -
// see the mobile-module plan. A queued item's `payload` is exactly what
// AddRecordForm.jsx would have sent to api.createRecord: for zone=personal
// that's already client-side ciphertext (encrypted_content/nonce), so
// replaying it later needs no unlocked master key.
const store = createStore("biographia-offline", "pending-records");

// OfflineBanner (mounted once in Layout.jsx, persists across route changes)
// needs to know when AddRecordForm on some other page enqueues/clears an
// item - a DOM event is simpler here than threading context through every
// page that renders AddRecordForm.
const CHANGED_EVENT = "biographia-offline-queue-changed";
function notifyChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}
export function onQueueChanged(handler) {
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}

export async function enqueue(payload, files = []) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    payload,
    files, // File objects - IndexedDB structured-clones Blobs natively
    queuedAt: new Date().toISOString(),
  };
  await set(item.id, item, store);
  notifyChanged();
  return item;
}

export async function listPending() {
  const items = await values(store);
  return items.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
}

export async function removePending(id) {
  await del(id, store);
  notifyChanged();
}

// Distinguishes "the request never reached the server" from "the server
// responded with an error" - api.js's request() only sets .status on the
// latter (see api.js's request()), so a missing .status means fetch()
// itself threw (offline/DNS/connection refused).
export function isNetworkError(err) {
  return !err || typeof err.status === "undefined";
}
