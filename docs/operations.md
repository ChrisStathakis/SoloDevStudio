# Operations

## Configuration

Backend settings use `python-decouple` and read these environment variables:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | Django signing key; use a private production value. |
| `DEBUG` | Enables or disables Django debug behavior. |
| `ALLOWED_HOSTS` | Comma-separated Django host allowlist. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API. |
| `APP_URL` | Application base URL used by local configuration. |

The frontend reads `VITE_API_URL` for the Django API base and `GEMINI_API_KEY` only for research calls made by `frontend/server.ts`. Do not commit `.env` files or expose keys in logs.

## Database and migrations

From `server/`:

```powershell
python manage.py makemigrations
python manage.py migrate
python manage.py check
```

Use `makemigrations` only when intentionally changing Django models. Normal startup needs `migrate`, not a new migration. The local database is `server/db.sqlite3`.

## Backups

Use the authenticated **Export** action in Settings or call `GET /api/export/` to create a JSON snapshot. Import it through Settings or `POST /api/import/`. Imports create new records rather than replacing existing data; project, milestone, task, prompt, and document relationships are remapped. Keep exported files private because they contain workspace content.

## Frontend checks and production build

TypeScript checking:

```powershell
npm --prefix frontend run lint
```

Production bundle:

```powershell
npm --prefix frontend run build
```

The frontend build outputs the browser assets and bundles the local Express server into `frontend/dist/`. Run the Django test suite from `server/` with `python manage.py test`.

## MkDocs site

Install the documentation-only dependency and build the flat site:

```powershell
pip install -r requirements-docs.txt
mkdocs build --strict
```

The configured output directory is `site/`, with pages such as `site/index.html`, `site/getting-started.html`, and `site/api-reference.html`. The configuration uses `use_directory_urls: false`, so documentation pages are not emitted as `page/index.html` directories.

## Known limitations

- CMD, script execution, PTY input, and Explorer opening depend on Windows capabilities and local permissions.
- Saved paths are configuration strings; existence is checked only when an action uses the path.
- Research endpoints need a configured Gemini key and an available upstream service; core project management does not.
- The application uses local SQLite persistence and is not documented here as a multi-instance production deployment.
