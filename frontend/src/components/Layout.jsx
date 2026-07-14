import React from "react";
import { Link, useLocation } from "react-router-dom";
import { LOGOUT_URL } from "../api.js";

// Mirrors atb-portal's sidebar markup (.layout/.sidebar/.sidebar-nav/
// .nav-item classes from styles/main.css) - same visual language across
// the SSOD ecosystem, not a new design.
export default function Layout({ viewer, children }) {
  const location = useLocation();
  const initial = (viewer.display_name || viewer.username || "?")[0].toUpperCase();

  const handleLogout = async () => {
    await fetch(LOGOUT_URL, { credentials: "include" });
    window.location.reload();
  };

  const navItemClass = (path) => `nav-item${location.pathname === path ? " active" : ""}`;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Biographia</span>
        </div>
        <nav className="sidebar-nav">
          <Link to="/" className={navItemClass("/")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            Вики
          </Link>
          <Link to="/me" className={navItemClass("/me")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Личный кабинет
          </Link>
          <Link to="/diary" className={navItemClass("/diary")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Личный дневник
          </Link>
        </nav>
        <div className="sidebar-user">
          <div className="user-avatar">{initial}</div>
          <div className="user-info">
            <div className="user-name">{viewer.display_name || viewer.username}</div>
            <div className="user-login">{viewer.organization ? viewer.organization.name : viewer.username}</div>
          </div>
          <button type="button" className="logout-btn" title="Выйти" onClick={handleLogout}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
