export const SEARCH_STRATEGIES = [
  {
    value: "vector",
    label: "快速",
    description: "基于语义相似度直接召回，响应更快。",
  },
  {
    value: "multi",
    label: "精确",
    description: "结合实体关系与 LLM 精排，结果更完整。",
  },
] as const;

export type SearchStrategy = (typeof SEARCH_STRATEGIES)[number]["value"];

export const DEFAULT_SEARCH_STRATEGY: SearchStrategy = "vector";

export function isSearchStrategy(value: unknown): value is SearchStrategy {
  return (
    typeof value === "string" &&
    SEARCH_STRATEGIES.some((strategy) => strategy.value === value)
  );
}

export function getSearchStrategy(value: unknown) {
  return (
    SEARCH_STRATEGIES.find((strategy) => strategy.value === value) ??
    SEARCH_STRATEGIES.find((strategy) => strategy.value === DEFAULT_SEARCH_STRATEGY)!
  );
}
