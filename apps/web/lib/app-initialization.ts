import {
  isWorkspaceSection,
  type WorkspaceSection,
} from "./workspace";

export type WorkspacePanelMode = "hidden" | "mini" | "normal";

export const APP_INITIALIZATION_DEFAULTS = Object.freeze({
  workspacePanel: "mini" as WorkspacePanelMode,
  workspaceSection: "answer" as WorkspaceSection,
  petEnabled: true,
  petCollapsed: true,
});

export const APP_INITIALIZATION_STORAGE_KEYS = Object.freeze({
  workspacePanel: "sag:workspace-panel",
  workspaceSection: "sag:workspace-section",
  legacyWorkspaceMini: "sag:workspace-mini-mode",
  petEnabled: "sag:pet",
  petCollapsed: "sag:pet-collapsed",
  quickModelSetupDismissed: "sag:onboarding:model-setup-dismissed:v1",
});

export interface InitializationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safelyRead(storage: InitializationStorage | null | undefined, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safelyWrite(
  storage: InitializationStorage | null | undefined,
  key: string,
  value: string,
) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* In-memory state still follows the requested preference. */
  }
}

export function readInitialWorkspace(
  storage: InitializationStorage | null | undefined,
): { panel: WorkspacePanelMode; section: WorkspaceSection } {
  const savedPanel = safelyRead(
    storage,
    APP_INITIALIZATION_STORAGE_KEYS.workspacePanel,
  );
  const panel = savedPanel === "hidden" || savedPanel === "mini" || savedPanel === "normal"
    ? savedPanel
    : APP_INITIALIZATION_DEFAULTS.workspacePanel;

  const savedSection = safelyRead(
    storage,
    APP_INITIALIZATION_STORAGE_KEYS.workspaceSection,
  );
  if (isWorkspaceSection(savedSection)) return { panel, section: savedSection };

  const legacySection = safelyRead(
    storage,
    APP_INITIALIZATION_STORAGE_KEYS.legacyWorkspaceMini,
  );
  return {
    panel,
    section: legacySection === "search" || legacySection === "answer"
      ? legacySection
      : APP_INITIALIZATION_DEFAULTS.workspaceSection,
  };
}

export function persistWorkspaceInitialization(
  storage: InitializationStorage | null | undefined,
  panel: WorkspacePanelMode,
  section?: WorkspaceSection,
) {
  safelyWrite(storage, APP_INITIALIZATION_STORAGE_KEYS.workspacePanel, panel);
  if (section) {
    safelyWrite(storage, APP_INITIALIZATION_STORAGE_KEYS.workspaceSection, section);
  }
}

export function readInitialPetEnabled(
  storage: InitializationStorage | null | undefined,
) {
  return safelyRead(storage, APP_INITIALIZATION_STORAGE_KEYS.petEnabled) !== "off";
}

export function persistPetEnabled(
  storage: InitializationStorage | null | undefined,
  enabled: boolean,
) {
  safelyWrite(storage, APP_INITIALIZATION_STORAGE_KEYS.petEnabled, enabled ? "on" : "off");
}

export function readInitialPetCollapsed(
  storage: InitializationStorage | null | undefined,
) {
  const saved = safelyRead(storage, APP_INITIALIZATION_STORAGE_KEYS.petCollapsed);
  if (saved === "true") return true;
  if (saved === "false") return false;
  return APP_INITIALIZATION_DEFAULTS.petCollapsed;
}

export function persistPetCollapsed(
  storage: InitializationStorage | null | undefined,
  collapsed: boolean,
) {
  safelyWrite(storage, APP_INITIALIZATION_STORAGE_KEYS.petCollapsed, String(collapsed));
}

export function shouldShowQuickModelSetup(
  required: boolean,
  storage: InitializationStorage | null | undefined,
) {
  return required
    && safelyRead(
      storage,
      APP_INITIALIZATION_STORAGE_KEYS.quickModelSetupDismissed,
    ) !== "true";
}

export function dismissQuickModelSetup(
  storage: InitializationStorage | null | undefined,
) {
  safelyWrite(
    storage,
    APP_INITIALIZATION_STORAGE_KEYS.quickModelSetupDismissed,
    "true",
  );
}
