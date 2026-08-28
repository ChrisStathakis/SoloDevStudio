import { Project, Task, Idea, TimeEntry } from '../types';

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'proj-1',
    title: 'SnapDiff - Code & JSON Visual Diff Tool',
    tagline: 'High-speed browser-based AST & visual differ for solo engineers',
    description: 'A client-side native tool that parses JSON, YAML, and TypeScript files, highlighting semantic AST differences with syntax coloring and one-click patch exports.',
    category: 'Developer Tool / CLI',
    currentStage: 'development',
    startDate: '2026-08-01',
    targetDeadline: '2026-09-10',
    color: '#6366f1', // Indigo
    techStack: ['React 19', 'TypeScript', 'Web Workers', 'Tailwind CSS', 'Monaco Editor'],
    repoUrl: 'https://github.com/solodev/snapdiff',
    liveUrl: 'https://snapdiff.dev',
    figmaUrl: 'https://figma.com/@solo/snapdiff-wireframes',
    notes: 'Prioritize WASM tree-sitter integration for instant 50MB file diffing without main thread stutters.',
    pinned: true,
    milestones: [
      {
        id: 'ms-1-1',
        title: 'Core Tree-sitter Diff Engine',
        stage: 'architecture',
        targetDate: '2026-08-15',
        completed: true,
        description: 'AST parsing and LCS token match algorithm.'
      },
      {
        id: 'ms-1-2',
        title: 'Monaco Side-by-Side Viewport',
        stage: 'development',
        targetDate: '2026-08-28',
        completed: false,
        description: 'Interactive gutter markers and synchronised scroll.'
      },
      {
        id: 'ms-1-3',
        title: 'CLI Export & Web Launch',
        stage: 'deployment',
        targetDate: '2026-09-10',
        completed: false,
        description: 'Publish on ProductHunt and npm package.'
      }
    ],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-20T14:30:00.000Z'
  },
  {
    id: 'proj-2',
    title: 'PulsePulse - Micro-SaaS Uptime & Webhook Beacon',
    tagline: 'Zero-config heartbeat health monitors for indie hacker side-projects',
    description: 'Monitors serverless cron jobs, webhook responses, and SSL expirations with instant SMS/Telegram alerts and clean public status pages.',
    category: 'Web App / SaaS',
    currentStage: 'planning',
    startDate: '2026-08-10',
    targetDeadline: '2026-09-25',
    color: '#0d9488', // Teal
    techStack: ['Node.js', 'Express', 'Postgres', 'Tailwind', 'Docker'],
    repoUrl: 'https://github.com/solodev/pulsepulse',
    notes: 'Keep free tier generous: 5 healthchecks with 1-minute frequency to drive organic developer adoption.',
    pinned: true,
    milestones: [
      {
        id: 'ms-2-1',
        title: 'Schema & Heartbeat Ingestion API',
        stage: 'planning',
        targetDate: '2026-08-30',
        completed: false,
        description: 'High-throughput ping endpoint with Redis rate limiting.'
      },
      {
        id: 'ms-2-2',
        title: 'Status Page Generator',
        stage: 'development',
        targetDate: '2026-09-15',
        completed: false,
        description: 'Custom domain DNS mapping and SSL cert automation.'
      }
    ],
    createdAt: '2026-08-10T10:15:00.000Z',
    updatedAt: '2026-08-19T11:00:00.000Z'
  },
  {
    id: 'proj-3',
    title: 'PromptVault - Local-First AI Prompt Engineering Studio',
    tagline: 'Private prompt versioning, templating & token cost optimizer',
    description: 'Desktop-grade offline app to test prompts across different parameter temperatures, benchmark output tokens, and export production-ready code snippets.',
    category: 'AI / ML Tool',
    currentStage: 'testing',
    startDate: '2026-07-15',
    targetDeadline: '2026-08-30',
    color: '#8b5cf6', // Purple
    techStack: ['React', 'IndexedDB', 'Tailwind CSS', 'Vite'],
    repoUrl: 'https://github.com/solodev/promptvault',
    liveUrl: 'https://promptvault.app',
    notes: 'All user prompts stay strictly stored in local IndexedDB. Zero cloud telemetry.',
    pinned: false,
    milestones: [
      {
        id: 'ms-3-1',
        title: 'Variable Interpolation & Matrix Test',
        stage: 'development',
        targetDate: '2026-08-10',
        completed: true,
        description: 'Run 1 prompt with 5 variable combinations simultaneously.'
      },
      {
        id: 'ms-3-2',
        title: 'Beta Testing with 10 Solo Devs',
        stage: 'testing',
        targetDate: '2026-08-25',
        completed: false,
        description: 'Collect UX friction reports on prompt diff views.'
      }
    ],
    createdAt: '2026-07-15T08:00:00.000Z',
    updatedAt: '2026-08-21T09:00:00.000Z'
  }
];

export const INITIAL_TASKS: Task[] = [
  // Project 1 Tasks
  {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Implement Web Worker AST tokenizer for syntax highlighting',
    description: 'Offload tree parsing to worker thread so UI remains 60fps on large 10,000 line files.',
    stage: 'development',
    quadrant: 'q1_do',
    completed: false,
    dueDate: '2026-08-23',
    estimatedMinutes: 120,
    timeSpentMinutes: 75,
    subtasks: [
      { id: 'sub-1-1', title: 'Initialize Web Worker postMessage handshake', completed: true },
      { id: 'sub-1-2', title: 'Stream chunks without memory leak', completed: true },
      { id: 'sub-1-3', title: 'Handle syntax error fallbacks gracefully', completed: false }
    ],
    tags: ['performance', 'web-worker', 'core'],
    createdAt: '2026-08-18T10:00:00.000Z'
  },
  {
    id: 'task-2',
    projectId: 'proj-1',
    title: 'Add unified inline git diff patch copy button',
    description: 'Format diff as standard git unified patch format for direct terminal application.',
    stage: 'development',
    quadrant: 'q2_schedule',
    completed: false,
    dueDate: '2026-08-27',
    estimatedMinutes: 60,
    timeSpentMinutes: 20,
    subtasks: [
      { id: 'sub-2-1', title: 'Write patch generator utility', completed: true },
      { id: 'sub-2-2', title: 'Clipboard API with toast feedback', completed: false }
    ],
    tags: ['ui', 'export'],
    createdAt: '2026-08-19T14:00:00.000Z'
  },
  {
    id: 'task-3',
    projectId: 'proj-1',
    title: 'Write unit tests for JSON key re-ordering detector',
    stage: 'testing',
    quadrant: 'q2_schedule',
    completed: false,
    dueDate: '2026-09-02',
    estimatedMinutes: 90,
    timeSpentMinutes: 0,
    subtasks: [
      { id: 'sub-3-1', title: 'Test nested object permutation test cases', completed: false },
      { id: 'sub-3-2', title: 'Test array re-order vs replacement', completed: false }
    ],
    tags: ['testing', 'vitest'],
    createdAt: '2026-08-20T11:00:00.000Z'
  },
  {
    id: 'task-4',
    projectId: 'proj-1',
    title: 'Fix mobile responsiveness in gutter collapse',
    stage: 'development',
    quadrant: 'q3_delegate',
    completed: true,
    dueDate: '2026-08-20',
    estimatedMinutes: 45,
    timeSpentMinutes: 40,
    subtasks: [],
    tags: ['css', 'mobile'],
    createdAt: '2026-08-17T09:00:00.000Z',
    completedAt: '2026-08-20T16:00:00.000Z'
  },

  // Project 2 Tasks
  {
    id: 'task-5',
    projectId: 'proj-2',
    title: 'Finalize DB Schema for check intervals & failure alerts',
    description: 'Design efficient indexing for timeseries heartbeat logs.',
    stage: 'planning',
    quadrant: 'q1_do',
    completed: false,
    dueDate: '2026-08-24',
    estimatedMinutes: 90,
    timeSpentMinutes: 30,
    subtasks: [
      { id: 'sub-5-1', title: 'Define tables in Drizzle / Prisma schema', completed: true },
      { id: 'sub-5-2', title: 'Add retention partition strategy (30 days)', completed: false }
    ],
    tags: ['database', 'architecture'],
    createdAt: '2026-08-19T13:00:00.000Z'
  },
  {
    id: 'task-6',
    projectId: 'proj-2',
    title: 'Research Telegram Bot webhook notification latency',
    stage: 'planning',
    quadrant: 'q4_eliminate',
    completed: false,
    dueDate: '2026-09-05',
    estimatedMinutes: 30,
    timeSpentMinutes: 0,
    subtasks: [],
    tags: ['research', 'alerts'],
    createdAt: '2026-08-20T10:00:00.000Z'
  },

  // Project 3 Tasks
  {
    id: 'task-7',
    projectId: 'proj-3',
    title: 'Test dark mode contrast in Prompt comparison viewer',
    stage: 'testing',
    quadrant: 'q3_delegate',
    completed: false,
    dueDate: '2026-08-23',
    estimatedMinutes: 45,
    timeSpentMinutes: 15,
    subtasks: [
      { id: 'sub-7-1', title: 'Check WCAG AA on syntax tokens', completed: false }
    ],
    tags: ['accessibility', 'ui'],
    createdAt: '2026-08-21T08:00:00.000Z'
  },
  {
    id: 'task-8',
    projectId: 'proj-3',
    title: 'Prepare ProductHunt launch screenshot assets & copy',
    stage: 'deployment',
    quadrant: 'q2_schedule',
    completed: false,
    dueDate: '2026-08-28',
    estimatedMinutes: 120,
    timeSpentMinutes: 45,
    subtasks: [
      { id: 'sub-8-1', title: 'Record 30s GIF demonstration', completed: true },
      { id: 'sub-8-2', title: 'Write Maker comment and launch tweet thread', completed: false }
    ],
    tags: ['marketing', 'launch'],
    createdAt: '2026-08-20T15:00:00.000Z'
  }
];

export const INITIAL_IDEAS: Idea[] = [
  {
    id: 'idea-1',
    title: 'CSSGridGen - Visual Bento Layout Generator',
    tagline: 'Interactive visual canvas to generate modern responsive Tailwind grid code in seconds',
    problem: 'Hand-coding complex responsive CSS grid and bento layouts with variable column spans is slow and error-prone.',
    solution: 'A drag-to-resize visual grid builder that generates zero-dependency clean Tailwind CSS class names and React component code directly.',
    notes: 'Support container query breakpoints and fluid gap calculations. Provide 20 pre-built modern aesthetic bento presets.',
    category: 'Developer Tool / CLI',
    status: 'validated',
    targetAudience: 'Solo developers, frontend engineers, design engineers',
    monetization: 'Free open core with Pro export presets ($19 one-time lifetime license)',
    mvpFeatures: [
      'Interactive 12-column drag-and-drop grid canvas',
      'Instant Tailwind JSX / HTML code generator',
      'Mobile / Tablet / Desktop breakpoint preview tabs',
      'One-click preset template library'
    ],
    tags: ['frontend', 'tailwind', 'css-tool', 'bento'],
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-20T17:00:00.000Z'
  },
  {
    id: 'idea-2',
    title: 'AudioSnippet - Podcast & Voice Note Clip Clipper',
    tagline: 'Turn audio files into animated soundwave audiograms for Twitter / LinkedIn',
    problem: 'Creating social media video clips from long podcast episodes or voice notes requires complex Adobe software.',
    solution: 'Browser-based Canvas / WebAudio waveform visualizer that renders MP4 animations with synchronized subtitles in <30 seconds.',
    notes: 'Use WebCodecs and OffscreenCanvas for ultra-fast client-side MP4 encoding without costly server GPU instances.',
    category: 'Web App / SaaS',
    status: 'spark',
    targetAudience: 'Indie podcasters, content creators, newsletter writers',
    monetization: 'Freemium (3 clips/month free, $9/mo for 1080p and custom branding)',
    mvpFeatures: [
      'Audio drag and drop + trim scrubber',
      '5 waveform animation visualizer styles',
      'Custom gradient background + podcast artwork slot',
      'Client-side fast MP4 export'
    ],
    tags: ['audio', 'video-gen', 'creator-tool'],
    createdAt: '2026-08-18T14:30:00.000Z',
    updatedAt: '2026-08-18T14:30:00.000Z'
  },
  {
    id: 'idea-3',
    title: 'RepoReadme - Interactive Readme & Docs Generator',
    tagline: 'Turn your package.json & codebase outline into a showcase GitHub README',
    problem: 'Open source developers spend hours writing repetitive shields.io badges, installation snippets, and architecture diagrams.',
    solution: 'Scans package metadata, provides beautiful layout blocks, live markdown preview, and copy-paste ready Markdown.',
    category: 'Developer Tool / CLI',
    notes: 'Support dynamic GitHub Actions workflow status badges and one-click copy to clipboard.',
    status: 'evaluating',
    targetAudience: 'Open-source maintainers and indie hackers building in public',
    monetization: '100% Free developer tool with sponsor banner',
    mvpFeatures: [
      'Shields.io dynamic badge builder',
      'Feature grid visual markdown generator',
      'Interactive preview with GitHub Dark/Light skin'
    ],
    tags: ['github', 'open-source', 'markdown'],
    createdAt: '2026-08-19T16:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z'
  }
];

export const INITIAL_TIME_ENTRIES: TimeEntry[] = [
  {
    id: 'time-1',
    projectId: 'proj-1',
    projectTitle: 'SnapDiff - Code & JSON Visual Diff Tool',
    taskId: 'task-1',
    taskTitle: 'Implement Web Worker AST tokenizer for syntax highlighting',
    stage: 'development',
    durationSeconds: 3000, // 50 min
    mode: 'pomodoro',
    notes: 'Configured worker thread message protocol and token stream buffer.',
    timestamp: '2026-08-21T09:30:00.000Z'
  },
  {
    id: 'time-2',
    projectId: 'proj-1',
    projectTitle: 'SnapDiff - Code & JSON Visual Diff Tool',
    taskId: 'task-1',
    taskTitle: 'Implement Web Worker AST tokenizer for syntax highlighting',
    stage: 'development',
    durationSeconds: 1500, // 25 min
    mode: 'pomodoro',
    notes: 'Optimized memory garbage collection on large text streams.',
    timestamp: '2026-08-21T10:45:00.000Z'
  },
  {
    id: 'time-3',
    projectId: 'proj-2',
    projectTitle: 'PulsePulse - Micro-SaaS Uptime & Webhook Beacon',
    taskId: 'task-5',
    taskTitle: 'Finalize DB Schema for check intervals & failure alerts',
    stage: 'planning',
    durationSeconds: 1800, // 30 min
    mode: 'stopwatch',
    notes: 'Drafted SQL indices for millisecond timestamp range queries.',
    timestamp: '2026-08-20T14:15:00.000Z'
  },
  {
    id: 'time-4',
    projectId: 'proj-3',
    projectTitle: 'PromptVault - Local-First AI Prompt Engineering Studio',
    taskId: 'task-8',
    taskTitle: 'Prepare ProductHunt launch screenshot assets & copy',
    stage: 'deployment',
    durationSeconds: 2700, // 45 min
    mode: 'pomodoro',
    notes: 'Captured hero demo GIFs in dark mode.',
    timestamp: '2026-08-19T16:00:00.000Z'
  }
];
