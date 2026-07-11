# SAG README Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current README with complete English and Chinese entry documents that explain SAG's product value, original retrieval architecture, benchmark evidence, deployment, repository structure, Python engine API, and self-hosted API.

**Architecture:** `README.md` is the canonical English document and `README-CN.md` mirrors it in Chinese. Shared assets live under `docs/assets/readme/`; source SVGs remain editable and are rendered to high-resolution PNGs for stable Git hosting. The documents use progressively deeper sections so product users can stop after Docker deployment while developers can continue into APIs and internals.

**Tech Stack:** Markdown/HTML, SVG, PNG, Sharp, FastAPI OpenAPI, Docker Compose, `zleap-sag` 0.7.1+

## Global Constraints

- Work only on branch `jomy-0711`; do not create or modify `legacy-v1`.
- Use the legacy Zleap symbol as the README logo.
- Top-level navigation is Project, Technology, User Guide, Developer Guide.
- Brand vision is "Your last knowledge base application" / "你的最后一个知识库应用".
- Describe SAG as an original architecture that replaces the need to choose between traditional RAG and GraphRAG; never describe it as a fusion or composition of their implementations.
- State SOTA only with verifiable paper evidence: best on 8 of 9 Recall@K metrics and average Recall@2/Recall@5 of 79.3/88.2.
- Keep the original paper architecture figure; redraw only the benchmark and repository boundary architecture visuals.
- Visuals use the current product language: white/near-white, black/gray type, fine borders, restrained shadow, orange for events, pale lavender for entities, and no teal/navy palette.
- Document both `zleap-sag` Python APIs and SAG's self-hosted HTTP/OpenAI-compatible/MCP APIs.
- Treat `/docs` as generated endpoint reference rather than duplicating every request schema in Markdown.

---

### Task 1: Gather and Normalize Evidence

**Files:**
- Create: `docs/assets/readme/zleap-logo.svg`
- Create: `docs/assets/readme/paper-first-page.png`
- Create: `docs/assets/readme/paper-architecture.jpeg`
- Create: `docs/assets/readme/product-graph.png`
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: the user-provided screenshots, the paper, the legacy SAG README, PyPI metadata, and local FastAPI routes
- Produces: stable local assets and verified claims used by both READMEs

- [x] **Step 1: Save the legacy Zleap symbol and the original paper architecture figure locally**

Use the raw asset URLs from `Zleap-AI/SAG` and preserve their source formats.

- [x] **Step 2: Copy the user-provided paper and product screenshots**

Copy the supplied PNGs into `docs/assets/readme/` without altering their content.

- [x] **Step 3: Verify benchmark and API claims**

Cross-check the paper table, PyPI package version/API, local package source, and `http://localhost:8000/openapi.json`. Record only claims that have a direct source.

- [x] **Step 4: Verify asset integrity**

Run:

```bash
file docs/assets/readme/*
sips -g pixelWidth -g pixelHeight docs/assets/readme/*.png docs/assets/readme/*.jpeg
```

Expected: every raster asset decodes and reports non-zero dimensions.

### Task 2: Create Benchmark and Boundary Architecture Visuals

**Files:**
- Create: `docs/assets/readme/sag-benchmark.svg`
- Create: `docs/assets/readme/sag-benchmark.png`
- Create: `docs/assets/readme/repository-architecture.svg`
- Create: `docs/assets/readme/repository-architecture.png`

**Interfaces:**
- Consumes: verified paper metrics and the local repository/module map
- Produces: two README-ready visuals plus editable sources

- [x] **Step 1: Draw the benchmark SVG**

Show the SOTA evidence, average Recall@2/Recall@5 comparison, three evaluated datasets, and the 8/9 best-metric result. Use accessible labels and the approved light product palette.

- [x] **Step 2: Draw the boundary architecture SVG**

Show custom frontend/external agents and SAG Web entering SAG API through HTTP, OpenAI-compatible endpoints, or MCP; show parsing before `zleap-sag`; show the Python engine owning ingest/extract/search and persisting to SQL/vector storage. Include the repository directory map without using Mermaid or Markdown boxes.

- [x] **Step 3: Render high-resolution PNGs**

Use the bundled Node runtime and Sharp:

```bash
NODE_PATH=/Users/jomymac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/jomymac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  docs/assets/readme/render-assets.mjs
```

Expected: both PNGs render at 2x source dimensions without transparent or blank output.

- [x] **Step 4: Inspect the rendered assets**

Check dimensions, sample pixels, and visually inspect both PNGs. Correct clipped text, weak contrast, uneven spacing, or overlapping connectors before continuing.

### Task 3: Capture User Workflows

**Files:**
- Create: `docs/assets/readme/product-import.png`
- Create: `docs/assets/readme/product-search.png`
- Create: `docs/assets/readme/product-chat.png`

**Interfaces:**
- Consumes: the running local SAG application and its existing signed-in sample data
- Produces: consistent screenshots for import, search/source tracing, and cited chat

- [x] **Step 1: Capture the three approved workflows**

Use the running application at `http://localhost:3000`, keep a consistent desktop viewport, and avoid exposing credentials or configuration secrets.

- [x] **Step 2: Normalize screenshot framing**

Crop only browser chrome and accidental empty margins. Preserve the full product UI and use the same output width across all screenshots.

- [x] **Step 3: Verify screenshot readability**

Inspect the images at README display width and confirm labels, citations, and source context remain legible.

### Task 4: Write the Canonical English README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all shared assets and verified commands/APIs
- Produces: the default public project entry point

- [x] **Step 1: Write the centered identity block and navigation**

Include the Zleap symbol, SAG name, "Your last knowledge base application", language switch, concise product explanation, original-architecture statement, benchmark proof line, release date, and four-section navigation.

- [x] **Step 2: Write Project and Technology**

Explain the product workflow, distinguish SAG/product/retrieval architecture/`zleap-sag`, link the paper and benchmark repository, embed the paper first page and original architecture, explain event-entity/query-time dynamic hyperedges, and present the SOTA visual plus full 3x3 metric table.

- [x] **Step 3: Write User Guide**

Show the four product workflows, then provide Docker start, first-run model setup, status/update/stop commands, persistence behavior, and the local single-user security warning.

- [x] **Step 4: Write Developer Guide**

Embed the boundary architecture, show the concise directory map, explain frontend/backend separation, document a runnable `zleap-sag` lifecycle and API table, and document the SAG self-hosted API with authentication, REST search/ingest, OpenAI-compatible chat, MCP, and `/docs`.

- [x] **Step 5: Add references and license/contribution links**

Link only to existing destinations and avoid dead community or hosted-service claims.

### Task 5: Write the Complete Chinese Mirror

**Files:**
- Create: `README-CN.md`

**Interfaces:**
- Consumes: `README.md`
- Produces: a structurally identical Chinese document

- [x] **Step 1: Translate by meaning, not sentence shape**

Keep commands, identifiers, metrics, API paths, tables, and image order identical. Use the agreed domain vocabulary in `CONTEXT.md`.

- [x] **Step 2: Compare structure automatically**

Confirm both documents contain the same image references, code fence count, table count, external links, and four top-level sections.

### Task 6: Validate the Delivery

**Files:**
- Modify if needed: `README.md`
- Modify if needed: `README-CN.md`
- Modify if needed: `docs/assets/readme/*`

**Interfaces:**
- Consumes: finished documentation and assets
- Produces: verified branch-ready changes

- [x] **Step 1: Validate links and local paths**

Parse both Markdown files, verify every relative image/file link exists, and request each external HTTP link with redirects enabled.

- [x] **Step 2: Validate commands and API examples**

Run Docker status checks, compile Python examples against the installed `zleap-sag` API without performing paid model calls, and validate HTTP examples against the local OpenAPI schema.

- [x] **Step 3: Render both READMEs for visual QA**

Render at desktop and narrow widths. Verify no clipped tables, oversized headings, broken images, nested-card appearance, or unreadable captions.

- [x] **Step 4: Review scope and worktree safety**

Run `git diff -- README.md README-CN.md CONTEXT.md docs/assets/readme docs/superpowers/plans/2026-07-11-readme-redesign.md` and confirm no existing unrelated application changes were modified.
