# ADR-0001: Use Electron for the desktop shell

- Status: Accepted
- Date: 2026-07-20

## Context

SAG will add an installable desktop client for macOS on Apple Silicon and for Windows while retaining the Web application. The desktop client must reuse the product UI, support the existing graphics-heavy explore experience, manage a local Python backend, and leave room for future transparent and multi-window desktop interactions.

Tauri and Electron were both considered. Tauri produces a smaller shell by using the operating system WebView, but that also introduces a WKWebView/WebView2 rendering split. Electron has a larger binary and memory baseline, but provides one Chromium rendering environment and a mature multi-window model on both target platforms.

The size of the desktop shell is not the only package-size driver because the local Python knowledge stack contains native dependencies. Frontend delivery mode and Python dependency reduction remain separate decisions.

## Decision

Use Electron as the desktop shell.

Electron owns desktop window and application lifecycle. Product UI and domain behavior remain shared with the Web application, and the Python backend remains a separate local process rather than being rewritten into Electron.

The renderer will follow Electron's security boundary:

- Node integration disabled.
- Context isolation and renderer sandbox enabled.
- A narrow, typed preload bridge for approved desktop capabilities.
- Navigation, new-window creation, and IPC sender validation restricted by default.

This decision does not determine whether the renderer is delivered as a static SPA or by a packaged local Next.js server.

## Consequences

### Positive

- macOS and Windows render the UI with the same Chromium engine.
- Existing WebGL and graphics-heavy interactions have a more consistent desktop target.
- Transparent, frameless, movable, and multi-window desktop surfaces can be added without changing the shell technology.
- The desktop lifecycle can supervise the local backend and future background behavior.

### Negative

- The installer and baseline memory usage are larger than a system-WebView shell.
- Electron and Chromium security updates become part of the release responsibility.
- The main, preload, renderer, and Python process boundaries require explicit lifecycle and IPC design.

## Alternatives considered

### Tauri

Rejected for the desktop shell. Its smaller binary is attractive, but the project accepts Electron's larger baseline in exchange for a consistent Chromium renderer and the selected desktop development model.

### Browser-only or PWA

Rejected because it cannot provide the required local process supervision and future desktop window behavior.
