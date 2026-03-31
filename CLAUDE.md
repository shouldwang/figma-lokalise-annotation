# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # Compile TypeScript → code.js (one-time)
npm run watch       # Compile in watch mode during development
npm run lint        # ESLint check
npm run lint:fix    # ESLint auto-fix
```

> There are no automated tests. Loading the plugin in Figma (desktop app) is the only way to test it.

## Architecture

This is a **Figma plugin** with two UI panels and one plugin backend:

| File | Role |
|------|------|
| `code.ts` | Plugin backend (runs in Figma's sandbox). Compiled to `code.js`. |
| `annotate-ui.html` | Primary UI — annotate/create/update keys (command: `annotate-lokalise`) |
| `get-list.html` | Secondary UI — manage/export key list (command: `get-lokalise-list`) |
| `manifest.json` | Plugin entry point, declares UI files and menu commands |

### Communication model

UI and backend communicate exclusively via `figma.ui.postMessage` (UI → plugin) and `figma.ui.on("message", ...)` (plugin → UI). All message types and their payloads are documented in `SPEC.md` per user story.

### Persistence

- **`figma.clientStorage`** — cross-file persistent settings (bound component keys, language settings, project options)
- **`figma.currentPage.getPluginData / setPluginData`** — per-page annotation index (UUID → Node ID map, stored under key `annotationIndex`)
- **Node plugin data** — per-annotation metadata stored on each ComponentInstance node (`uuid`, `targetId`, `keyName`, `projectName`, `direction`, `exist`, `annotationType`, `componentKey`)

### Key concepts

- **Annotation component**: A Figma ComponentSet with 4 direction variants (Top/Bottom/Left/Right), a `projectName` text property, a `keyName` text property, and an `exist` indicator. Must be bound before creating annotations.
- **Annotation index**: A UUID→NodeID map stored as JSON in page plugin data. Used to look up annotation nodes by UUID without scanning the whole page.
- **Positioning algorithm**: For each annotation, calculates the Text node's absolute position, measures gap to its parent container in the requested direction, then places the annotation at `max(gap * 0.4, 60px)` away. See `SPEC.md` for full algorithm.
- **`annotationType === "component"`**: The marker used to identify annotation nodes when scanning the page (e.g., during re-align or list operations).

### CSV export

CSV generation runs entirely in the UI (`get-list.html`), not in the plugin backend. It uses `JSZip` (loaded from cdnjs.cloudflare.com) for multi-project ZIP export. Language columns come from `languageSettings` stored in clientStorage.

### Key validation regex

`/^[A-Za-z0-9\-\_\.]+$/` — only alphanumeric, `-`, `_`, `.` are allowed in key names.
