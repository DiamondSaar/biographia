// credentials: "include" - not strictly needed since the Vite dev-server
// proxy makes everything same-origin (see vite.config.js), but harmless
// and matches what production (single-origin behind nginx) needs too.
async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    const error = new Error("unauthenticated");
    error.status = 401;
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data && data.error) || `request_failed_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Binary download (personal-zone attachment/thumbnail/preview) - plain
// request() always tries response.json(), which would break on raw
// bytes. Open/org attachments don't need this at all - a plain <a href>/
// <img src> against the URL works fine since auth there is the cookie,
// no JS fetch required (see AttachmentList.jsx).
async function requestBytes(path) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const error = new Error(`request_failed_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return new Uint8Array(await response.arrayBuffer());
}

export const api = {
  whoami: () => request("/whoami"),
  profile: () => request("/profile"),
  // filters - {q, recordType, entityId, author}, все необязательны (см.
  // WikiHome.jsx) - пробрасываются в /records/recent как есть, пустые
  // (falsy) значения просто не попадают в query-строку.
  recentRecords: (limit = 10, filters = {}) => {
    const params = new URLSearchParams({ limit });
    if (filters.q) params.set("q", filters.q);
    if (filters.recordType) params.set("record_type", filters.recordType);
    if (filters.entityId) params.set("entity_id", filters.entityId);
    if (filters.author) params.set("author", filters.author);
    return request(`/records/recent?${params.toString()}`);
  },
  myRecords: () => request("/records/mine"),
  entityLookup: (q, parentsOnly = false) =>
    request(`/entities/lookup?q=${encodeURIComponent(q)}&parents_only=${parentsOnly}`),
  organizationLookup: (q) => request(`/entities/lookup?q=${encodeURIComponent(q)}&kind=organization`),
  equipmentLookup: (q, parentsOnly = false) =>
    request(`/entities/lookup?q=${encodeURIComponent(q)}&parents_only=${parentsOnly}&kind=entity`),
  entityCard: (kind, id) => request(`/entities/${kind}/${id}`),
  entityFeed: (kind, id) => request(`/entities/${kind}/${id}/records`),
  recordDetail: (id) => request(`/records/${id}`),
  createRecord: (payload) => request("/records", { method: "POST", body: JSON.stringify(payload) }),
  editRecord: (id, payload) => request(`/records/${id}/edit`, { method: "POST", body: JSON.stringify(payload) }),
  // Same endpoint for both zones - open/org sends the real file, personal
  // sends already-encrypted bytes + encrypted_meta/meta_nonce fields (see
  // AttachmentList.jsx) - the backend branches on the record's own zone,
  // the client just builds a different FormData.
  uploadAttachment: (recordId, formData) =>
    request(`/records/${recordId}/attachments`, { method: "POST", body: formData }),
  attachmentFile: (id) => requestBytes(`/attachments/${id}`),
  attachmentThumbnail: (id) => requestBytes(`/attachments/${id}/thumbnail`),
  attachmentPreview: (id) => requestBytes(`/attachments/${id}/preview`),
  userLookup: (q) => request(`/users/lookup?q=${encodeURIComponent(q)}`),
  recordProposals: (id) => request(`/records/${id}/proposals`),
  approveProposal: (id, versionNumber) =>
    request(`/records/${id}/proposals/${versionNumber}/approve`, { method: "POST" }),
  rejectProposal: (id, versionNumber) =>
    request(`/records/${id}/proposals/${versionNumber}/reject`, { method: "POST" }),
  reassignOwner: (id, username) =>
    request(`/records/${id}/reassign-owner`, { method: "POST", body: JSON.stringify({ username }) }),
  hideRecord: (id) => request(`/records/${id}/hide`, { method: "POST" }),
  unhideRecord: (id) => request(`/records/${id}/unhide`, { method: "POST" }),
  cryptoStatus: () => request("/crypto/status"),
  cryptoSetup: (material) => request("/crypto/setup", { method: "POST", body: JSON.stringify(material) }),
  cryptoMaterial: (provider = "password", credentialId = null) => {
    const params = new URLSearchParams({ provider });
    if (credentialId) params.set("credential_id", credentialId);
    return request(`/crypto/material?${params.toString()}`);
  },
  webauthnRegisterOptions: () => request("/webauthn/register/options"),
  webauthnRegisterVerify: (payload) => request("/webauthn/register/verify", { method: "POST", body: JSON.stringify(payload) }),
  webauthnAuthenticateOptions: () => request("/webauthn/authenticate/options"),
  webauthnAuthenticateVerify: (payload) =>
    request("/webauthn/authenticate/verify", { method: "POST", body: JSON.stringify(payload) }),
  cryptoOracle: (intermediateB64) =>
    request("/crypto/oracle", { method: "POST", body: JSON.stringify({ intermediate: intermediateB64 }) }),
};

export const SSO_LOGIN_URL = "/auth/sso/redirect";
export const LOGOUT_URL = "/logout";
export const SSOD_SITE_URL = "/auth/ssod-site";
export const SSOD_ACCOUNT_URL = "/auth/ssod-account";
