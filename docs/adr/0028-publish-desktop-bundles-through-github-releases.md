# ADR-0028: Publish desktop bundles through GitHub Releases

- Status: Accepted
- Date: 2026-07-21
- Refines: ADR-0003

SAG uses the public `Zleap-AI/SAG` repository as the canonical stable update channel. An immutable annotated `vX.Y.Z` tag on `public/main` triggers native macOS Apple Silicon and Windows x64 builds; a GitHub Release becomes visible only after shared quality gates, macOS Developer ID signing and notarization, Windows unsigned-package checks, update-metadata checks, and checksum generation all succeed.

The release operator uses one repository script to advance the shared Desktop/Web/API runtime version, archive the changelog, create the release commit and tag, and atomically push both to the `public` remote. CI owns binaries and publication: local machines never upload hand-built installers, ordinary branch pushes never create releases, missing macOS credentials fail closed, and published tags are never moved or reused. Release workflows pin every action to a full commit SHA, with Dependabot responsible for proposing reviewed updates.

The initial Windows channel deliberately ships an unsigned NSIS installer. This avoids blocking usable Windows distribution on certificate procurement, at the cost of an explicit unknown-publisher warning. The workflow disables certificate auto-discovery and asserts that the installer remains unsigned; Authenticode signing can be added as a later release-policy change.

GitHub Releases was selected over a version-specific generic URL because installed public clients must discover later releases through one stable provider. A custom update server remains possible for a future distribution channel, but it is not part of the first public release path.
