# Architecture

## Application shape

SoloDev Studio has two cooperating local services:

```text
Browser
  └─ React + Vite/Express frontend (localhost:3000 or 5174)
       └─ Axios / fetch requests
            └─ Django + Django REST Framework API (localhost:8001)
                 └─ SQLite database (server/db.sqlite3)
```

The frontend keeps the active view in React context rather than URL routing. `AppContext` owns projects, tasks, milestones, ideas, time entries, import/export, and timer state. `AuthContext` owns JWT tokens and session restoration. Component-level views implement Dashboard, Projects, Ideas, Matrix, Focus, Timeline, Settings, sketches, docs, path picking, and terminals.

## Backend modules

- `server/config/` contains Django settings, URL inclusion, WSGI, and ASGI configuration.
- `server/core/models.py` defines the owner-scoped domain: users, projects, milestones, tasks, subtasks, ideas, launch prompts, filters, project docs, and time entries.
- `server/core/serializers.py` validates request data and maps nested milestones, subtasks, milestone IDs, and nullable launch prompts.
- `server/core/views.py` provides resource viewsets, project actions, idea conversion, dashboard/timeline aggregation, export/import, and filesystem browsing.
- `server/core/terminal_views.py` exposes project terminal creation, listing, input, resize, output streaming, and deletion.
- `server/core/services/terminal_manager.py` owns live PTY processes and enforces one live CMD and one live script session per owner/project/mode.

## Data ownership and relationships

Every project, idea, task, time entry, and project document is filtered by the authenticated owner. A project owns milestones and tasks. Tasks own subtasks and may have a many-to-many relationship with milestones. `ProjectLaunchPrompt` is optional and one-to-one with a project; manually created and older projects may have no prompt.

Idea conversion and its project, prompt, milestones, tasks, and status update run in one database transaction. Export/import preserves prompt content and milestone links while assigning new IDs to imported records.

## Authentication and transport

The API uses JWT bearer authentication. The frontend sends `Authorization: Bearer <access-token>` and refreshes expired access tokens using the stored refresh token. CORS origins are configured from the backend environment. Terminal output is consumed with an authenticated NDJSON stream because it is long-lived rather than a normal JSON response.

## Frontend server and research endpoints

`frontend/server.ts` serves the Vite application in development and exposes the optional Gemini-backed market and tech-stack research endpoints. Those endpoints require `GEMINI_API_KEY`; the Django API does not need that key for normal project management.

## Persistence and migrations

SQLite is configured at `server/db.sqlite3`. Django migrations are stored under `server/core/migrations/`. Run `python manage.py migrate` after pulling schema changes. The frontend maps backend snake_case fields to its camelCase domain types in `frontend/src/services/mappers.ts`.
