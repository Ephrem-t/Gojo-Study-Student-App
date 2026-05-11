import React, { createContext, useContext } from "react";

const AppLockContext = createContext({
  appLockEnabled: false,
  lockAppNow: () => {},
});

export function AppLockProvider({ value, children }) {
  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock() {
  return useContext(AppLockContext);
}