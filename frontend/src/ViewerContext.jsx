import React, { createContext, useContext } from "react";

// App.jsx already fetches /whoami once to decide auth vs login-screen -
// this just makes that same viewer available to any nested component
// (RecordCard etc.) without prop-drilling it through every page.
const ViewerContext = createContext(null);

export function ViewerProvider({ viewer, children }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export function useViewer() {
  return useContext(ViewerContext);
}
