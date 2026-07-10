"use client";

import * as React from "react";

const PET_ENABLED_KEY = "sag:pet";
const PET_TOGGLE_EVENT = "sag:pet-toggle";

function getPetEnabled() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(PET_ENABLED_KEY) !== "off";
}

function subscribePetEnabled(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PET_ENABLED_KEY) listener();
  };
  window.addEventListener(PET_TOGGLE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PET_TOGGLE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setPetEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PET_ENABLED_KEY, enabled ? "on" : "off");
  window.dispatchEvent(new Event(PET_TOGGLE_EVENT));
}

/** 新用户默认开启；只有用户明确关闭后才隐藏。 */
export function usePetEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = React.useSyncExternalStore(subscribePetEnabled, getPetEnabled, () => true);
  const setEnabled = React.useCallback((value: boolean) => setPetEnabled(value), []);
  return [enabled, setEnabled];
}
