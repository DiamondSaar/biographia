import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import AddRecordForm from "../components/AddRecordForm.jsx";
import DiaryCalendar from "../components/DiaryCalendar.jsx";
import DiaryFeed from "../components/DiaryFeed.jsx";
import { usePersonalKey } from "../crypto/PersonalKeyContext.jsx";
import {
  DEFAULT_KDF_PARAMS,
  generateSeedPhrase,
  isValidSeedPhrase,
  masterKeyFromSeedPhrase,
  unwrapMasterKey,
  unwrapMasterKeyWithOracle,
  wrapMasterKeyWithOracle,
} from "../crypto/masterKey.ts";
import { registerWebAuthnKey, unlockWithWebAuthnKey } from "../crypto/webauthn.ts";

// Full лента/календарь (TZ 7.4) is a bigger follow-up (by-day grouping,
// month view) - this page covers the actual prerequisite for it: setup,
// unlock, and a working (not demo) feed of real personal records,
// created/decrypted through the same AddRecordForm/RecordCard every
// other zone already uses.

// Shared by SetupForm/RecoveryForm/UnlockForm below - relays a locally
// computed KDF intermediate to Dominex's crypto oracle (see
// masterKey.ts's wrapMasterKeyWithOracle/unwrapMasterKeyWithOracle).
async function oracleCall(intermediateB64) {
  const data = await api.cryptoOracle(intermediateB64);
  return data.result;
}

// err.data is set by api.js's request() for any structured error the
// oracle/relay returned (rate_limited/inactive/unknown_user/oracle_unavailable) -
// a plain AEAD-decrypt failure (wrong password) has no .data, callers
// keep using their own generic message for that case.
function oracleErrorMessage(err) {
  switch (err.data && err.data.error) {
    case "rate_limited":
      return "Слишком много попыток. Подождите некоторое время и попробуйте снова.";
    case "inactive":
      return "Учётная запись заблокирована. Обратитесь к администратору.";
    case "unknown_user":
      return "Пользователь не найден.";
    case "oracle_unavailable":
      return "Сервис проверки временно недоступен. Попробуйте позже.";
    default:
      return "Не удалось завершить операцию: " + (err.message || "неизвестная ошибка");
  }
}

function SetupForm({ onDone }) {
  const [step, setStep] = useState("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [masterKey, setMasterKey] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const startSetup = (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Пароль должен быть не короче 8 символов.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    const phrase = generateSeedPhrase();
    setMnemonic(phrase);
    setMasterKey(masterKeyFromSeedPhrase(phrase));
    setStep("seed");
  };

  const finishSetup = async () => {
    setSaving(true);
    setError(null);
    try {
      const material = await wrapMasterKeyWithOracle(masterKey, password, oracleCall, DEFAULT_KDF_PARAMS);
      await api.cryptoSetup(material);
      onDone(masterKey);
    } catch (err) {
      setError(oracleErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (step === "password") {
    return (
      <div className="card">
        <div className="card-header">
          <h2>Настройка шифрования личной зоны</h2>
        </div>
        <p className="text-muted">
          Сервер никогда не увидит ни ваш пароль, ни расшифрованные данные — только зашифрованную копию ключа.
        </p>
        <form onSubmit={startSetup} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="field">
            <label>Пароль</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="field">
            <label>Повторите пароль</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary">
            Далее
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Сохраните seed-фразу</h2>
      </div>
      <div className="alert alert-warn">
        Это единственный способ восстановить доступ, если пароль будет забыт. Запишите и сохраните офлайн — на сервере
        она не хранится нигде и никогда.
      </div>
      <p style={{ fontFamily: "monospace", fontSize: 16, padding: 12, background: "var(--bg)", borderRadius: 8 }}>
        {mnemonic}
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" disabled={saving} onClick={finishSetup}>
          {saving ? "Сохраняем..." : "Я сохранил фразу — завершить настройку"}
        </button>
      </div>
    </div>
  );
}

function RecoveryForm({ onUnlocked }) {
  const [mnemonic, setMnemonic] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const recover = async (e) => {
    e.preventDefault();
    setError(null);
    if (!isValidSeedPhrase(mnemonic)) {
      setError("Похоже, seed-фраза введена неверно.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Новый пароль должен быть не короче 8 символов.");
      return;
    }
    setBusy(true);
    try {
      const masterKey = masterKeyFromSeedPhrase(mnemonic);
      // Recovery is the natural point where a pre-oracle ("argon2id")
      // user upgrades to the oracle-hardened scheme - no forced
      // migration needed elsewhere.
      const material = await wrapMasterKeyWithOracle(masterKey, newPassword, oracleCall, DEFAULT_KDF_PARAMS);
      await api.cryptoSetup(material); // overwrites the wrapped copy with one under the new password
      onUnlocked(masterKey);
    } catch (err) {
      setError(oracleErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={recover} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="field">
        <label>Seed-фраза (12 слов)</label>
        <textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} />
      </div>
      <div className="field">
        <label>Новый пароль</label>
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
      </div>
      <button type="submit" className="btn btn-secondary" disabled={busy}>
        {busy ? "Восстанавливаем..." : "Восстановить доступ"}
      </button>
    </form>
  );
}

function UnlockForm({ onUnlocked, providers }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [keyBusyId, setKeyBusyId] = useState(null);

  const webauthnProviders = providers.filter((p) => p.provider === "webauthn_prf");

  const unlock = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const material = await api.cryptoMaterial();
      const masterKey =
        material.kdf_algorithm === "argon2id+oracle"
          ? await unwrapMasterKeyWithOracle(password, material, oracleCall)
          : unwrapMasterKey(password, material); // legacy pre-oracle rows
      onUnlocked(masterKey);
    } catch (err) {
      // err.data means the oracle/relay returned a structured error
      // (rate-limited, inactive, ...) - a plain AEAD-decrypt failure
      // (wrong password) has no .data and keeps the generic message so
      // "wrong password" and "corrupted data" stay indistinguishable.
      setError(err.data ? oracleErrorMessage(err) : "Неверный пароль или повреждённые данные.");
    } finally {
      setBusy(false);
    }
  };

  const unlockWithKey = async (credentialId) => {
    setError(null);
    setKeyBusyId(credentialId);
    try {
      const masterKey = await unlockWithWebAuthnKey(credentialId);
      onUnlocked(masterKey);
    } catch (err) {
      setError("Не удалось разблокировать ключом: " + (err.message || "неизвестная ошибка"));
    } finally {
      setKeyBusyId(null);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Разблокировать личную зону</h2>
      </div>
      {webauthnProviders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {webauthnProviders.map((p) => (
            <button
              key={p.credential_id}
              type="button"
              className="btn btn-secondary"
              disabled={keyBusyId === p.credential_id}
              onClick={() => unlockWithKey(p.credential_id)}
            >
              {keyBusyId === p.credential_id ? "Ждём ключ..." : `Войти через ключ «${p.label}»`}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={unlock} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="field">
          <label>Пароль</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Проверяем..." : "Разблокировать"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRecovery((v) => !v)}>
          Забыли пароль? Восстановить по seed-фразе
        </button>
      </form>
      {showRecovery && <RecoveryForm onUnlocked={onUnlocked} />}
    </div>
  );
}

function AddWebAuthnKeyButton({ masterKey, onRegistered }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");

  const register = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await registerWebAuthnKey(masterKey, label.trim() || "Без названия");
      setOpen(false);
      setLabel("");
      onRegistered();
    } catch (err) {
      setError(
        err.message === "authenticator_does_not_support_prf"
          ? "Этот ключ не поддерживает нужное расширение (PRF) — попробуйте другой."
          : "Не удалось добавить ключ: " + (err.message || "неизвестная ошибка"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Добавить ключ (WebAuthn)
      </button>
    );
  }

  return (
    <form onSubmit={register} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {error && <div className="alert alert-error">{error}</div>}
      <input
        type="text"
        placeholder="Название ключа (напр. YubiKey)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Ждём ключ..." : "Привязать"}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Отмена
      </button>
    </form>
  );
}

function PersonalFeed({ masterKey, onKeyRegistered }) {
  const [records, setRecords] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("feed"); // TZ 7.4: "лента" / "календарь"

  const load = () => {
    api
      .myRecords()
      .then((data) => setRecords((data.results || []).filter((r) => r.zone === "personal")))
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  return (
    <div>
      <div className="page-header">
        <div className="two-col" style={{ gap: 6 }}>
          <button
            type="button"
            className={mode === "feed" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            onClick={() => setMode("feed")}
          >
            Лента
          </button>
          <button
            type="button"
            className={mode === "calendar" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            onClick={() => setMode("calendar")}
          >
            Календарь
          </button>
        </div>
        <div className="two-col" style={{ gap: 10 }}>
          <AddWebAuthnKeyButton masterKey={masterKey} onRegistered={onKeyRegistered} />
          <button
            type="button"
            className={`btn btn-primary${showForm ? "" : " fab"}`}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Закрыть форму" : "Добавить запись"}
          </button>
        </div>
      </div>
      {showForm && (
        <AddRecordForm
          fixedZone="personal"
          onCreated={() => {
            setShowForm(false);
            load();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
      {error && <div className="alert alert-error">{error}</div>}
      {records === null && <div className="empty-state">Загрузка...</div>}
      {records && mode === "feed" && <DiaryFeed records={records} />}
      {records && mode === "calendar" && <DiaryCalendar records={records} />}
    </div>
  );
}

export default function DiaryPage() {
  const { status, providers, masterKey, unlock, refreshStatus } = usePersonalKey();

  return (
    <div>
      <Link to="/" className="back-link">
        ← Вики
      </Link>
      <div className="page-header">
        <h1>Личный дневник</h1>
      </div>

      {status === "loading" && <div className="empty-state">Загрузка...</div>}
      {status === "error" && <div className="alert alert-error">Не удалось проверить состояние шифрования.</div>}
      {status === "not_configured" && <SetupForm onDone={unlock} />}
      {status === "locked" && <UnlockForm onUnlocked={unlock} providers={providers} />}
      {status === "unlocked" && <PersonalFeed masterKey={masterKey} onKeyRegistered={refreshStatus} />}
    </div>
  );
}
