"use client";

import type { Outlet, Profile } from "@splashly/core";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

export type DashboardState = {
  session: Session;
  profile: Profile;
  outlet: Outlet | null;
  reloadOutlet: () => Promise<void>;
};

export const DashboardContext = createContext<DashboardState | null>(null);

export function useDashboard(): DashboardState {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard must be used inside the dashboard layout");
  return value;
}
