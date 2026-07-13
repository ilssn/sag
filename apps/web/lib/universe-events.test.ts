import { describe, expect, it } from "vitest";

import type { SearchResponse } from "./types";
import {
  activationFromSearch,
  dispatchUniverseView,
  readUniverseView,
} from "./universe-events";

function searchResponse(): SearchResponse {
  return {
    query: "跨来源实体",
    sections: [],
    events: [
      {
        id: "event-a",
        source_id: "source-a",
        source_name: "来源 A",
        document_id: null,
        title: "事件 A",
        summary: "",
        category: "event",
        rank: 1,
        parent_id: null,
        chunk_id: null,
        start_time: null,
        score: 1,
      },
      {
        id: "event-b",
        source_id: "source-b",
        source_name: "来源 B",
        document_id: null,
        title: "事件 B",
        summary: "",
        category: "event",
        rank: 1,
        parent_id: null,
        chunk_id: null,
        start_time: null,
        score: 0.9,
      },
    ],
    entities: [
      { id: "entity-shared", name: "共享实体", type: "topic", description: "", heat: 2 },
    ],
    relations: ["event-a", "event-b"].map((eventId) => ({
      source_id: eventId,
      source_kind: "event" as const,
      target_id: "entity-shared",
      target_kind: "entity" as const,
      kind: "mentions" as const,
      weight: 1,
      description: "",
    })),
    source_hits: [],
    summary: "",
    exploration_id: null,
    stats: {},
  };
}

describe("universe search activation", () => {
  it("projects a shared entity into every source that supports it", () => {
    const activation = activationFromSearch(searchResponse());
    const projections = activation.nodes
      .filter((node) => node.kind === "entity" && node.id === "entity-shared")
      .map((node) => node.source_id)
      .sort();

    expect(projections).toEqual(["source-a", "source-b"]);
    expect(activation.origin).toBe("search");
    expect(activation.relations.map((relation) => relation.source_id).sort()).toEqual([
      "source-a",
      "source-b",
    ]);
  });
});

describe("universe view state", () => {
  it("keeps the camera-derived progress bounded and clears source identity in overview", () => {
    dispatchUniverseView({ mode: "detail", source_id: "source-a", progress: 1.4 });
    expect(readUniverseView()).toEqual({
      mode: "detail",
      source_id: "source-a",
      progress: 1,
    });

    dispatchUniverseView({ mode: "overview", source_id: "source-a", progress: -0.2 });
    expect(readUniverseView()).toEqual({
      mode: "overview",
      source_id: null,
      progress: 0,
    });
  });
});
