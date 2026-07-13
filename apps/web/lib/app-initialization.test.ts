import { describe, expect, it } from "vitest";

import {
  APP_INITIALIZATION_DEFAULTS,
  APP_INITIALIZATION_STORAGE_KEYS,
  dismissQuickModelSetup,
  persistPetCollapsed,
  persistPetEnabled,
  persistWorkspaceInitialization,
  readInitialPetCollapsed,
  readInitialPetEnabled,
  readInitialWorkspace,
  shouldShowQuickModelSetup,
  type InitializationStorage,
} from "./app-initialization";

function memoryStorage(initial: Record<string, string> = {}): InitializationStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("app initialization", () => {
  it("opens a question-ready mini workspace with a collapsed pet for new users", () => {
    const storage = memoryStorage();

    expect(readInitialWorkspace(storage)).toEqual({ panel: "mini", section: "answer" });
    expect(readInitialPetEnabled(storage)).toBe(true);
    expect(readInitialPetCollapsed(storage)).toBe(true);
    expect(APP_INITIALIZATION_DEFAULTS).toMatchObject({
      workspacePanel: "mini",
      workspaceSection: "answer",
      petEnabled: true,
      petCollapsed: true,
    });
  });

  it("preserves explicit existing workspace and pet choices", () => {
    const storage = memoryStorage({
      [APP_INITIALIZATION_STORAGE_KEYS.workspacePanel]: "hidden",
      [APP_INITIALIZATION_STORAGE_KEYS.workspaceSection]: "knowledge",
      [APP_INITIALIZATION_STORAGE_KEYS.petEnabled]: "off",
      [APP_INITIALIZATION_STORAGE_KEYS.petCollapsed]: "false",
    });

    expect(readInitialWorkspace(storage)).toEqual({ panel: "hidden", section: "knowledge" });
    expect(readInitialPetEnabled(storage)).toBe(false);
    expect(readInitialPetCollapsed(storage)).toBe(false);
  });

  it("falls back from invalid values and keeps the legacy mini section", () => {
    const invalid = memoryStorage({
      [APP_INITIALIZATION_STORAGE_KEYS.workspacePanel]: "broken",
      [APP_INITIALIZATION_STORAGE_KEYS.workspaceSection]: "unknown",
      [APP_INITIALIZATION_STORAGE_KEYS.petCollapsed]: "unknown",
    });
    const legacy = memoryStorage({
      [APP_INITIALIZATION_STORAGE_KEYS.legacyWorkspaceMini]: "search",
    });

    expect(readInitialWorkspace(invalid)).toEqual({ panel: "mini", section: "answer" });
    expect(readInitialPetCollapsed(invalid)).toBe(true);
    expect(readInitialWorkspace(legacy)).toEqual({ panel: "mini", section: "search" });
  });

  it("uses friendly defaults when browser storage is unavailable", () => {
    const blockedStorage: InitializationStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readInitialWorkspace(blockedStorage)).toEqual({
      panel: "mini",
      section: "answer",
    });
    expect(readInitialPetEnabled(blockedStorage)).toBe(true);
    expect(readInitialPetCollapsed(blockedStorage)).toBe(true);
    expect(() => persistWorkspaceInitialization(blockedStorage, "normal")).not.toThrow();
  });

  it("persists later user choices", () => {
    const storage = memoryStorage();

    persistWorkspaceInitialization(storage, "normal", "knowledge");
    persistPetEnabled(storage, false);
    persistPetCollapsed(storage, false);

    expect(readInitialWorkspace(storage)).toEqual({ panel: "normal", section: "knowledge" });
    expect(readInitialPetEnabled(storage)).toBe(false);
    expect(readInitialPetCollapsed(storage)).toBe(false);
  });

  it("shows model setup once and respects an explicit skip", () => {
    const storage = memoryStorage();

    expect(shouldShowQuickModelSetup(true, storage)).toBe(true);
    expect(shouldShowQuickModelSetup(false, storage)).toBe(false);

    dismissQuickModelSetup(storage);
    expect(shouldShowQuickModelSetup(true, storage)).toBe(false);
  });
});
