import type { Project, Milestone, Task, Subtask, Idea, TimeEntry, ProjectDoc, MarketResearchResult, TechResearchResult } from '../types';

// Backend snake_case -> Frontend camelCase

export function mapMilestoneFromApi(raw: any): Milestone {
  return {
    id: String(raw.id),
    title: raw.title,
    stage: raw.stage,
    targetDate: raw.target_date,
    completed: raw.completed,
    description: raw.description || undefined,
    taskIds: (raw.task_ids || []).map((id: string) => String(id)),
  };
}

export function mapMilestoneToApi(m: Milestone): any {
  return {
    // id omitted on create; backend generates
    ...(m.id && !String(m.id).startsWith('ms-') ? { id: m.id } : {}),
    title: m.title,
    stage: m.stage,
    target_date: m.targetDate,
    completed: m.completed,
    description: m.description || '',
    // order inferred by index
  };
}

export function mapProjectFromApi(raw: any): Project {
  return {
    id: String(raw.id),
    title: raw.title,
    tagline: raw.tagline || '',
    description: raw.description || '',
    problem: raw.problem || '',
    solution: raw.solution || '',
    targetAudience: raw.target_audience || undefined,
    monetization: raw.monetization || undefined,
    mvpFeatures: raw.mvp_features || [],
    tags: raw.tags || [],
    category: raw.category,
    currentStage: raw.current_stage,
    targetDeadline: raw.target_deadline,
    startDate: raw.start_date,
    actualLaunchDate: raw.actual_launch_date || undefined,
    color: raw.color,
    techStack: raw.tech_stack || [],
    repoUrl: raw.repo_url || undefined,
    liveUrl: raw.live_url || undefined,
    figmaUrl: raw.figma_url || undefined,
    directoryPath: raw.directory_path || undefined,
    scriptPath: raw.script_path || undefined,
    cmdDirectory: raw.cmd_directory || undefined,
    pythonEnv: raw.python_env || undefined,
    drive: raw.drive || undefined,
    port: raw.port || undefined,
    notes: raw.notes || undefined,
    initialPrompt: raw.launch_prompt?.content || undefined,
    initializationTool: raw.initialization_tool === 'codex' ? 'codex' : 'opencode',
    initializationModel: raw.initialization_model || undefined,
    initializationReasoningEffort: ['low', 'high'].includes(raw.initialization_reasoning_effort) ? raw.initialization_reasoning_effort : 'medium',
    initializationMode: raw.initialization_mode === 'plan' ? 'plan' : 'build',
    pinned: raw.pinned,
    milestones: (raw.milestones || []).map(mapMilestoneFromApi),
    techResearch: raw.tech_research || undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export function mapLauncherModelPresetFromApi(raw: any) {
  return {
    id: String(raw.id),
    tool: raw.tool === 'codex' ? 'codex' : 'opencode',
    modelId: raw.model_id || '',
    reasoningEffort: ['low', 'high'].includes(raw.reasoning_effort) ? raw.reasoning_effort : 'medium',
    mode: raw.mode === 'plan' ? 'plan' : 'build',
    label: raw.label || '',
    enabled: raw.enabled !== false,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  } as import('../types').LauncherModelPreset;
}

export function mapProjectToApi(p: Partial<Project> & { title: string }): any {
  const out: any = {};
  if (p.title !== undefined) out.title = p.title;
  if (p.tagline !== undefined) out.tagline = p.tagline;
  if (p.description !== undefined) out.description = p.description;
  if (p.problem !== undefined) out.problem = p.problem || '';
  if (p.solution !== undefined) out.solution = p.solution || '';
  if (p.targetAudience !== undefined) out.target_audience = p.targetAudience || '';
  if (p.monetization !== undefined) out.monetization = p.monetization || '';
  if (p.mvpFeatures !== undefined) out.mvp_features = p.mvpFeatures;
  if (p.tags !== undefined) out.tags = p.tags;
  if (p.category !== undefined) out.category = p.category;
  if (p.currentStage !== undefined) out.current_stage = p.currentStage;
  if (p.targetDeadline !== undefined) out.target_deadline = p.targetDeadline;
  if (p.startDate !== undefined) out.start_date = p.startDate;
  if (p.actualLaunchDate !== undefined) out.actual_launch_date = p.actualLaunchDate || null;
  if (p.color !== undefined) out.color = p.color;
  if (p.techStack !== undefined) out.tech_stack = p.techStack;
  if (p.repoUrl !== undefined) out.repo_url = p.repoUrl || '';
  if (p.liveUrl !== undefined) out.live_url = p.liveUrl || '';
  if (p.figmaUrl !== undefined) out.figma_url = p.figmaUrl || '';
  if (p.directoryPath !== undefined) out.directory_path = p.directoryPath || '';
  if (p.scriptPath !== undefined) out.script_path = p.scriptPath || '';
  if (p.cmdDirectory !== undefined) out.cmd_directory = p.cmdDirectory || '';
  if (p.pythonEnv !== undefined) out.python_env = p.pythonEnv || '';
  if (p.drive !== undefined) out.drive = p.drive || '';
  if (p.port !== undefined) out.port = p.port;
  if (p.notes !== undefined) out.notes = p.notes || '';
  if (p.initializationTool !== undefined) out.initialization_tool = p.initializationTool;
  if (p.initializationModel !== undefined) out.initialization_model = p.initializationModel || '';
  if (p.initializationReasoningEffort !== undefined) out.initialization_reasoning_effort = p.initializationReasoningEffort;
  if (p.initializationMode !== undefined) out.initialization_mode = p.initializationMode;
  if (p.pinned !== undefined) out.pinned = p.pinned;
  if (p.techResearch !== undefined) out.tech_research = p.techResearch;
  if (p.milestones !== undefined) out.milestones = p.milestones.map(mapMilestoneToApi);
  return out;
}

export function mapSubtaskFromApi(raw: any): Subtask {
  return { id: String(raw.id), title: raw.title, completed: raw.completed };
}
export function mapSubtaskToApi(s: Subtask): any {
  return {
    ...(s.id && !String(s.id).startsWith('sub-') ? { id: s.id } : {}),
    title: s.title,
    completed: s.completed,
  };
}

export function mapTaskFromApi(raw: any): Task {
  return {
    id: String(raw.id),
    projectId: String(raw.project),
    title: raw.title,
    description: raw.description || undefined,
    stage: raw.stage,
    quadrant: raw.quadrant,
    category: raw.category || 'feature',
    completed: raw.completed,
    dueDate: raw.due_date || undefined,
    estimatedMinutes: raw.estimated_minutes ?? undefined,
    timeSpentMinutes: raw.time_spent_minutes || 0,
    milestoneIds: (raw.milestones || []).map((id: string) => String(id)),
    subtasks: (raw.subtasks || []).map(mapSubtaskFromApi),
    tags: raw.tags || [],
    createdAt: raw.created_at,
    completedAt: raw.completed_at || undefined,
  };
}

export function mapTaskToApi(t: Partial<Task> & { projectId: string; title: string }): any {
  const out: any = {};
  if (t.projectId !== undefined) out.project = t.projectId;
  if (t.title !== undefined) out.title = t.title;
  if (t.description !== undefined) out.description = t.description || '';
  if (t.stage !== undefined) out.stage = t.stage;
  if (t.quadrant !== undefined) out.quadrant = t.quadrant;
  out.category = (t as any).category || 'feature';
  if (t.completed !== undefined) out.completed = t.completed;
  if (t.dueDate !== undefined) out.due_date = t.dueDate || null;
  if (t.estimatedMinutes !== undefined) out.estimated_minutes = t.estimatedMinutes ?? null;
  if (t.milestoneIds !== undefined) out.milestones = t.milestoneIds;
  if (t.tags !== undefined) out.tags = t.tags;
  if (t.subtasks !== undefined) out.subtasks = t.subtasks.map(mapSubtaskToApi);
  return out;
}

export function mapIdeaFromApi(raw: any): Idea {
  return {
    id: String(raw.id),
    title: raw.title,
    tagline: raw.tagline || '',
    problem: raw.problem || '',
    solution: raw.solution || '',
    notes: raw.notes || '',
    category: raw.category,
    status: raw.status,
    sketchDataUrl: raw.sketch_data_url || undefined,
    sketchObjects: raw.sketch_objects || [],
    targetAudience: raw.target_audience || undefined,
    monetization: raw.monetization || undefined,
    mvpFeatures: raw.mvp_features || [],
    tags: raw.tags || [],
    convertedProjectId: raw.converted_project ? String(raw.converted_project) : undefined,
    marketResearch: raw.market_research || undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export function mapIdeaToApi(i: Partial<Idea> & { title: string }): any {
  const out: any = {};
  if (i.title !== undefined) out.title = i.title;
  if (i.tagline !== undefined) out.tagline = i.tagline || '';
  if (i.problem !== undefined) out.problem = i.problem || '';
  if (i.solution !== undefined) out.solution = i.solution || '';
  if (i.notes !== undefined) out.notes = i.notes || '';
  if (i.category !== undefined) out.category = i.category;
  if (i.status !== undefined) out.status = i.status;
  if (i.sketchDataUrl !== undefined) out.sketch_data_url = i.sketchDataUrl || null;
  if (i.sketchObjects !== undefined) out.sketch_objects = i.sketchObjects;
  if (i.targetAudience !== undefined) out.target_audience = i.targetAudience || '';
  if (i.monetization !== undefined) out.monetization = i.monetization || '';
  if (i.mvpFeatures !== undefined) out.mvp_features = i.mvpFeatures;
  if (i.tags !== undefined) out.tags = i.tags;
  if (i.marketResearch !== undefined) out.market_research = i.marketResearch;
  return out;
}

export function mapTimeEntryFromApi(raw: any): TimeEntry {
  return {
    id: String(raw.id),
    projectId: String(raw.project),
    projectTitle: raw.project_title,
    taskId: raw.task ? String(raw.task) : undefined,
    taskTitle: raw.task_title || undefined,
    stage: raw.stage,
    durationSeconds: raw.duration_seconds,
    mode: raw.mode,
    notes: raw.notes || '',
    timestamp: raw.timestamp,
  };
}

export function mapTimeEntryToApi(e: Omit<TimeEntry, 'id'> & { projectId: string }): any {
  return {
    project: e.projectId,
    project_title: e.projectTitle,
    task: e.taskId || null,
    task_title: e.taskTitle || '',
    stage: e.stage,
    duration_seconds: e.durationSeconds,
    mode: e.mode,
    notes: e.notes,
    timestamp: e.timestamp,
  };
}

export function mapProjectDocFromApi(raw: any): ProjectDoc {
  const ids: any[] = Array.isArray(raw.projects) ? raw.projects : [];
  // Django normally serializes the FK as a UUID string, but keep this tolerant
  // of nested filter payloads and legacy `filter_id` responses. This prevents
  // linked skills from losing their category when the API representation
  // differs between endpoints/imported data.
  const rawFilter = raw.filter ?? raw.filter_id ?? null;
  const filterId = rawFilter && typeof rawFilter === 'object'
    ? rawFilter.id ?? null
    : rawFilter;
  const filterName = raw.filter_name ?? (rawFilter && typeof rawFilter === 'object' ? rawFilter.name : null) ?? null;
  const filterSlug = raw.filter_slug ?? (rawFilter && typeof rawFilter === 'object' ? rawFilter.slug : null) ?? null;
  return {
    id: String(raw.id),
    projectIds: ids.map(x => String(x)),
    projectLinks: Array.isArray(raw.project_links)
      ? raw.project_links.map((link: any) => ({ project: String(link.project), active: Boolean(link.active) }))
      : undefined,
    active: typeof raw.active === 'boolean' ? raw.active : null,
    filterId: filterId ? String(filterId) : null,
    filterName,
    filterSlug,
    title: raw.title,
    content: raw.content || '',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export function mapProjectDocToApi(d: {
  projectIds: string[];
  filterId?: string | null;
  title: string;
  content: string;
}): any {
  return {
    projects: d.projectIds,
    filter: d.filterId ?? null,
    title: d.title,
    content: d.content || '',
  };
}
