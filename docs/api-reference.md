# API reference

The Django API is mounted below `/api/`. Except for health and authentication endpoints, requests require `Authorization: Bearer <access-token>`. JSON uses the backend's snake_case field names.

## Authentication

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health/` | Service health check. |
| POST | `/api/auth/register/` | Create a user from `username`, `email`, and `password`. |
| POST | `/api/auth/login/` | Return `access` and `refresh` JWTs. |
| POST | `/api/auth/refresh/` | Exchange a refresh token for a new access token. |
| GET | `/api/auth/me/` | Return the authenticated user. |

## Resource endpoints

DRF router resources support the usual list, retrieve, create, update/partial update, and delete methods unless noted otherwise:

| Resource | Endpoint | Important fields or behavior |
| --- | --- | --- |
| Projects | `/api/projects/` | Dates, lifecycle stage, links, local paths, environment, notes, milestones, and nullable `launch_prompt`. |
| Milestones | `/api/milestones/` | Title, stage, target date, description, order, completion, and computed `task_ids`. |
| Tasks | `/api/tasks/` | Project, stage, quadrant, category, completion, dates, estimates, subtasks, tags, and `milestones` UUID list. |
| Ideas | `/api/ideas/` | Idea fields, status, sketch data/objects, tags, research, and `converted_project`. |
| Time entries | `/api/time-entries/` | Project/task, stage, duration, mode, notes, and timestamp. Only GET, POST, and DELETE are enabled. |
| Project docs | `/api/docs/` | Content linked to many projects and optionally an agent filter. |
| Agent filters | `/api/agent-filters/` | Name, generated slug, and order. |

List responses use standard DRF pagination (`count`, `next`, `previous`, `results`). The frontend commonly requests `page_size=100` for workspace collections.

## Actions

| Method | Endpoint | Request / result |
| --- | --- | --- |
| POST | `/api/projects/{id}/advance-stage/` | `{ "nextStage": "development" }`; returns the updated project. |
| POST | `/api/projects/{id}/open-folder/` | Opens the validated configured directory on Windows. |
| POST | `/api/projects/{id}/run-script/` | Runs the configured `.bat`/`.cmd` script with optional arguments and virtual environment. |
| POST | `/api/projects/{id}/open-cmd/` | Opens a validated Windows CMD directory. |
| GET | `/api/projects/{id}/initialize-prompt/` | Returns the generated full-project initialization prompt. The response contains `content`, the saved `initial_prompt`, and the active linked skills. |
| PUT/PATCH | `/api/milestones/{id}/tasks/` | `{ "task_ids": ["task-uuid", ...] }`; atomically replaces links. |
| POST | `/api/tasks/{id}/toggle-complete/` | Toggles completion and timestamp. |
| POST | `/api/tasks/{id}/move-quadrant/` | `{ "quadrant": "q1_do" }`. |
| POST | `/api/tasks/{id}/subtasks/` | `{ "title": "..." }`; creates a subtask. |
| POST/PATCH | `/api/tasks/{id}/subtasks/{sub_id}/toggle/` | Toggles a subtask. |
| POST | `/api/ideas/{id}/convert/` | Creates the project, launch prompt, milestones, MVP tasks, and conversion state transactionally. |

## Workspace endpoints

- `GET /api/dashboard/` returns aggregate project, task, time, and recent-session metrics.
- `GET /api/timeline/` returns launch, milestone, and task deadline items. Query with `search`, `type`, and `projectId` (or `project`).
- `GET /api/export/` returns a versioned JSON snapshot.
- `POST /api/import/` imports a snapshot and remaps IDs and relationships.
- `POST /api/workspace/reset/` atomically removes the signed-in owner’s workspace records and saved project root. The response is `{ "success": true, "deleted": { "projects": n, "tasks": n, "ideas": n, "timeEntries": n, "docs": n, "modelPresets": n } }`.
- `/api/idea-categories/` supports authenticated list, create, rename, and delete operations for the shared Idea Canvas catalog. Its `name` is the value used by `/api/ideas/`; deletion returns `409` while any idea still uses the category.
- `GET /api/filesystem/?path=<directory>` lists local drives or directory entries for the path picker. It is read-only.

## Terminal endpoints

- `POST /api/projects/{id}/terminals/` with `{ "mode": "cmd" | "script", "cols": 110, "rows": 28 }` creates or reuses a project/mode session. The response includes `reused`.
- `GET /api/terminals/?project={project-uuid}&alive=true` lists sessions for one project.
- `GET /api/terminals/{session-id}/output/?after=<cursor>` streams NDJSON events (`d` data, `t` cursor, `e` exit, `p` keep-alive, and related lifecycle markers).
- `POST /api/terminals/{session-id}/input/` with `{ "data": "..." }` writes to the selected session.
- `POST /api/terminals/{session-id}/resize/` with integer `cols` and `rows` resizes it.
- `DELETE /api/terminals/{session-id}/` stops only that owner’s selected session.

Terminal and filesystem actions return useful 4xx/5xx errors for missing paths, unsupported platforms, invalid modes, unavailable sessions, and validation failures. Paths are not required to exist when saved, but action endpoints validate them before use.
