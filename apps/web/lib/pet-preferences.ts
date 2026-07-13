"use client";

import * as React from "react";

import {
  APP_INITIALIZATION_DEFAULTS,
  APP_INITIALIZATION_STORAGE_KEYS,
  persistPetEnabled,
  readInitialPetEnabled,
} from "@/lib/app-initialization";

const PET_TOGGLE_EVENT = "sag:pet-toggle";

function getPetEnabled() {
  if (typeof window === "undefined") return APP_INITIALIZATION_DEFAULTS.petEnabled;
  return readInitialPetEnabled(window.localStorage);
}

function subscribePetEnabled(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_INITIALIZATION_STORAGE_KEYS.petEnabled) listener();
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
  persistPetEnabled(window.localStorage, enabled);
  window.dispatchEvent(new Event(PET_TOGGLE_EVENT));
}

/** 新用户默认开启；只有用户明确关闭后才隐藏。 */
export function usePetEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = React.useSyncExternalStore(
    subscribePetEnabled,
    getPetEnabled,
    () => APP_INITIALIZATION_DEFAULTS.petEnabled,
  );
  const setEnabled = React.useCallback((value: boolean) => setPetEnabled(value), []);
  return [enabled, setEnabled];
}
