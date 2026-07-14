import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api.js";
import { deriveSubkey } from "./masterKey.ts";

// Shared across the whole SPA so any page (wiki feed, entity page,
// author profile, diary) can create/read personal-zone records without
// each duplicating its own unlock flow. The master key only ever lives
// in this in-memory React state - lost on refresh/navigation away, by
// design (TZ section 4: zero-knowledge, nothing persisted client-side
// either beyond the current tab's memory).
const PersonalKeyContext = createContext(null);

export function PersonalKeyProvider({ children }) {
  const [status, setStatus] = useState("loading"); // loading | not_configured | locked | unlocked | error
  const [providers, setProviders] = useState([]);
  const [masterKey, setMasterKey] = useState(null);

  const refreshStatus = () => {
    api
      .cryptoStatus()
      .then((data) => {
        setProviders(data.providers || []);
        setStatus((current) => (current === "unlocked" ? current : data.configured ? "locked" : "not_configured"));
      })
      .catch(() => setStatus("error"));
  };

  useEffect(refreshStatus, []);

  const unlock = (key) => {
    setMasterKey(key);
    setStatus("unlocked");
  };

  const lock = () => {
    setMasterKey(null);
    setStatus("locked");
  };

  const subkey = masterKey ? deriveSubkey(masterKey, "biographia") : null;

  return (
    <PersonalKeyContext.Provider value={{ status, providers, masterKey, subkey, unlock, lock, refreshStatus }}>
      {children}
    </PersonalKeyContext.Provider>
  );
}

export function usePersonalKey() {
  const ctx = useContext(PersonalKeyContext);
  if (!ctx) throw new Error("usePersonalKey() must be used inside PersonalKeyProvider");
  return ctx;
}
