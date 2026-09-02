import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Project,
  Task,
  Idea,
  TimeEntry,
  ActiveTimerState,
  ActiveView,
  ProjectStage,
  PriorityQuadrant,
  Milestone,
  Subtask,
} from '../types';
import { useAuth } from './AuthContext';
import { api, unwrapPaginated } from '../services/api';
import {
  mapProjectFromApi,
  mapProjectToApi,
  mapMilestoneFromApi,
  mapMilestoneToApi,
  mapTaskFromApi,
  mapTaskToApi,
  mapIdeaFromApi,
  mapIdeaToApi,
  mapTimeEntryFromApi,
  mapTimeEntryToApi,
} from '../services/mappers';
import confetti from 'canvas-confetti';

interface AppContextType {
  currentView: ActiveView;
  setCurrentView: (view: ActiveView) => void;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  selectedSparkId: string | null;
  setSelectedSparkId: (id: string | null) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isDataLoading: boolean;
  projects: Project[];
  tasks: Task[];
  ideas: Idea[];
  timeEntries: TimeEntry[];
  refreshData: () => Promise<void>;
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  duplicateProject: (id: string, title: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  advanceProjectStage: (id: string, nextStage: ProjectStage) => Promise<void>;
  addMilestone: (projectId: string, milestone: Omit<Milestone, 'id'>) => Promise<Milestone>;
  updateMilestone: (id: string, updates: Partial<Milestone>) => Promise<Milestone>;
  deleteMilestone: (id: string) => Promise<void>;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'timeSpentMinutes'>) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTaskCompletion: (id: string) => Promise<void>;
  moveTaskQuadrant: (id: string, quadrant: PriorityQuadrant) => Promise<void>;
  toggleSubtask: (taskId: string, subtaskId: string) => Promise<void>;
  addSubtask: (taskId: string, title: string) => Promise<void>;
  updateSubtask: (taskId: string, subtaskId: string, updates: Partial<Subtask>) => Promise<void>;
  deleteSubtask: (taskId: string, subtaskId: string) => Promise<void>;
  addIdea: (idea: Omit<Idea, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Idea>;
  updateIdea: (id: string, updates: Partial<Idea>) => Promise<void>;
  deleteIdea: (id: string) => Promise<void>;
  convertIdeaToProject: (ideaId: string) => Promise<Project>;
  timeTracker: ActiveTimerState;
  startTimer: (mode: 'pomodoro' | 'stopwatch', projectId?: string, taskId?: string) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: (notes?: string) => Promise<void>;
  switchPomodoroPhase: (type: 'work' | 'short_break' | 'long_break') => void;
  addManualTimeEntry: (entry: Omit<TimeEntry, 'id'>) => Promise<void>;
  deleteTimeEntry: (id: string) => Promise<void>;
  isQuickAddOpen: boolean;
  setIsQuickAddOpen: (open: boolean) => void;
  quickAddInitialTab: 'task' | 'project' | 'idea' | 'timer';
  quickAddProjectId: string | null;
  quickAddTaskId: string | null;
  openQuickAdd: (tab?: 'task' | 'project' | 'idea' | 'timer', options?: { projectId?: string; taskId?: string }) => void;
  exportData: () => Promise<void>;
  importData: (json: string) => Promise<{ success: boolean; message: string }>;
  resetDefaults: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const LEGACY_KEYS = ['solodev_projects_v1', 'solodev_tasks_v1', 'solodev_ideas_v1', 'solodev_time_entries_v1'];

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [currentView, setCurrentView] = useState<ActiveView>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSparkId, setSelectedSparkId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('solo_theme_mode');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  });

  const [projects, setProjectsRaw] = useState<Project[]>([]);
  const sortProjects = (list: Project[]) =>
    [...list].sort((a, b) =>
      a.pinned === b.pinned
        ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        : a.pinned ? -1 : 1
    );
  const setProjects = (val: Project[] | ((prev: Project[]) => Project[])) =>
    setProjectsRaw(prev => {
      const next = typeof val === 'function' ? (val as (p: Project[]) => Project[])(prev) : val;
      return sortProjects(next);
    });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  const [isQuickAddOpen, setIsQuickAddOpen] = useState<boolean>(false);
  const [quickAddInitialTab, setQuickAddInitialTab] = useState<'task' | 'project' | 'idea' | 'timer'>('task');
  const [quickAddProjectId, setQuickAddProjectId] = useState<string | null>(null);
  const [quickAddTaskId, setQuickAddTaskId] = useState<string | null>(null);

  const [timeTracker, setTimeTracker] = useState<ActiveTimerState>({
    isRunning: false,
    mode: 'pomodoro',
    secondsRemaining: 25 * 60,
    secondsElapsed: 0,
    pomodoroType: 'work',
    pomodorosCompleted: 0,
  });
  const fetchGenerationRef = useRef(0);

  // Theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('solo_theme_mode', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('solo_theme_mode', 'light');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  // Clear legacy localStorage fields (beta) once authenticated — source of truth is now server
  useEffect(() => {
    if (isAuthenticated) {
      let hadLegacy = false;
      for (const k of LEGACY_KEYS) if (localStorage.getItem(k) !== null) hadLegacy = true;
      if (hadLegacy) {
        for (const k of LEGACY_KEYS) { try { localStorage.removeItem(k); } catch {} }
        // optional: console info
      }
    }
  }, [isAuthenticated]);

  // Data fetch
  const fetchAll = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;
    if (!isAuthenticated) {
      if (generation === fetchGenerationRef.current) {
        setProjects([]); setTasks([]); setIdeas([]); setTimeEntries([]);
      }
      return;
    }
    setIsDataLoading(true);
    try {
      const [projRes, tasksRes, ideasRes, timeRes] = await Promise.all([
        api.get('/projects/', { params: { page_size: 100 } }),
        api.get('/tasks/', { params: { page_size: 100 } }),
        api.get('/ideas/', { params: { page_size: 100 } }),
        api.get('/time-entries/', { params: { page_size: 100 } }),
      ]);
      if (generation !== fetchGenerationRef.current) return;
      setProjects(unwrapPaginated<any>(projRes.data).map(mapProjectFromApi));
      setTasks(unwrapPaginated<any>(tasksRes.data).map(mapTaskFromApi));
      setIdeas(unwrapPaginated<any>(ideasRes.data).map(mapIdeaFromApi));
      setTimeEntries(unwrapPaginated<any>(timeRes.data).map(mapTimeEntryFromApi));
    } catch (e) {
      console.error('Failed to fetch data', e);
    } finally {
      if (generation === fetchGenerationRef.current) setIsDataLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authLoading) fetchAll();
  }, [authLoading, fetchAll]);

  const refreshData = async () => { await fetchAll(); };

  // Timer interval (unchanged)
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (timeTracker.isRunning) {
      interval = setInterval(() => {
        setTimeTracker(prev => {
          if (prev.mode === 'stopwatch') {
            return { ...prev, secondsElapsed: prev.secondsElapsed + 1 };
          } else {
            if (prev.secondsRemaining <= 1) {
              const isWorkSession = prev.pomodoroType === 'work';
              try {
                const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
                osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.8);
              } catch {}
              if (isWorkSession) confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
              const newCompleted = isWorkSession ? prev.pomodorosCompleted + 1 : prev.pomodorosCompleted;
              const nextType = isWorkSession ? (newCompleted % 4 === 0 ? 'long_break' : 'short_break') : 'work';
              const nextDuration = nextType === 'work' ? 25 * 60 : (nextType === 'long_break' ? 15 * 60 : 5 * 60);
              return { ...prev, isRunning: false, pomodoroType: nextType, secondsRemaining: nextDuration, secondsElapsed: prev.secondsElapsed + 1, pomodorosCompleted: newCompleted };
            }
            return { ...prev, secondsRemaining: prev.secondsRemaining - 1, secondsElapsed: prev.secondsElapsed + 1 };
          }
        });
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [timeTracker.isRunning]);

  // Project handlers
  const addProject = async (projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> => {
    const payload = mapProjectToApi(projectData as any);
    // Ensure milestones sent without client-generated temp ids
    if (projectData.milestones) {
      payload.milestones = projectData.milestones.map((m) => ({
        title: m.title,
        stage: m.stage,
        target_date: m.targetDate,
        completed: m.completed,
        description: (m as any).description || '',
      }));
    }
    const res = await api.post('/projects/', payload);
    const created = mapProjectFromApi(res.data);
    setProjects(prev => [created, ...prev]);
    return created;
  };

  const updateProject = async (id: string, updates: Partial<Project>) => {
    const payload = mapProjectToApi(updates as any);
    const res = await api.patch(`/projects/${id}/`, payload);
    const updated = mapProjectFromApi(res.data);
    setProjects(prev => prev.map(p => (p.id === id ? updated : p)));
  };

  const duplicateProject = async (id: string, title: string): Promise<Project> => {
    const res = await api.post(`/projects/${id}/duplicate/`, { title: title.trim() });
    const created = mapProjectFromApi(res.data.project);
    await fetchAll();
    setSelectedProjectId(created.id);
    return created;
  };

  const deleteProject = async (id: string) => {
    await api.delete(`/projects/${id}/`);
    setProjects(prev => prev.filter(p => p.id !== id));
    setTasks(prev => prev.filter(t => t.projectId !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);
  };

  const advanceProjectStage = async (id: string, nextStage: ProjectStage) => {
    const res = await api.post(`/projects/${id}/advance-stage/`, { nextStage });
    const updated = mapProjectFromApi(res.data);
    setProjects(prev => prev.map(p => (p.id === id ? updated : p)));
    if (nextStage === 'live') confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
  };

  const addMilestone = async (projectId: string, milestone: Omit<Milestone, 'id'>): Promise<Milestone> => {
    const payload = {
      project: projectId,
      title: milestone.title,
      stage: milestone.stage,
      target_date: milestone.targetDate,
      completed: milestone.completed,
      description: milestone.description || '',
      order: milestone.order,
    };
    const res = await api.post('/milestones/', payload);
    let created = mapMilestoneFromApi(res.data);
    if (milestone.taskIds?.length) {
      const linked = await api.put(`/milestones/${created.id}/tasks/`, { task_ids: milestone.taskIds });
      created = mapMilestoneFromApi(linked.data);
    }
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, milestones: [...p.milestones, created] } : p));
    return created;
  };

  const updateMilestone = async (id: string, updates: Partial<Milestone>): Promise<Milestone> => {
    const current = projects.flatMap(project => project.milestones).find(milestone => milestone.id === id);
    if (!current) throw new Error('Milestone not found.');
    const payload = mapMilestoneToApi({ ...current, ...updates, id } as Milestone);
    delete payload.id;
    const res = await api.patch(`/milestones/${id}/`, payload);
    let updated = mapMilestoneFromApi(res.data);
    if (updates.taskIds !== undefined) {
      const linked = await api.put(`/milestones/${id}/tasks/`, { task_ids: updates.taskIds });
      updated = mapMilestoneFromApi(linked.data);
    }
    setProjects(prev => prev.map(p => ({ ...p, milestones: p.milestones.map(m => m.id === id ? updated : m) })));
    if (updates.taskIds !== undefined) {
      setTasks(prev => prev.map(task => task.milestoneIds ? { ...task, milestoneIds: task.milestoneIds.filter(mid => mid !== id) } : task));
      setTasks(prev => prev.map(task => updates.taskIds?.includes(task.id) ? { ...task, milestoneIds: Array.from(new Set([...(task.milestoneIds || []), id])) } : task));
    }
    return updated;
  };

  const deleteMilestone = async (id: string) => {
    await api.delete(`/milestones/${id}/`);
    setProjects(prev => prev.map(p => ({ ...p, milestones: p.milestones.filter(m => m.id !== id) })));
    setTasks(prev => prev.map(task => task.milestoneIds ? { ...task, milestoneIds: task.milestoneIds.filter(mid => mid !== id) } : task));
  };

  // Task handlers
  const addTask = async (taskData: Omit<Task, 'id' | 'createdAt' | 'timeSpentMinutes'>): Promise<Task> => {
    const payload = mapTaskToApi(taskData as any);
    const res = await api.post('/tasks/', payload);
    const created = mapTaskFromApi(res.data);
    setTasks(prev => [created, ...prev]);
    return created;
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    // For subtasks included, send subtasks
    const current = tasks.find(t => t.id === id);
    const merged = { ...current, ...updates } as Task;
    const payload = mapTaskToApi(merged as any);
    const res = await api.patch(`/tasks/${id}/`, payload);
    const updated = mapTaskFromApi(res.data);
    setTasks(prev => prev.map(t => (t.id === id ? updated : t)));
  };

  const deleteTask = async (id: string) => {
    await api.delete(`/tasks/${id}/`);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const toggleTaskCompletion = async (id: string) => {
    const res = await api.post(`/tasks/${id}/toggle-complete/`);
    const updated = mapTaskFromApi(res.data);
    setTasks(prev => prev.map(t => (t.id === id ? updated : t)));
    if (updated.completed) confetti({ particleCount: 35, spread: 50, origin: { y: 0.85 } });
  };

  const moveTaskQuadrant = async (id: string, quadrant: PriorityQuadrant) => {
    const res = await api.post(`/tasks/${id}/move-quadrant/`, { quadrant });
    const updated = mapTaskFromApi(res.data);
    setTasks(prev => prev.map(t => (t.id === id ? updated : t)));
  };

  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    const res = await api.post(`/tasks/${taskId}/subtasks/${subtaskId}/toggle/`);
    // res is subtask; refresh task
    const taskRes = await api.get(`/tasks/${taskId}/`);
    const updatedTask = mapTaskFromApi(taskRes.data);
    setTasks(prev => prev.map(t => (t.id === taskId ? updatedTask : t)));
    void res;
  };

  const addSubtask = async (taskId: string, title: string) => {
    if (!title.trim()) return;
    await api.post(`/tasks/${taskId}/subtasks/`, { title: title.trim() });
    const taskRes = await api.get(`/tasks/${taskId}/`);
    const updatedTask = mapTaskFromApi(taskRes.data);
    setTasks(prev => prev.map(t => (t.id === taskId ? updatedTask : t)));
  };

  const updateSubtask = async (taskId: string, subtaskId: string, updates: Partial<Subtask>) => {
    await api.patch(`/tasks/${taskId}/subtasks/${subtaskId}/`, updates);
    const taskRes = await api.get(`/tasks/${taskId}/`);
    const updatedTask = mapTaskFromApi(taskRes.data);
    setTasks(prev => prev.map(t => (t.id === taskId ? updatedTask : t)));
  };

  const deleteSubtask = async (taskId: string, subtaskId: string) => {
    await api.delete(`/tasks/${taskId}/subtasks/${subtaskId}/`);
    const taskRes = await api.get(`/tasks/${taskId}/`);
    const updatedTask = mapTaskFromApi(taskRes.data);
    setTasks(prev => prev.map(t => (t.id === taskId ? updatedTask : t)));
  };

  // Idea handlers
  const addIdea = async (ideaData: Omit<Idea, 'id' | 'createdAt' | 'updatedAt'>): Promise<Idea> => {
    const payload = mapIdeaToApi(ideaData as any);
    const res = await api.post('/ideas/', payload);
    const created = mapIdeaFromApi(res.data);
    setIdeas(prev => [created, ...prev]);
    return created;
  };

  const updateIdea = async (id: string, updates: Partial<Idea>) => {
    const payload = mapIdeaToApi(updates as any);
    const res = await api.patch(`/ideas/${id}/`, payload);
    const updated = mapIdeaFromApi(res.data);
    setIdeas(prev => prev.map(i => (i.id === id ? updated : i)));
  };

  const deleteIdea = async (id: string) => {
    await api.delete(`/ideas/${id}/`);
    setIdeas(prev => prev.filter(i => i.id !== id));
    if (selectedSparkId === id) setSelectedSparkId(null);
  };

  const convertIdeaToProject = async (ideaId: string): Promise<Project> => {
    const res = await api.post(`/ideas/${ideaId}/convert/`);
    const project = mapProjectFromApi(res.data.project);
    const idea = mapIdeaFromApi(res.data.idea);
    setProjects(prev => [project, ...prev]);
    setIdeas(prev => prev.map(i => (i.id === ideaId ? idea : i)));
    // refresh tasks (convert creates tasks)
    const tasksRes = await api.get('/tasks/', { params: { page_size: 100 } });
    setTasks(unwrapPaginated<any>(tasksRes.data).map(mapTaskFromApi));
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
    return project;
  };

  // Time tracker
  const startTimer = (mode: 'pomodoro' | 'stopwatch', projectId?: string, taskId?: string) => {
    setTimeTracker(prev => ({
      ...prev,
      isRunning: true,
      mode,
      projectId: projectId || prev.projectId,
      taskId: taskId || prev.taskId,
      secondsRemaining: mode === 'pomodoro' && prev.secondsRemaining === 0 ? 25 * 60 : prev.secondsRemaining,
    }));
  };
  const pauseTimer = () => setTimeTracker(prev => ({ ...prev, isRunning: false }));
  const resumeTimer = () => setTimeTracker(prev => ({ ...prev, isRunning: true }));
  const stopTimer = async (notes = '') => {
    const elapsed = timeTracker.secondsElapsed;
    const proj = projects.find(p => p.id === timeTracker.projectId);
    const tsk = tasks.find(t => t.id === timeTracker.taskId);
    if (elapsed > 30) {
      const projectId = timeTracker.projectId || projects[0]?.id;
      if (projectId) {
        const entry: any = {
          projectId,
          projectTitle: proj?.title || 'Solo Productivity Focus',
          taskId: timeTracker.taskId || undefined,
          taskTitle: tsk?.title || undefined,
          stage: (proj?.currentStage as any) || 'development',
          durationSeconds: elapsed,
          mode: timeTracker.mode as any,
          notes: notes || (tsk ? `Focus session on: ${tsk.title}` : 'Solo deep work focus block'),
          timestamp: new Date().toISOString(),
        };
        try {
          const payload = mapTimeEntryToApi(entry);
          const res = await api.post('/time-entries/', payload);
          const created = mapTimeEntryFromApi(res.data);
          setTimeEntries(prev => [created, ...prev]);
          if (created.taskId) {
            const tRes = await api.get(`/tasks/${created.taskId}/`);
            const updatedTask = mapTaskFromApi(tRes.data);
            setTasks(prev => prev.map(t => (t.id === created.taskId ? updatedTask : t)));
          }
        } catch (e) {
          console.error('Failed to save time entry', e);
        }
      }
    }
    setTimeTracker({
      isRunning: false,
      mode: 'pomodoro',
      secondsRemaining: 25 * 60,
      secondsElapsed: 0,
      pomodoroType: 'work',
      pomodorosCompleted: timeTracker.pomodorosCompleted,
      projectId: undefined,
      taskId: undefined,
    });
  };
  const switchPomodoroPhase = (type: 'work' | 'short_break' | 'long_break') => {
    const duration = type === 'work' ? 25 * 60 : type === 'long_break' ? 15 * 60 : 5 * 60;
    setTimeTracker(prev => ({ ...prev, pomodoroType: type, secondsRemaining: duration, isRunning: false }));
  };

  const addManualTimeEntry = async (entryData: Omit<TimeEntry, 'id'>) => {
    const payload = mapTimeEntryToApi(entryData as any);
    const res = await api.post('/time-entries/', payload);
    const created = mapTimeEntryFromApi(res.data);
    setTimeEntries(prev => [created, ...prev]);
    if (created.taskId) {
      try {
        const tRes = await api.get(`/tasks/${created.taskId}/`);
        const updatedTask = mapTaskFromApi(tRes.data);
        setTasks(prev => prev.map(t => (t.id === created.taskId ? updatedTask : t)));
      } catch {}
    }
  };

  const deleteTimeEntry = async (id: string) => {
    await api.delete(`/time-entries/${id}/`);
    // need to know task to refresh; find before filter
    const entry = timeEntries.find(e => e.id === id);
    setTimeEntries(prev => prev.filter(e => e.id !== id));
    if (entry?.taskId) {
      try {
        const tRes = await api.get(`/tasks/${entry.taskId}/`);
        const updatedTask = mapTaskFromApi(tRes.data);
        setTasks(prev => prev.map(t => (t.id === entry.taskId ? updatedTask : t)));
      } catch {}
    }
  };

  const openQuickAdd = (tab: 'task' | 'project' | 'idea' | 'timer' = 'task', options?: { projectId?: string; taskId?: string }) => {
    setQuickAddInitialTab(tab);
    setQuickAddProjectId(options?.projectId || null);
    setQuickAddTaskId(options?.taskId || null);
    setIsQuickAddOpen(true);
  };

  const exportData = async () => {
    const res = await api.get('/export/');
    const data = res.data;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solodev-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (json: string): Promise<{ success: boolean; message: string }> => {
    try {
      const parsed = JSON.parse(json);
      await api.post('/import/', parsed);
      await fetchAll();
      return { success: true, message: 'All workspace data imported successfully!' };
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Invalid JSON file format.';
      return { success: false, message: String(msg) };
    }
  };

  const resetDefaults = async () => {
    const resetGeneration = ++fetchGenerationRef.current;
    try {
      const resetResponse = await api.post('/workspace/reset/');
      if (resetResponse.data?.success !== true) throw new Error('The workspace reset was not completed.');

      const verification = await api.get('/export/');
      const remaining = ['projects', 'tasks', 'ideas', 'timeEntries', 'docs', 'modelPresets']
        .filter(key => Array.isArray(verification.data?.[key]) && verification.data[key].length > 0);
      if (remaining.length > 0) {
        throw new Error(`The workspace still contains: ${remaining.join(', ')}.`);
      }

      if (resetGeneration !== fetchGenerationRef.current) return;
      setProjects([]);
      setTasks([]);
      setIdeas([]);
      setTimeEntries([]);
      setSelectedProjectId(null);
      setSelectedSparkId(null);
    } catch (e) {
      console.error('resetDefaults failed', e);
      throw e;
    }
  };

  return (
    <AppContext.Provider
      value={{
        currentView,
        setCurrentView,
        selectedProjectId,
        setSelectedProjectId,
        selectedSparkId,
        setSelectedSparkId,
        isDarkMode,
        toggleDarkMode,
        searchQuery,
        setSearchQuery,
        isDataLoading,
        projects,
        tasks,
        ideas,
        timeEntries,
        refreshData,
        addProject,
        updateProject,
        duplicateProject,
        deleteProject,
        advanceProjectStage,
        addMilestone,
        updateMilestone,
        deleteMilestone,
        addTask,
        updateTask,
        deleteTask,
        toggleTaskCompletion,
        moveTaskQuadrant,
        toggleSubtask,
        addSubtask,
        updateSubtask,
        deleteSubtask,
        addIdea,
        updateIdea,
        deleteIdea,
        convertIdeaToProject,
        timeTracker,
        startTimer,
        pauseTimer,
        resumeTimer,
        stopTimer,
        switchPomodoroPhase,
        addManualTimeEntry,
        deleteTimeEntry,
        isQuickAddOpen,
        setIsQuickAddOpen,
        quickAddInitialTab,
        quickAddProjectId,
        quickAddTaskId,
        openQuickAdd,
        exportData,
        importData,
        resetDefaults,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
