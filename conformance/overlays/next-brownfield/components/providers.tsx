"use client";

import { createContext, useContext, type ReactNode } from "react";

const Theme = createContext({ accent: "#1f5c45" });

export function useTheme() {
  return useContext(Theme);
}

export function Providers({ children }: { children: ReactNode }) {
  return <Theme.Provider value={{ accent: "#1f5c45" }}>{children}</Theme.Provider>;
}
