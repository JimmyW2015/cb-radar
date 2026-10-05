import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useSimpleTable<T>(
  table: string,
  orderBy?: { column: string; ascending?: boolean },
  options?: { select?: string; gte?: [string, string] },
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let query = supabase.from(table).select(options?.select ?? "*");
      if (options?.gte) query = query.gte(options.gte[0], options.gte[1]);
      if (orderBy) query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
      const { data, error } = await query;
      if (cancelled) return;
      if (error) setError(error.message);
      setRows((data ?? []) as T[]);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  return { rows, loading, error };
}
