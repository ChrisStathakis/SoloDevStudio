# User guide

## Navigation and workspace state

After authentication, the shell provides Dashboard, Projects, Ideas, Priority Matrix, Focus & Timer, Timeline, and Settings. The desktop sidebar can collapse to an icon rail; its state is stored in `solodev_sidebar_collapsed`. Theme preference is retained separately. On smaller screens, the bottom navigation exposes the primary destinations and a More menu.

## Projects

Create a project with a title, dates, category, stage, description, tech stack, links, notes, and optional local development settings. Project details are organized into summary, lifecycle, configuration, tasks, milestones, time sessions, documentation, and Initial Prompt tabs.

### Local paths and consoles

Project configuration accepts a folder path, `.bat`/`.cmd` script path, CMD directory, Python environment, drive letter, and optional port or script arguments.

- Type a path or use Browse, then explicitly choose **Save Path**.
- Folder and script paths are stored even if the target does not currently exist.
- **Open Folder** validates that the directory exists and opens it in Windows Explorer.
- **CMD** opens a project-scoped interactive shell in the configured directory, falling back to the project folder when appropriate.
- **Run Server** starts the configured batch or command script and applies the configured arguments and virtual-environment path.
- Reopening the same CMD or script console reuses the live session for that project and mode.
- Changing a saved CMD directory replaces only that project's live CMD session; a server/script console is left running.

The terminal drawer shows only sessions for the selected project. Stopping an inactive tab does not tear down the active tab.

## Tasks and milestones

Tasks have a project, title, description, stage, priority quadrant, category, due date, estimate, tags, subtasks, and completion state. A task may be linked to zero, one, or multiple milestones in the same project.

Milestones are independently managed records with a title, description, stage, target date, order, completion state, and linked-task checklist. Use **Add milestone**, edit, or delete from **Milestones & Roadmap**. Deleting a milestone removes its task links but does not delete tasks. Completing linked tasks updates progress display only; it does not auto-complete the milestone.

The Priority Matrix groups work into Do First, Schedule & Deep Work, Quick Wins / Streamline, and Backlog & Evaluate. Tasks can be moved between quadrants without changing their completion state.

## Ideas and sketches

Ideas move through Spark, Evaluating, Validated, Converted, and Archived states. Capture a problem, solution, audience, monetization, MVP features, tags, notes, and optional market research.

The sketch editor supports freehand paths, shapes, arrows, lines, text, multi-selection, undo/redo, pan, zoom, export, and vector-object persistence. **Expand** opens an in-app fullscreen workspace without resetting the camera, selection, undo history, or unsaved draft; Escape exits when text is not being edited. Saving is asynchronous and keeps the editor open with the draft when the API reports an error.

### Launching an idea

Use **Launch to project** from an idea card or detail view. The conversion creates a project, default milestones, MVP tasks, and a read-only initial coding-agent prompt assembled from the meaningful idea fields. The new project's **Initial Prompt** tab lets you select the prompt and copy it with immediate feedback. A sketch is referenced by a note in the prompt rather than embedding its image or vector data.

## Dashboard, focus, and timeline

Dashboard summarizes active projects, pipeline stages, priority work, focus time, recent sessions, and overdue work. Focus & Timer supports Pomodoro and stopwatch modes, optional project/task assignment, notes, session history, and analytics. Timeline groups project launches, milestone dates, and task due dates by urgency and supports search, type, and project filters.

## Documentation and settings

Project docs are Markdown-like text records that can be linked to multiple projects and an optional agent filter. Settings manages filters, account actions, and backup import/export. Export produces a JSON snapshot; import creates new records and remaps project, milestone, task, and prompt relationships.
