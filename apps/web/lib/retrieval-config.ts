export const SEARCH_STRATEGIES = [
  {
    value: "multi",
    label: "图谱增强",
    description: "结合实体关系扩展召回，理解更完整。",
  },
  {
    value: "vector",
    label: "纯向量",
    description: "按语义相似度召回，响应最快。",
  },
  {
    value: "atomic",
    label: "原子检索",
    description: "面向原子事实进行更精确的召回。",
  },
] as const;

export type SearchStrategy = (typeof SEARCH_STRATEGIES)[number]["value"];

export const DEFAULT_SEARCH_STRATEGY: SearchStrategy = "multi";

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
