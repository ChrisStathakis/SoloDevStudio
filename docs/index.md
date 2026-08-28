# SoloDev Studio

SoloDev Studio is a local-first workspace for turning ideas into shipped software. The React interface brings projects, tasks, milestones, ideas, sketches, time tracking, deadlines, documentation, and local development terminals into one authenticated workspace. A Django REST API stores user-owned data in SQLite.

## What you can do

- Track projects through seven lifecycle stages, from ideation to live and shipped.
- Capture ideas, research notes, sketches, and MVP features, then launch an idea as a project.
- Generate and copy the saved initial coding-agent prompt created during idea conversion.
- Break project work into tasks, subtasks, priority-matrix quadrants, and independently completed milestones.
- Link a task to zero, one, or several milestones.
- Configure project folders, script paths, CMD directories, virtual environments, drives, and run arguments.
- Open isolated in-app CMD and script consoles on Windows.
- Record Pomodoro, stopwatch, and manual time entries and review timeline deadlines.
- Keep project documentation linked to one or more projects and optional agent filters.
- Export and import workspace data.

## Read next

- Follow [Getting started](getting-started.md) to run the local app.
- Use the [User guide](user-guide.md) for feature workflows.
- See the [Architecture](architecture.md) page for the major modules and data ownership rules.
- Use the [API reference](api-reference.md) when integrating with the backend.
- Review [Operations](operations.md) for configuration, backups, checks, and limitations.

## Scope and limitations

The current project is designed as a local development tool. Filesystem browsing, folder opening, CMD sessions, and script consoles are Windows-oriented; configured paths may be saved before they exist, but opening or running them validates the path at that time. Keep credentials and other secrets in local environment files and do not commit them.
