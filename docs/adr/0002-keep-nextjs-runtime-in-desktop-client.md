# ADR-0002: Keep the Next.js runtime in the desktop client

- Status: Accepted
- Date: 2026-07-20

## Context

The current Web application uses the Next.js App Router and a standalone server build. Request-time locale selection reads cookies and headers, middleware performs authentication redirects, and runtime-created chat and knowledge identifiers appear in dynamic routes.

Converting the application into static assets would require replacing those behaviors and changing the frontend routing boundary. The desktop client is intended to package the existing Web product with minimal divergence, and the project has explicitly chosen not to change the Next.js architecture for desktop packaging.

## Decision

Package the existing Next.js standalone server with the Electron desktop client.

Electron owns the local Web runtime lifecycle:

- Start the packaged Next.js server before showing the main window.
- Load the main window from the loopback-only local server.
- Wait for an explicit readiness check rather than assuming that process creation means the server is ready.
- Shut down the local server when the application exits.
- Package the standalone server together with its required static and public assets.

The Web application keeps its existing Next.js routing, middleware, internationalization, and rendering model. Desktop-only capabilities must be added through a narrow Electron preload bridge and must not be implemented by forking the product UI.

## Consequences

### Positive

- The desktop client preserves the current Web behavior and route structure.
- Web and desktop continue to use the same Next.js application.
- Desktop packaging does not require a frontend framework or router migration.
- Server-side locale and authentication behavior remain unchanged.

### Negative

- The desktop runtime includes Electron, a local Next.js server, and the Python backend.
- Startup coordination, health checks, logging, port selection, and shutdown must cover two local services.
- The package includes the Node modules traced into the Next.js standalone output.
- The renderer cannot load until the local Web runtime is ready.

## Alternatives considered

### Static Next.js export

Rejected because the current application relies on runtime cookies, redirects, and dynamic routes that would require architectural changes.

### Vite single-page application

Rejected because it would replace the current Next.js routing and runtime architecture.
