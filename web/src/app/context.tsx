import { createContext, type DependencyList, useCallback, useContext, useEffect, useState } from "react";
import type { ArtisanApi } from "./types.ts";

interface AppCtx {
  api: ArtisanApi;
  /** Préfixe des routes : "/app" (compte réel) ou "/demo" (démonstration). */
  base: string;
}

const Ctx = createContext<AppCtx | null>(null);
export const AppProvider = Ctx.Provider;

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp hors de AppProvider");
  return ctx;
}

/** Charge une donnée asynchrone ; `reload` la recharge après une action. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    load()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [...deps, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading: data === undefined && !error, reload };
}
