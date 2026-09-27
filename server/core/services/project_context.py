"""Selectable project/phase context builder shared by CMD, files, and the orchestrator.

One builder backs three delivery layers (terminal env vars, `.solodev/`
context files, paste-into-CMD) plus the orchestrator's optional
goal-plus-phases mode, so every consumer passes the same selected stages
and sections.
"""
import json
import os
import subprocess
from pathlib import Path

CONTEXT_SECTIONS = ('brief', 'checklists', 'tasks', 'blockers', 'notes', 'skills', 'git')
DEFAULT_SECTIONS = list(CONTEXT_SECTIONS)
DEFAULT_MAX_CHARS = 12000
ABSOLUTE_MAX_CHARS = 60000


def parse_stages(raw, current_stage, valid_stages):
    if raw is None or str(raw).strip() == '':
        return [current_stage] if current_stage in valid_stages else list(valid_stages)
    value = str(raw).strip().lower()
    if value == 'all':
        return list(valid_stages)
    if value == 'current':
        return [current_stage] if current_stage in valid_stages else list(valid_stages)
    selected = []
    for part in str(raw).split(','):
        stage = part.strip().lower()
        if not stage:
            continue
        if stage not in valid_stages:
            raise ValueError(f'Unknown stage: {part.strip()}.')
        if stage not in selected:
            selected.append(stage)
    if not selected:
        raise ValueError('Select at least one stage.')
    ordered = [stage for stage in valid_stages if stage in selected]
    return ordered or selected


def parse_sections(raw):
    if raw is None or str(raw).strip() == '':
        return list(DEFAULT_SECTIONS)
    selected = []
    for part in str(raw).split(','):
        section = part.strip().lower()
        if not section:
            continue
        if section not in CONTEXT_SECTIONS:
            raise ValueError(f'Unknown section: {part.strip()}.')
        if section not in selected:
            selected.append(section)
    if not selected:
        raise ValueError('Select at least one section.')
    return [section for section in CONTEXT_SECTIONS if section in selected]


def parse_max_chars(raw):
    if raw is None or str(raw).strip() == '':
        return DEFAULT_MAX_CHARS
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        raise ValueError('max_chars must be a number.')
    return max(500, min(value, ABSOLUTE_MAX_CHARS))


def _git_snapshot(directory):
    snapshot = {'is_repo': False, 'branch': '', 'remote': '', 'dirty_count': 0}
    if not directory or not os.path.isdir(directory):
        return snapshot
    try:
        toplevel = subprocess.run(
            ['git', '-C', directory, 'rev-parse', '--show-toplevel'],
            text=True, capture_output=True, timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return snapshot
    if toplevel.returncode != 0:
        return snapshot
    root = (toplevel.stdout or '').strip() or directory
    snapshot['is_repo'] = True
    try:
        branch = subprocess.run(
            ['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'],
            text=True, capture_output=True, timeout=15,
        )
        if branch.returncode == 0:
            snapshot['branch'] = (branch.stdout or '').strip()
        remote = subprocess.run(
            ['git', '-C', root, 'remote', 'get-url', 'origin'],
            text=True, capture_output=True, timeout=15,
        )
        if remote.returncode == 0:
            snapshot['remote'] = (remote.stdout or '').strip()
        porcelain = subprocess.run(
            ['git', '-C', root, 'status', '--porcelain=v1'],
            text=True, capture_output=True, timeout=15,
        )
        if porcelain.returncode == 0:
            snapshot['dirty_count'] = len([l for l in (porcelain.stdout or '').splitlines() if l.strip()])
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return snapshot


def build_project_context(project, user, stages, sections, max_chars=DEFAULT_MAX_CHARS):
    from ..models import ProjectAgentLink, StageReview, StageWorkspace, Task, TimeEntry
    from ..pathutils import normalize_path

    lines = []
    if 'brief' in sections:
        lines.append(f'# {project.title}')
        if project.tagline:
            lines.append(f'> {project.tagline.strip()}')
        lines.append('')
        lines.append(f'- Stage: {project.get_current_stage_display()} ({project.current_stage})')
        lines.append(f'- Category: {project.get_category_display()}')
        if project.target_deadline:
            lines.append(f'- Deadline: {project.target_deadline.isoformat()}')
        if project.tech_stack:
            lines.append(f'- Stack: {", ".join(str(t) for t in project.tech_stack)}')
        if project.mvp_features:
            lines.append('- MVP:')
            for feature in list(project.mvp_features)[:10]:
                lines.append(f'  - {feature}')
        if project.notes and len(str(project.notes)) < 2000:
            lines.append('')
            lines.append('## Project notes')
            lines.append(str(project.notes).strip()[:2000])
        lines.append('')

    workspaces = {
        str(workspace.stage): workspace
        for workspace in StageWorkspace.objects.filter(project=project, stage__in=stages)
    }
    project_tasks = list(
        Task.objects.filter(project=project, stage__in=stages)
        .prefetch_related('subtasks')
        .order_by('completed', '-created_at')[:200]
    )
    tasks_by_stage = {}
    for task in project_tasks:
        tasks_by_stage.setdefault(task.stage, []).append(task)
    time_by_stage = {}
    for row in (
        TimeEntry.objects.filter(project=project, stage__in=stages).values('stage', 'duration_seconds')
    ):
        time_by_stage[row['stage']] = time_by_stage.get(row['stage'], 0) + (row['duration_seconds'] or 0)
    reviews = {
        str(review.stage): review
        for review in StageReview.objects.filter(project=project, stage__in=stages).order_by('-reviewed_at')
    }
    # Keep the newest review per stage (ordered query above puts newest first).
    seen_review_stages = set()
    for stage in list(reviews):
        if stage in seen_review_stages:
            del reviews[stage]
        else:
            seen_review_stages.add(stage)
    milestones_by_stage = {}
    for milestone in project.milestones.filter(stage__in=stages).order_by('order', 'target_date'):
        milestones_by_stage.setdefault(milestone.stage, []).append(milestone)

    for stage in stages:
        workspace = workspaces.get(stage)
        stage_tasks = tasks_by_stage.get(stage, [])
        open_tasks = [task for task in stage_tasks if not task.completed]
        blocked = [task for task in stage_tasks if (task.blocker_reason or '').strip()]
        completed_items = set((workspace.completed_items if workspace else []) or [])
        checklist = list((workspace.checklist if workspace else []) or [])
        shaping = list((workspace.shaping_checklist if workspace else []) or [])
        marker = ' [current]' if stage == project.current_stage else ''
        stage_lines: list[str] = []
        if 'brief' in sections and workspace and workspace.guidance:
            stage_lines.append(str(workspace.guidance).strip())
        if 'checklists' in sections and (checklist or shaping):
            done = sum(1 for item in checklist + shaping if item.get('id') in completed_items)
            stage_lines.append(f'- Checklist: {done}/{len(checklist + shaping)}')
            for item in (checklist + shaping)[:20]:
                box = 'x' if item.get('id') in completed_items else ' '
                stage_lines.append(f'  - [{box}] {item.get("label", "")}')
        if 'tasks' in sections:
            stage_lines.append(f'- Tasks: {len(stage_tasks) - len(open_tasks)}/{len(stage_tasks)} done')
            for task in open_tasks[:8]:
                stage_lines.append(f'  - [ ] {task.title}')
                for sub in list(task.subtasks.all())[:5]:
                    stage_lines.append(f'    - [{"x" if sub.completed else " "}] {sub.title}')
        if 'blockers' in sections and blocked:
            stage_lines.append('- Blockers:')
            for task in blocked[:8]:
                stage_lines.append(f'  - {task.title}: {task.blocker_reason.strip()}')
                if (task.blocker_next_action or '').strip():
                    stage_lines.append(f'    Next: {task.blocker_next_action.strip()}')
        stage_milestones = milestones_by_stage.get(stage, [])
        if stage_milestones and ('tasks' in sections or 'checklists' in sections):
            pending = [m for m in stage_milestones if not m.completed]
            stage_lines.append(f'- Milestones: {len(stage_milestones) - len(pending)}/{len(stage_milestones)} done')
            for milestone in pending[:5]:
                stage_lines.append(f'  - [ ] {milestone.title} ({milestone.target_date.isoformat()})')
        seconds = time_by_stage.get(stage, 0)
        if seconds:
            stage_lines.append(f'- Time logged: {seconds / 3600:.1f}h')
        review = reviews.get(stage)
        if review and review.note and ('notes' in sections or 'brief' in sections):
            stage_lines.append(f'- Review ({review.decision}): {review.note.strip()[:500]}')
        if 'notes' in sections and workspace and (workspace.notes or '').strip():
            stage_lines.append(f'- Notes: {str(workspace.notes).strip()[:1500]}')
        if stage_lines:
            lines.append(f'## Phase: {stage}{marker}')
            lines.extend(stage_lines)
            lines.append('')

    if 'skills' in sections:
        links = list(
            ProjectAgentLink.objects.filter(project=project, active=True, agent__owner=user)
            .select_related('agent__filter')[:20]
        )
        if links:
            lines.append('## Active skills')
            for link in links:
                suffix = f' ({link.agent.filter.name})' if link.agent.filter else ''
                lines.append(f'- {link.agent.title}{suffix}')
            lines.append('')

    if 'git' in sections:
        from ..pathutils import normalize_path as _normalize
        snapshot = _git_snapshot(_normalize(project.directory_path) or _normalize(project.cmd_directory))
        lines.append('## Git')
        if snapshot['is_repo']:
            lines.append(f'- Branch: {snapshot["branch"] or "unknown"}')
            lines.append(f'- Dirty files: {snapshot["dirty_count"]}')
            if snapshot['remote']:
                lines.append(f'- Remote: {snapshot["remote"]}')
        else:
            lines.append('- Not a git repository')
        lines.append('')

    markdown = '\n'.join(lines).strip() + '\n'
    truncated = False
    if len(markdown) > max_chars:
        markdown = markdown[:max_chars].rstrip() + '\n\n…(truncated to max_chars)\n'
        truncated = True
    return {
        'stages': list(stages),
        'sections': list(sections),
        'markdown': markdown,
        'chars': len(markdown),
        'truncated': truncated,
        'max_chars': max_chars,
    }


def write_context_files(directory, markdown, payload):
    target_dir = Path(directory)
    target_dir.mkdir(parents=True, exist_ok=True)
    solodev_dir = target_dir / '.solodev'
    solodev_dir.mkdir(parents=True, exist_ok=True)
    context_md = solodev_dir / 'context.md'
    context_json = solodev_dir / 'context.json'
    context_md.write_text(markdown, encoding='utf-8')
    context_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'context_md': str(context_md), 'context_json': str(context_json)}
