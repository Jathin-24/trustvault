"use client";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client-api";

/** GET a path; reloads when the path changes or reload() is called. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}