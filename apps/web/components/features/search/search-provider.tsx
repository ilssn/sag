"use client";

import * as React from "react";

import { api, ApiError } from "@/lib/api";
import type { SearchStrategy } from "@/lib/retrieval-config";
import type { ActivityItem, SearchResponse, Source } from "@/lib/types";
import {
  activationFromSearch,
  dispatchUniverseActivation,
  dispatchUniverseReset,
} from "@/lib/universe-events";

export interface SearchScope {
  id: string;
  name: string;
}

export interface SearchRunOptions {
  query?: string;
  topK?: number;
  strategy?: SearchStrategy;
  sourceIds?: string[];
  saveExploration?: boolean;
}

export type SearchBrowseView = "activity" | "history";
export type SearchContentView = "results" | SearchBrowseView;

interface SearchWorkspaceState {
  query: string;
  scoped: SearchScope[];
  sources: Source[];
  result: SearchResponse | null;
  busy: boolean;
  error: string;
  lastQuery: string;
  strategy: SearchStrategy;
  lastStrategy: SearchStrategy;
  topK: number;
  hasMore: boolean;
  activity: ActivityItem[] | null;
  history: string[];
  contentView: SearchContentView;
  contentPreference: SearchBrowseView;
}

interface SearchWorkspaceContextValue extends SearchWorkspaceState {
  defaultStrategy: SearchStrategy;
  setQuery: (query: string) => void;
  setStrategy: (strategy: SearchStrategy) => void;
  setScope: (scope: SearchScope[]) => void;
  toggleSource: (source: Source) => void;
  removeSource: (sourceId: string) => void;
  ensureSources: () => Promise<Source[]>;
  ensureActivity: () => Promise<ActivityItem[]>;
  run: (options?: SearchRunOptions) => Promise<SearchResponse | null>;
  removeHistory: (query: string) => void;
  clearHistory: () => void;
  setContentView: (view: SearchContentView) => void;
  restoreContentPreference: () => void;
  clear: () => void;
  cancel: () => void;
}

const SearchWorkspaceContext = React.createContext<SearchWorkspaceContextValue | null>(null);
const SEARCH_HISTORY_KEY = "sag:search-history";
const SEARCH_HISTORY_LIMIT = 20;
const SEARCH_CONTENT_PREFERENCE_KEY = "sag:search-content-preference";

function readSearchContentPreference(): SearchBrowseView {
  if (typeof window === "undefined") return "activity";
  try {
    return window.localStorage.getItem(SEARCH_CONTENT_PREFERENCE_KEY) === "history"
      ? "history"
      : "activity";
  } catch {
    return "activity";
  }
}

function writeSearchContentPreference(view: SearchBrowseView) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEARCH_CONTENT_PREFERENCE_KEY, view);
  } catch {
    /* The in-memory preference still works when local storage is unavailable. */
  }
}

function readSearchHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim())
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeSearchHistory(history: string[]) {
  if (typeof window === "undefined") return;
  try {
    if (history.length === 0) {
      window.localStorage.removeItem(SEARCH_HISTORY_KEY);
      return;
    }
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* The in-memory history still works when local storage is unavailable. */
  }
}

function rememberSearch(query: string, current: string[]): string[] {
  const normalized = query.trim();
  if (!normalized) return current;
  const next = [
    normalized,
    ...current.filter((item) => item !== normalized),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  writeSearchHistory(next);
  return next;
}

export function SearchProvider({
  defaultStrategy,
  children,
}: {
  defaultStrategy: SearchStrategy;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<SearchWorkspaceState>({
    query: "",
    scoped: [],
    sources: [],
    result: null,
    busy: false,
    error: "",
    lastQuery: "",
    strategy: defaultStrategy,
    lastStrategy: defaultStrategy,
    topK: 12,
    hasMore: false,
    activity: null,
    history: [],
    contentView: "activity",
    contentPreference: "activity",
  });
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const requestIdRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const sourcesLoadedRef = React.useRef(false);
  const sourcesPromiseRef = React.useRef<Promise<Source[]> | null>(null);
  const activityPromiseRef = React.useRef<Promise<ActivityItem[]> | null>(null);

  React.useEffect(() => {
    const history = readSearchHistory();
    const contentPreference = readSearchContentPreference();
    setState((current) => ({
      ...current,
      history,
      contentPreference,
      contentView:
        current.contentView === "results" ? "results" : contentPreference,
    }));
  }, []);

  React.useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  React.useEffect(() => {
    if (!stateRef.current.lastQuery) {
      setState((current) => ({
        ...current,
        strategy: defaultStrategy,
        lastStrategy: defaultStrategy,
      }));
    }
  }, [defaultStrategy]);

  const cancel = React.useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState((current) => ({ ...current, busy: false }));
  }, []);

  const clear = React.useCallback(() => {
    cancel();
    dispatchUniverseReset("search-clear");
    setState((current) => ({
      ...current,
      query: "",
      result: null,
      error: "",
      lastQuery: "",
      topK: 12,
      hasMore: false,
      contentView: current.contentPreference,
    }));
  }, [cancel]);

  const setQuery = React.useCallback(
    (query: string) => {
      if (!query.trim()) {
        clear();
        return;
      }
      setState((current) => ({ ...current, query }));
    },
    [clear],
  );

  const ensureSources = React.useCallback(async () => {
    if (sourcesLoadedRef.current) return stateRef.current.sources;
    if (!sourcesPromiseRef.current) {
      sourcesPromiseRef.current = api
        .listSources()
        .then((sources) => {
          sourcesLoadedRef.current = true;
          setState((current) => ({ ...current, sources }));
          return sources;
        })
        .finally(() => {
          sourcesPromiseRef.current = null;
        });
    }
    return sourcesPromiseRef.current;
  }, []);

  const ensureActivity = React.useCallback(async () => {
    if (stateRef.current.activity !== null) return stateRef.current.activity;
    if (!activityPromiseRef.current) {
      activityPromiseRef.current = api
        .getActivity()
        .then((items) => items.filter((item) => item.type === "document"))
        .catch(() => [])
        .then((activity) => {
          setState((current) => ({ ...current, activity }));
          return activity;
        })
        .finally(() => {
          activityPromiseRef.current = null;
        });
    }
    return activityPromiseRef.current;
  }, []);

  const run = React.useCallback(async (options: SearchRunOptions = {}) => {
    const snapshot = stateRef.current;
    const query = (options.query ?? snapshot.query).trim();
    if (!query) {
      clear();
      return null;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    const resetEpoch = dispatchUniverseReset("search-start");
    const topK = Math.max(1, Math.min(options.topK ?? snapshot.topK, 50));
    const strategy = options.strategy ?? snapshot.strategy;
    const sourceIds = options.sourceIds
      ?? (snapshot.scoped.length ? snapshot.scoped.map((source) => source.id) : undefined);

    setState((current) => ({
      ...current,
      query,
      busy: true,
      error: "",
      topK,
      strategy,
      contentView: "results",
    }));
    try {
      const saveExploration = options.saveExploration ?? false;
      const result = await api.globalSearch(
        {
          query,
          source_ids: sourceIds,
          top_k: topK,
          strategy,
          save_exploration: saveExploration,
        },
        controller.signal,
      );
      if (requestId !== requestIdRef.current) return null;
      dispatchUniverseActivation(activationFromSearch(result), resetEpoch);
      const history = rememberSearch(result.query || query, stateRef.current.history);
      setState((current) => {
        return {
          ...current,
          result,
          busy: false,
          error: "",
          lastQuery: result.query || query,
          lastStrategy: strategy,
          hasMore: Boolean(result.stats.has_more),
          history,
        };
      });
      return result;
    } catch (error) {
      if (requestId !== requestIdRef.current) return null;
      if (error instanceof ApiError && error.code === "aborted") return null;
      const message = error instanceof ApiError ? error.message : "检索失败";
      setState((current) => ({ ...current, busy: false, error: message }));
      throw error;
    } finally {
      if (requestId === requestIdRef.current && abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [clear]);

  const setStrategy = React.useCallback((strategy: SearchStrategy) => {
    setState((current) => ({ ...current, strategy }));
  }, []);

  const setScope = React.useCallback((scoped: SearchScope[]) => {
    setState((current) => ({ ...current, scoped }));
  }, []);

  const toggleSource = React.useCallback((source: Source) => {
    setState((current) => ({
      ...current,
      scoped: current.scoped.some((item) => item.id === source.id)
        ? current.scoped.filter((item) => item.id !== source.id)
        : [...current.scoped, { id: source.id, name: source.name }],
    }));
  }, []);

  const removeSource = React.useCallback((sourceId: string) => {
    setState((current) => ({
      ...current,
      scoped: current.scoped.filter((item) => item.id !== sourceId),
    }));
  }, []);

  const removeHistory = React.useCallback((query: string) => {
    const history = stateRef.current.history.filter((item) => item !== query);
    writeSearchHistory(history);
    setState((current) => ({ ...current, history }));
  }, []);

  const clearHistory = React.useCallback(() => {
    writeSearchHistory([]);
    setState((current) => ({ ...current, history: [] }));
  }, []);

  const setContentView = React.useCallback((contentView: SearchContentView) => {
    if (contentView === "results") {
      setState((current) => ({ ...current, contentView }));
      return;
    }
    writeSearchContentPreference(contentView);
    setState((current) => ({
      ...current,
      contentView,
      contentPreference: contentView,
    }));
  }, []);

  const restoreContentPreference = React.useCallback(() => {
    setState((current) => ({
      ...current,
      contentView: current.contentPreference,
    }));
  }, []);

  const value = React.useMemo<SearchWorkspaceContextValue>(
    () => ({
      ...state,
      defaultStrategy,
      setQuery,
      setStrategy,
      setScope,
      toggleSource,
      removeSource,
      ensureSources,
      ensureActivity,
      run,
      removeHistory,
      clearHistory,
      setContentView,
      restoreContentPreference,
      clear,
      cancel,
    }),
    [
      cancel,
      clear,
      defaultStrategy,
      ensureActivity,
      ensureSources,
      clearHistory,
      removeHistory,
      removeSource,
      restoreContentPreference,
      run,
      setContentView,
      setQuery,
      setScope,
      setStrategy,
      state,
      toggleSource,
    ],
  );

  return (
    <SearchWorkspaceContext.Provider value={value}>
      {children}
    </SearchWorkspaceContext.Provider>
  );
}

export function useSearchWorkspace(): SearchWorkspaceContextValue {
  const value = React.useContext(SearchWorkspaceContext);
  if (!value) throw new Error("useSearchWorkspace must be used inside SearchProvider");
  return value;
}
