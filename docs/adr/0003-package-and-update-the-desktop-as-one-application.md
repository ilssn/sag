# ADR-0003: Package and update the desktop client as one application

- Status: Accepted
- Date: 2026-07-20

## Context

The desktop client contains three version-coupled runtime boundaries: Electron, the Next.js standalone server, and the Python knowledge backend. The Python backend also includes native LanceDB, PyArrow, ONNX Runtime, and document parsing dependencies.

Users expect one installer, one application version, retained local data, and a normal update experience. Updating the Web or Python runtime independently would create API, schema, and migration compatibility states that the current single-user product does not need.

## Decision

Use electron-builder for installers and electron-updater for application updates.

Release one versioned desktop bundle containing:

- the Electron main process and preload bridge;
- the existing Next.js standalone output;
- the FastAPI backend frozen by PyInstaller in `onedir` form;
- a runtime manifest recording the bundled versions and fixed API port.

The supported first-release targets are:

- macOS Apple Silicon: DMG for installation and ZIP for updates;
- Windows x64: per-user NSIS installer and its update metadata.

The bundle version is the version in `apps/desktop/package.json`. Web and backend code are never updated independently inside an installed client.

The update provider is selected at build time. The public stable channel uses GitHub Releases as specified by ADR-0028; a generic HTTPS endpoint remains available for other distribution channels. Builds without an update provider do not generate updater configuration and do not check for updates at runtime.

User data is stored in Electron's standard `userData` directory outside the application bundle. Installation and whole-application updates replace executable resources without replacing knowledge data.

## Consequences

### Positive

- Users install and update one coherent product.
- Next.js, API, native libraries, and data migrations can be tested as one release.
- DMG/ZIP and NSIS follow established platform installation patterns.
- PyInstaller `onedir` avoids extracting the entire Python runtime on every launch.
- Update rollout, progress, and install-on-quit behavior use the electron-updater protocol.

### Negative

- macOS and Windows releases must be built and smoke-tested on their target operating systems.
- The installer is large because it contains Chromium and the complete local knowledge stack.
- macOS releases require Developer ID signing and notarization. The initial Windows channel is deliberately unsigned and therefore shows an unknown-publisher warning until a trusted Authenticode certificate is introduced.
- A Python-only or Web-only fix still requires a new desktop application version.

## Alternatives considered

### Update Web and Python independently

Rejected because it introduces a compatibility matrix and partial-update recovery path without a current product need.

### PyInstaller `onefile`

Rejected because it extracts the Python runtime on launch, increasing startup time and antivirus friction.

### Custom patcher

Rejected because electron-updater already defines platform-aware metadata, download progress, staged rollout support, and installation behavior.
