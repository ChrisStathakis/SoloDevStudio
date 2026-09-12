# User guide

## Start here: sign in and choose a page

Open SoloDev Studio in the browser or Windows desktop app, then choose **Create account** or **Log in**. After sign-in, your workspace is scoped to your account. Use the main navigation to move between Dashboard, Projects, Priority Matrix, Idea Canvas, Focus & Timer, Timeline, and Settings.

The desktop sidebar can collapse to an icon rail, and the browser/mobile layout exposes the primary pages in a bottom bar with a **More** menu. Use the global search field to find matching projects, tasks, ideas, and documentation. The theme button switches between light and dark mode.

## Projects

Use **Projects** to create and run a project. Select **New Project**, enter a title, and add dates, category, stage, description, tech stack, links, and notes. Open a project to use its tabs: **Summary**, **Lifecycle**, **Configuration**, **Tasks**, **Milestones & Roadmap**, **Time Sessions**, **Documentation**, and **Initial Prompt**.

Projects at **Live & Shipped** appear in a collapsed **Completed apps** section at the bottom of the Projects page. Expand it to review finished apps; selecting the **Live & Shipped** filter opens the section automatically.

### Initial prompt preview and launch

The **Initial Prompt** tab stores the project's base prompt. Select **Preview prompt** to generate and inspect the complete initialization prompt before launching an agent. The preview includes the saved base prompt and the currently active project skills. It opens in a read-only dialog where the full text can be selected or copied; an error is shown if the preview cannot be generated.

Use **Initialize** to choose a supported CLI, model, reasoning effort, and (for Codex) Build or Plan mode. The desktop app copies the selected project or task prompt as a fallback, opens the CLI in the configured project folder, waits for its composer to become ready, and then pastes the prompt for your review. Press Enter in the CLI to submit it. If Codex stops at its directory-trust question, press Enter in the console to confirm it yourself — the app never answers trust prompts for you, and the prompt pastes automatically once the composer opens. If the composer never becomes ready, paste manually from the clipboard with Ctrl+V. Codex Plan mode activates the CLI's read-only `/plan` workflow; OpenCode reasoning variants remain provider-specific.

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

Large pastes are sent in pieces with a progress readout in the console status bar. Ctrl+V, Ctrl+Shift+V, and right-click Paste all target the active console, even when it is not focused. Pasting a long agent-style prompt into a plain CMD console asks for confirmation first, since the shell would otherwise run it line-by-line.

Folder, Explorer, CMD, script, virtual-environment, and drive actions require Windows. In a browser, you can still save project configuration and use the rest of the workspace, but local process and filesystem actions are unavailable.

## Tasks and milestones

Tasks have a project, title, description, stage, priority quadrant, category, due date, estimate, tags, subtasks, and completion state. A task may be linked to zero, one, or multiple milestones in the same project.

Milestones are independently managed records with a title, description, stage, target date, order, completion state, and linked-task checklist. Use **Add milestone**, edit, or delete from **Milestones & Roadmap**. Deleting a milestone removes its task links but does not delete tasks. Completing linked tasks updates progress display only; it does not auto-complete the milestone.

The Priority Matrix groups work into Do First, Schedule & Deep Work, Quick Wins / Streamline, and Backlog & Evaluate. Tasks can be moved between quadrants without changing their completion state.

Use **Add Task** from Projects or quick add, then set the project, stage, category, priority quadrant, estimate, due date, tags, description, and optional subtasks. Mark a task complete when the work is finished; use **Focus** on a task to start an attached timer.

## Stage Workspace

Each project has a **Stage Workspace** tab immediately before Skills. Use the stage selector to review any of the seven stages without changing the project's current stage. Guidance, tasks, metrics, notes, and both checklist groups follow the selected stage. Checklist checks save immediately; use **Edit** for either group to add, rename, reorder, or remove items with explicit Save/Cancel. **Apply my defaults** replaces the selected project's lists after confirmation. Notes use **Save notes** and retain the draft if a save fails. Workspace notes are private planning context and are not included in coding-agent prompts.

Every Stage Workspace also includes an optional **Shaping the build** section. Use it to practise the four build-shaping habits: drive a build → inspect → learn → adjust loop, make product decisions and tradeoffs explicit, communicate progress and handoff context, and keep ownership through release and live feedback. Its checklist is separate from the stage checklist and never blocks stage changes. Use the prompts as reflection questions in the existing stage notes; in Development, checking the loop item means you have applied one iteration, not that the project is finished iterating.

Settings → **Checklist defaults** lets you edit the starting lists for each stage and restore the built-in lists. Defaults affect new projects and future idea conversions; existing projects keep their own lists until you apply them from Stage Workspace. A completed item keeps its completion when its ID and label are unchanged.

## Ideas and sketches

Ideas move through Spark, Evaluating, Validated, Converted, and Archived states. Capture a problem, solution, audience, monetization, MVP features, tags, notes, and optional market research.

The sketch editor supports freehand paths, shapes, arrows, lines, text, multi-selection, undo/redo, pan, zoom, export, and vector-object persistence. **Expand** opens an in-app fullscreen workspace without resetting the camera, selection, undo history, or unsaved draft; Escape exits when text is not being edited. Saving is asynchronous and keeps the editor open with the draft when the API reports an error.

### Launching an idea

Use **Launch to project** from an idea card or detail view. The conversion creates a project, default milestones, MVP tasks, and a read-only initial coding-agent prompt assembled from the meaningful idea fields. The new project's **Initial Prompt** tab lets you select the prompt and copy it with immediate feedback. A sketch is referenced by a note in the prompt rather than embedding its image or vector data.

## Dashboard, focus, and timeline

Dashboard is the daily starting point. **Today's focus** holds an ordered selection of tasks with Start, Open, Complete, reorder, and carry-forward actions; it has no imposed three-task limit. Tasks can record a blocker reason and concrete next action, and completing a task clears its blocker. Review active projects, pipeline stages, priority work, focus time, recent sessions, and overdue work. In Stage Workspace, **Stage review** snapshots tasks, blockers, milestones, and both checklists with a Continue working or Ready to advance decision; advancement remains explicit.

Focus & Timer supports Pomodoro and stopwatch modes, optional project/task assignment, notes, session history, and analytics. Use **Manual Time Log** for work completed outside the timer, **Pause** to hold a session, and **Complete & Log** to save it. In the Windows desktop app, Settings → Desktop enables the SoloDev companion by default. Minimize the main window to show the indigo robot with the active task/timer, Pause/Resume, and Start focus controls. Drag it to reposition; it hides when the app is restored and exits when the app closes.

Timeline groups project launches, milestone dates, and task due dates by urgency. Search or filter by event type and project, then use **Export ICS** to add the visible deadlines to a calendar.

## Documentation and settings

Project docs are Markdown-like text records that can be linked to multiple projects and an optional agent filter. In **Settings**, use **Idea categories** to add, rename, or remove categories shown in Idea Canvas. The original categories are kept during the upgrade, and a category with assigned ideas cannot be deleted until those ideas are moved elsewhere. Settings also manages skills, launch presets, the project folder, the optional desktop API port, backups, and your account. **Export JSON Backup** downloads a snapshot; **Restore JSON Backup** imports new records and remaps relationships. **Purge all workspace data** removes the signed-in owner’s workspace records and saved project folder while preserving the account and app preferences.

## Recommended end-to-end workflow

1. Capture a rough concept in **Idea Canvas** and move it from Spark to Evaluating or Validated as you learn more.
2. Select **Launch to project** when the idea is ready. Review the generated project, milestones, MVP tasks, and initial prompt.
3. In **Projects**, configure the stage, dates, local folder, and optional script or virtual environment.
4. Break the work into tasks and milestones, then use **Priority Matrix** to decide what to do first.
5. Preview the **Initial Prompt**, choose the CLI/model settings, and initialize the project or launch an individual task prompt.
6. Work in **Focus & Timer**, attaching sessions to the relevant project and task. Add manual entries when needed.
7. Review **Dashboard** for progress and **Timeline** for upcoming launches, milestones, and deadlines.
8. Keep decisions in linked project docs, export a backup periodically, and use the generated documentation site for reference.
## Desktop CMD consoles

Open a project's **CMD** action to work inside SoloDev Studio. It uses the CMD
directory when configured, otherwise the project folder. A configured Python
environment is activated automatically. **Run Server** runs the saved batch
script in the same terminal interface and keeps its output and prompt available.
Use the terminal's stop control to stop a session and its child processes.

Desktop builds include Python and the terminal runtime; users do not need to
install Python or pywinpty to open CMD. Project-specific tools such as Node.js,
Git, or a project's Python environment are separate dependencies. Their setup
commands and interactive prompts can be used inside the console.
