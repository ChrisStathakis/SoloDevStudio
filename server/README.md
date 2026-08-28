# SoloDev Studio — Django Backend (server/)

Multi-user Django + DRF backend for SoloDev Studio frontend.

## Setup

```bash
cd server
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py createsuperuser  # optional
python manage.py runserver 0.0.0.0:8000
```

## Auth

- POST /api/auth/register/ {username,email,password} -> {user, access, refresh}
- POST /api/auth/login/ {username,password} or {email?} -> {access, refresh}
- POST /api/auth/refresh/ {refresh} -> {access}
- GET /api/auth/me/ (Bearer token)
- All other /api/* require `Authorization: Bearer <access>`

## Core APIs

- Projects: /api/projects/ (nested milestones), POST /api/projects/{id}/advance-stage/
- Milestones: /api/milestones/
- Tasks: /api/tasks/ (nested subtasks), POST /api/tasks/{id}/toggle-complete/, /move-quadrant/
- Ideas: /api/ideas/, POST /api/ideas/{id}/convert/
- TimeEntries: /api/time-entries/ (POST/GET/DELETE only)
- Dashboard: GET /api/dashboard/
- Timeline: GET /api/timeline/?type=&projectId=&search=
- Export/Import: GET /api/export/ , POST /api/import/

## Filtering/Search/Ordering

- ?search= -> SearchFilter on titles/descriptions
- ?stage=, ?category=, ?pinned=, ?projectId= etc via django-filter
- ?ordering=created_at|target_deadline

## CORS

Allowed origins from CORS_ALLOWED_ORIGINS env (default localhost:5173,3000,5174).
