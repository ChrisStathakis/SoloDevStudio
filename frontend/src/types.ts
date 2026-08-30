export type ProjectStage = 
  | 'ideation' 
  | 'planning' 
  | 'architecture' 
  | 'development' 
  | 'testing' 
  | 'deployment' 
  | 'live';

export type PriorityQuadrant = 
  | 'q1_do'         // Urgent & Important
  | 'q2_schedule'   // Not Urgent & Important
  | 'q3_delegate'   // Urgent & Not Important (Quick Wins / Delegate)
  | 'q4_eliminate';  // Not Urgent & Not Important (Backlog / Low Value)

export type TaskCategory =
  | 'general'
  | 'feature'
  | 'bug'
  | 'chore'
  | 'improvement';

export type IdeaStatus = 'spark' | 'evaluating' | 'validated' | 'converted' | 'archived';

export type AppCategory = 
  | 'Web App / SaaS' 
  | 'Mobile App' 
  | 'Chrome Extension' 
  | 'Developer Tool / CLI' 
  | 'Open Source Library' 
  | 'AI / ML Tool' 
  | 'Desktop App' 
  | 'Portfolio / Website';

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  stage: ProjectStage;
  quadrant: PriorityQuadrant;
  category?: TaskCategory;
  completed: boolean;
  dueDate?: string; // ISO format YYYY-MM-DD
  estimatedMinutes?: number;
  timeSpentMinutes: number;
  milestoneIds?: string[];
  subtasks: Subtask[];
  tags: string[];
  createdAt: string;
  completedAt?: string;
}

export interface Milestone {
  id: string;
  title: string;
  stage: ProjectStage;
  targetDate: string; // ISO format YYYY-MM-DD
  completed: boolean;
  description?: string;
  taskIds?: string[];
  order?: number;
}

export interface Project {
  id: string;
  title: string;
  tagline: string;
  description: string;
  problem?: string;
  solution?: string;
  targetAudience?: string;
  monetization?: string;
  mvpFeatures?: string[];
  tags?: string[];
  category: AppCategory;
  currentStage: ProjectStage;
  targetDeadline: string; // ISO format YYYY-MM-DD
  startDate: string;
  actualLaunchDate?: string;
  color: string; // Hex or tailwind identifier
  techStack: string[];
  repoUrl?: string;
  liveUrl?: string;
  figmaUrl?: string;
  directoryPath?: string;
  scriptPath?: string;
  cmdDirectory?: string;
  pythonEnv?: string;
  drive?: string;
  port?: string;
  notes?: string;
  initialPrompt?: string;
  initializationTool?: 'opencode' | 'codex';
  initializationModel?: string;
  initializationReasoningEffort?: 'low' | 'medium' | 'high';
  initializationMode?: 'build' | 'plan';
  pinned: boolean;
  milestones: Milestone[];
  techResearch?: TechResearchResult;
  createdAt: string;
  updatedAt: string;
}

export interface LauncherModelPreset {
  id: string;
  tool: 'opencode' | 'codex';
  modelId: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  mode: 'build' | 'plan';
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroundingSource {
  title: string;
  url: string;
}

export interface MarketCompetitor {
  name: string;
  description: string;
  pricing?: string;
  differentiationOpportunity?: string;
}

export interface MarketResearchResult {
  marketSummary: string;
  competitors: MarketCompetitor[];
  targetAudience?: string;
  suggestedMvpFeatures: string[];
  monetizationIdeas: string[];
  feasibilityRating?: number;
  marketDemandRating?: number;
  keyRisks?: string[];
  actionableNextSteps?: string[];
  sources: GroundingSource[];
  searchQueries: string[];
  researchedAt: string;
}

export interface TechStackRecommendation {
  layer: string;
  tool: string;
  why: string;
}

export interface TechResearchResult {
  summary: string;
  recommendedStack: TechStackRecommendation[];
  trendingLibraries: { name: string; purpose: string }[];
  potentialPitfalls?: string[];
  sources: GroundingSource[];
  searchQueries: string[];
  researchedAt: string;
}

export interface Idea {
  id: string;
  title: string;
  tagline: string;
  problem: string;
  solution: string;
  notes: string;
  category: AppCategory;
  status: IdeaStatus;
  sketchDataUrl?: string; // Base64 png data URL from sketchpad
  targetAudience?: string;
  monetization?: string;
  mvpFeatures: string[];
  tags: string[];
  convertedProjectId?: string;
  marketResearch?: MarketResearchResult;
  sketchObjects?: SketchObject[]; // Vector whiteboard objects (Miro-style)
  createdAt: string;
  updatedAt: string;
}

export type SketchObjectType =
  | 'sticky'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'text'
  | 'path'
  | 'arrow'
  | 'line';

export type SketchArrowhead = 'none' | 'start' | 'end' | 'both';

export interface SketchBinding {
  objectId: string;
}

export interface SketchObject {
  id: string;
  type: SketchObjectType;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text?: string;
  fontSize?: number;
  strokeWidth?: number;
  points?: number[]; // path/arrow/line: [x0, y0, x1, y1, ...]
  arrowhead?: SketchArrowhead; // arrow: which ends get a head (default 'end')
  startBinding?: SketchBinding | null;
  endBinding?: SketchBinding | null;
  fill?: boolean; // rect/ellipse/diamond: fill shape with color
  dash?: boolean; // dashed stroke for shapes/arrows/lines
}

export interface AgentFilter {
  id: string;
  name: string;
  slug: string;
  order: number;
}

export interface ProjectDoc {
  id: string;
  projectIds: string[];
  projectLinks?: Array<{ project: string; active: boolean }>;
  active?: boolean | null;
  filterId?: string | null;
  filterName?: string | null;
  filterSlug?: string | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  projectTitle: string;
  taskId?: string;
  taskTitle?: string;
  stage: ProjectStage;
  durationSeconds: number; // total duration in seconds
  mode: 'pomodoro' | 'stopwatch' | 'manual';
  notes: string;
  timestamp: string; // ISO timestamp
}

export interface ActiveTimerState {
  isRunning: boolean;
  mode: 'pomodoro' | 'stopwatch';
  secondsRemaining: number; // For pomodoro
  secondsElapsed: number;   // For stopwatch / pomodoro session
  projectId?: string;
  taskId?: string;
  pomodoroType: 'work' | 'short_break' | 'long_break';
  pomodorosCompleted: number;
}

export type ActiveView = 
  | 'dashboard' 
  | 'projects' 
  | 'ideas' 
  | 'matrix' 
  | 'timetracker' 
  | 'timeline'
  | 'settings';

export const STAGE_CONFIG: Record<ProjectStage, { label: string; order: number; color: string; bgLight: string; bgDark: string; description: string }> = {
  ideation: {
    label: 'Ideation',
    order: 1,
    color: 'text-amber-600 dark:text-amber-400',
    bgLight: 'bg-amber-50 border-amber-200 text-amber-800',
    bgDark: 'dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300',
    description: 'Brainstorming, concept validation, and problem definition'
  },
  planning: {
    label: 'Planning',
    order: 2,
    color: 'text-blue-600 dark:text-blue-400',
    bgLight: 'bg-blue-50 border-blue-200 text-blue-800',
    bgDark: 'dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300',
    description: 'Feature scoping, roadmapping, and MVP requirements'
  },
  architecture: {
    label: 'Design & Arch',
    order: 3,
    color: 'text-purple-600 dark:text-purple-400',
    bgLight: 'bg-purple-50 border-purple-200 text-purple-800',
    bgDark: 'dark:bg-purple-950/40 dark:border-purple-800 dark:text-purple-300',
    description: 'Data models, UI wireframes, API contracts & system design'
  },
  development: {
    label: 'Development',
    order: 4,
    color: 'text-indigo-600 dark:text-indigo-400',
    bgLight: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    bgDark: 'dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-300',
    description: 'Core implementation, frontend & backend engineering'
  },
  testing: {
    label: 'Testing & QA',
    order: 5,
    color: 'text-rose-600 dark:text-rose-400',
    bgLight: 'bg-rose-50 border-rose-200 text-rose-800',
    bgDark: 'dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300',
    description: 'Bug fixing, edge cases, responsive checks & security'
  },
  deployment: {
    label: 'Deployment',
    order: 6,
    color: 'text-teal-600 dark:text-teal-400',
    bgLight: 'bg-teal-50 border-teal-200 text-teal-800',
    bgDark: 'dark:bg-teal-950/40 dark:border-teal-800 dark:text-teal-300',
    description: 'CI/CD pipeline, domain setup, hosting & release build'
  },
  live: {
    label: 'Live & Shipped',
    order: 7,
    color: 'text-emerald-600 dark:text-emerald-400',
    bgLight: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    bgDark: 'dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300',
    description: 'Production monitoring, user feedback & iterations'
  }
};

export const QUADRANT_CONFIG: Record<PriorityQuadrant, { title: string; subtitle: string; tag: string; color: string; badgeClass: string; borderClass: string; bgClass: string }> = {
  q1_do: {
    title: 'Do First',
    subtitle: 'Urgent & Important (Crises & Launch blockers)',
    tag: 'Q1',
    color: 'rose',
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    borderClass: 'border-rose-300 dark:border-rose-900/60',
    bgClass: 'bg-rose-50/40 dark:bg-rose-950/10'
  },
  q2_schedule: {
    title: 'Schedule & Deep Work',
    subtitle: 'Not Urgent & Important (Strategic roadmap, Core features)',
    tag: 'Q2',
    color: 'indigo',
    badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    borderClass: 'border-indigo-300 dark:border-indigo-900/60',
    bgClass: 'bg-indigo-50/40 dark:bg-indigo-950/10'
  },
  q3_delegate: {
    title: 'Quick Wins / Streamline',
    subtitle: 'Urgent & Not Important (Quick fixes, Low leverage tasks)',
    tag: 'Q3',
    color: 'amber',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    borderClass: 'border-amber-300 dark:border-amber-900/60',
    bgClass: 'bg-amber-50/40 dark:bg-amber-950/10'
  },
  q4_eliminate: {
    title: 'Backlog & Evaluate',
    subtitle: 'Not Urgent & Not Important (Nice-to-haves, Distractions)',
    tag: 'Q4',
    color: 'slate',
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    borderClass: 'border-slate-300 dark:border-slate-800',
    bgClass: 'bg-slate-50/40 dark:bg-slate-900/20'
  }
};

export const TASK_CATEGORY_CONFIG: Record<TaskCategory, { label: string; icon: string; badgeClass: string }> = {
  general: {
    label: 'General',
    icon: '•',
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  },
  feature: {
    label: 'Feature',
    icon: '✦',
    badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
  },
  bug: {
    label: 'Bug',
    icon: '🐛',
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  },
  chore: {
    label: 'Chore',
    icon: '🔧',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  improvement: {
    label: 'Improvement',
    icon: '⬆',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
};
