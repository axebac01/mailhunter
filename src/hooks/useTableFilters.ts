import { useMemo, useState } from "react";

const PAGE_SIZE = 25;

export type Predicates<T> = Record<string, (row: T, value: string) => boolean>;

export interface UseTableFiltersResult<T> {
  search: string;
  setSearch: (v: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  from: string;
  setFrom: (v: string) => void;
  page: number;
  setPage: (n: number | ((p: number) => number)) => void;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  toggleRow: (id: string) => void;
  toggleAllVisible: () => void;
  allVisibleSelected: boolean;
  filtered: T[];
  visible: T[];
  totalPages: number;
  pageSize: number;
  hasActiveFilters: boolean;
  clear: () => void;
}

interface Options<T> {
  rows: T[];
  searchFn?: (row: T, q: string) => boolean;
  filterDefs: Record<string, (row: T, value: string) => boolean>;
  fromFn?: (row: T, isoFrom: string) => boolean;
  rowId: (row: T) => string;
  pageSize?: number;
}

export function useTableFilters<T>({ rows, searchFn, filterDefs, fromFn, rowId, pageSize = PAGE_SIZE }: Options<T>): UseTableFiltersResult<T> {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(filterDefs).map((k) => [k, "all"]))
  );
  const [from, setFrom] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const setFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      for (const [key, fn] of Object.entries(filterDefs)) {
        const v = filters[key] ?? "all";
        if (v !== "all" && !fn(r, v)) return false;
      }
      if (from && fromFn && !fromFn(r, from)) return false;
      if (search && searchFn && !searchFn(r, search.toLowerCase())) return false;
      return true;
    });
  }, [rows, filterDefs, filters, from, fromFn, search, searchFn]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(rowId(r)));

  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) visible.forEach((r) => next.delete(rowId(r)));
    else visible.forEach((r) => next.add(rowId(r)));
    setSelected(next);
  };

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== "all") || !!search || !!from;

  const clear = () => {
    setSearch("");
    setFilters(Object.fromEntries(Object.keys(filterDefs).map((k) => [k, "all"])));
    setFrom("");
    setPage(1);
  };

  // Wrapper for setSearch/setFrom that also resets page
  const wrappedSetSearch = (v: string) => { setSearch(v); setPage(1); };
  const wrappedSetFrom = (v: string) => { setFrom(v); setPage(1); };

  return {
    search,
    setSearch: wrappedSetSearch,
    filters,
    setFilter,
    from,
    setFrom: wrappedSetFrom,
    page,
    setPage,
    selected,
    setSelected,
    toggleRow,
    toggleAllVisible,
    allVisibleSelected,
    filtered,
    visible,
    totalPages,
    pageSize,
    hasActiveFilters,
    clear,
  };
}
