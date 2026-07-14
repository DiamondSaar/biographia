import React, { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, SSO_LOGIN_URL, SSOD_ACCOUNT_URL, SSOD_SITE_URL } from "./api.js";
import Layout from "./components/Layout.jsx";
import { PersonalKeyProvider } from "./crypto/PersonalKeyContext.jsx";
import AuthorProfile from "./pages/AuthorProfile.jsx";
import DiaryPage from "./pages/DiaryPage.jsx";
import EntityPage from "./pages/EntityPage.jsx";
import WikiHome from "./pages/WikiHome.jsx";
import { ViewerProvider } from "./ViewerContext.jsx";

export default function App() {
  const [viewer, setViewer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .whoami()
      .then(setViewer)
      .catch(() => setViewer(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="auth-page" style={{ minHeight: "100vh" }}>
        <span className="spinner-sm" />
      </div>
    );
  }

  if (!viewer) {
    return (
      <div className="auth-page" style={{ minHeight: "100vh" }}>
        <div className="auth-wrap">
          <div className="auth-card">
            <div className="auth-header">
              <img className="auth-logo" src="/biographia-logo.png" alt="Biographia" />
              <div>
                <div className="auth-org">Biographia</div>
                <div className="auth-subtitle">Модуль экосистемы SSOD/Dominex</div>
              </div>
            </div>
            <div className="auth-form">
              <a className="btn btn-primary btn-full" href={SSO_LOGIN_URL}>
                Войти через ССОД
              </a>
              <a className="btn btn-secondary btn-full" href={SSOD_ACCOUNT_URL}>
                Личный кабинет ССОД
              </a>
              <a className="btn btn-secondary btn-full" href={SSOD_SITE_URL}>
                На сайт SSOD.pro
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ViewerProvider viewer={viewer}>
      <PersonalKeyProvider>
        <Layout viewer={viewer}>
          <Routes>
            <Route path="/" element={<WikiHome viewer={viewer} />} />
            <Route path="/entity/:kind/:id" element={<EntityPage />} />
            <Route path="/me" element={<AuthorProfile />} />
            <Route path="/diary" element={<DiaryPage />} />
          </Routes>
        </Layout>
      </PersonalKeyProvider>
    </ViewerProvider>
  );
}
