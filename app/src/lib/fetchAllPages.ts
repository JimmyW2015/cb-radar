export const PAGE_SIZE = 1000; // PostgREST 單次最多回 1000 筆

// 依序取完所有分頁：build(from, to) 回傳該頁的查詢（已含 select／order／篩選）
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) return all;
  }
}
