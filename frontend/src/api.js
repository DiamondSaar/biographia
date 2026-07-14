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

export const api = {
  whoami: () => request("/whoami"),
  profile: () => request("/profile"),
  recentRecords: (limit = 10) => request(`/records/recent?limit=${limit}`),
  myRecords: () => request("/records/mine"),
  entityLookup: (q, parentsOnly = false) =>
    request(`/entities/lookup?q=${encodeURIComponent(q)}&parents_only=${parentsOnly}`),
  entityCard: (kind, id) => request(`/entities/${kind}/${id}`),
  entityFeed: (kind, id) => request(`/entities/${kind}/${id}/records`),
  recordDetail: (id) => request(`/records/${id}`),
  createRecord: (payload) => request("/records", { method: "POST", body: JSON.stringify(payload) }),
  editRecord: (id, payload) => request(`/records/${id}/edit`, { method: "POST", body: JSON.stringify(payload) }),
  uploadAttachment: (recordId, formData) =>
    request(`/records/${recordId}/attachments`, { method: "POST", body: formData }),
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
