import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, 
  CheckSquare, 
  FolderPlus, 
  Lightbulb, 
  Timer, 
  Calendar, 
  Clock, 
  Tag, 
  Sparkles,
  Layers,
  Flag,
  Play
} from 'lucide-react';
import { ProjectStage, PriorityQuadrant, AppCategory, IdeaStatus, TaskCategory } from '../types';

export const QuickAddModal: React.FC = () => {
  const {
    isQuickAddOpen,
    setIsQuickAddOpen,
    quickAddInitialTab,
    projects,
    tasks,
    addTask,
    addProject,
    addIdea,
    startTimer,
    setCurrentView,
    setSelectedProjectId,
    quickAddProjectId,
    quickAddTaskId,
    updateTask,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'task' | 'project' | 'idea' | 'timer'>('task');

  // Task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskStage, setTaskStage] = useState<ProjectStage>('development');
  const [taskQuadrant, setTaskQuadrant] = useState<PriorityQuadrant>('q1_do');
  const [taskCategory, setTaskCategory] = useState<TaskCategory>('feature');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskEstimateMins, setTaskEstimateMins] = useState('60');
  const [taskTags, setTaskTags] = useState('');
  const [taskMilestoneIds, setTaskMilestoneIds] = useState<string[]>([]);

  // Project form state
  const [projTitle, setProjTitle] = useState('');
  const [projTagline, setProjTagline] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projCategory, setProjCategory] = useState<AppCategory>('Web App / SaaS');
  const [projStage, setProjStage] = useState<ProjectStage>('planning');
  const [projDeadline, setProjDeadline] = useState('');
  const [projTechStack, setProjTechStack] = useState('React, TypeScript, Tailwind');
  const [projRepoUrl, setProjRepoUrl] = useState('');
  const [projDirPath, setProjDirPath] = useState('');
  const [projColor, setProjColor] = useState('#6366f1');

  // Idea form state
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaTagline, setIdeaTagline] = useState('');
  const [ideaProblem, setIdeaProblem] = useState('');
  const [ideaSolution, setIdeaSolution] = useState('');
  const [ideaNotes, setIdeaNotes] = useState('');
  const [ideaCategory, setIdeaCategory] = useState<AppCategory>('Web App / SaaS');
  const [ideaStatus, setIdeaStatus] = useState<IdeaStatus>('spark');
  const [ideaTags, setIdeaTags] = useState('mvp, idea');

  // Timer form state
  const [timerProjectId, setTimerProjectId] = useState('');
  const [timerMode, setTimerMode] = useState<'pomodoro' | 'stopwatch'>('pomodoro');

  useEffect(() => {
    if (isQuickAddOpen) {
      setActiveTab(quickAddInitialTab);
      if (quickAddTaskId) {
        const task = tasks.find(item => item.id === quickAddTaskId);
        if (task) {
          setTaskTitle(task.title);
          setTaskDesc(task.description || '');
          setTaskProjectId(task.projectId);
          setTaskStage(task.stage);
          setTaskQuadrant(task.quadrant);
          setTaskCategory(task.category || 'feature');
          setTaskDueDate(task.dueDate || '');
          setTaskEstimateMins(String(task.estimatedMinutes || 60));
          setTaskTags(task.tags.join(', '));
          setTaskMilestoneIds(task.milestoneIds || []);
        }
      }
      if (projects.length > 0 && !quickAddTaskId) {
        setTaskProjectId(quickAddProjectId || taskProjectId || projects[0].id);
        if (!timerProjectId) setTimerProjectId(projects[0].id);
      }
    }
  }, [isQuickAddOpen, quickAddInitialTab, projects, tasks, quickAddProjectId, quickAddTaskId, taskProjectId, timerProjectId]);

  useEffect(() => {
    const project = projects.find(p => p.id === taskProjectId);
    setTaskMilestoneIds(current => current.filter(id => project?.milestones.some(m => m.id === id)));
  }, [taskProjectId, projects]);

  if (!isQuickAddOpen) return null;

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    try {
      const taskData = {
        projectId: taskProjectId || (projects[0]?.id ?? 'default'),
        title: taskTitle.trim(),
        description: taskDesc.trim() || undefined,
        stage: taskStage,
        quadrant: taskQuadrant,
        category: taskCategory,
        completed: false,
        dueDate: taskDueDate || undefined,
        estimatedMinutes: parseInt(taskEstimateMins) || 60,
        ...(quickAddTaskId ? {} : { subtasks: [] }),
        tags: taskTags.split(',').map(t => t.trim()).filter(Boolean),
        milestoneIds: taskMilestoneIds,
      } as any;
      if (quickAddTaskId) {
        await updateTask(quickAddTaskId, taskData);
      } else {
        await addTask(taskData);
      }
      setTaskTitle('');
      setTaskDesc('');
      setIsQuickAddOpen(false);
    } catch (err) {
      console.error('Create task failed', err);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projTitle.trim()) return;
    try {
      const created = await addProject({
        title: projTitle.trim(),
        tagline: projTagline.trim() || 'Solo built project',
        description: projDesc.trim(),
        category: projCategory,
        currentStage: projStage,
        startDate: new Date().toISOString().split('T')[0],
        targetDeadline: projDeadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        color: projColor,
        techStack: projTechStack.split(',').map(t => t.trim()).filter(Boolean),
        repoUrl: projRepoUrl.trim() || undefined,
        directoryPath: projDirPath.trim() || undefined,
        pinned: true,
        milestones: [
          {
            id: `ms-${Date.now()}-1`,
            title: 'MVP Architecture & Prototype',
            stage: 'planning',
            targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            completed: false,
          },
        ],
      });
      setProjTitle('');
      setProjTagline('');
      setProjDesc('');
      setProjDirPath('');
      setIsQuickAddOpen(false);
      setSelectedProjectId(created.id);
      setCurrentView('projects');
    } catch (err) {
      console.error('Create project failed', err);
    }
  };

  const handleCreateIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ideaTitle.trim()) return;
    try {
      await addIdea({
        title: ideaTitle.trim(),
        tagline: ideaTagline.trim(),
        problem: ideaProblem.trim(),
        solution: ideaSolution.trim(),
        notes: ideaNotes.trim(),
        category: ideaCategory,
        status: ideaStatus,
        mvpFeatures: [],
        tags: ideaTags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setIdeaTitle('');
      setIdeaTagline('');
      setIdeaProblem('');
      setIdeaSolution('');
      setIsQuickAddOpen(false);
      setCurrentView('ideas');
    } catch (err) {
      console.error('Create idea failed', err);
    }
  };

  const handleStartTimer = (e: React.FormEvent) => {
    e.preventDefault();
    startTimer(timerMode, timerProjectId || undefined);
    setIsQuickAddOpen(false);
    setCurrentView('timetracker');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="bg-surface rounded-3xl shadow-2xl border border-line w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header & Tabs */}
        <div className="p-4 bg-surface-inverse border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-1.5 bg-surface-3 p-1 rounded-2xl border border-line/80">
            <button
              type="button"
              id="tab-quick-task"
              onClick={() => setActiveTab('task')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                activeTab === 'task'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-content-faint hover:text-white'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Task</span>
            </button>

            <button
              type="button"
              id="tab-quick-project"
              onClick={() => setActiveTab('project')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                activeTab === 'project'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-content-faint hover:text-white'
              }`}
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Project</span>
            </button>

            <button
              type="button"
              id="tab-quick-idea"
              onClick={() => setActiveTab('idea')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                activeTab === 'idea'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-content-faint hover:text-white'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>Idea Spark</span>
            </button>

            <button
              type="button"
              id="tab-quick-timer"
              onClick={() => setActiveTab('timer')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                activeTab === 'timer'
                  ? 'bg-rose-600 text-white shadow-md'
                  : 'text-content-faint hover:text-white'
              }`}
            >
              <Timer className="w-3.5 h-3.5" />
              <span>Timer</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsQuickAddOpen(false)}
            className="p-1.5 text-content-faint hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 overflow-y-auto">
          
          {/* TASK FORM */}
          {activeTab === 'task' && (
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Implement Web Worker AST tokenizer"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Assign Project
                  </label>
                  <select
                    value={taskProjectId}
                    onChange={e => setTaskProjectId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-bold"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Priority Quadrant
                  </label>
                  <select
                    value={taskQuadrant}
                    onChange={e => setTaskQuadrant(e.target.value as PriorityQuadrant)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-bold"
                  >
                    <option value="q1_do">Q1: Do First (Urgent & Important)</option>
                    <option value="q2_schedule">Q2: Schedule (Not Urgent, Important)</option>
                    <option value="q3_delegate">Q3: Quick Win (Urgent, Not Important)</option>
                    <option value="q4_eliminate">Q4: Backlog (Not Urgent, Not Important)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">Milestones (optional)</div>
                <div className="max-h-28 overflow-y-auto rounded-xl border border-line bg-surface-2 p-2 space-y-1">
                  {(projects.find(p => p.id === taskProjectId)?.milestones || []).length === 0 ? (
                    <p className="p-2 text-xs text-content-faint">No milestones for this project yet.</p>
                  ) : (projects.find(p => p.id === taskProjectId)?.milestones || []).map(milestone => (
                    <label key={milestone.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-3 text-xs text-content cursor-pointer">
                      <input
                        type="checkbox"
                        checked={taskMilestoneIds.includes(milestone.id)}
                        onChange={() => setTaskMilestoneIds(current => current.includes(milestone.id) ? current.filter(id => id !== milestone.id) : [...current, milestone.id])}
                        className="accent-indigo-500"
                      />
                      {milestone.title}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Lifecycle Stage
                  </label>
                  <select
                    value={taskStage}
                    onChange={e => setTaskStage(e.target.value as ProjectStage)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-bold"
                  >
                    <option value="ideation">Ideation</option>
                    <option value="planning">Planning</option>
                    <option value="architecture">Architecture</option>
                    <option value="development">Development</option>
                    <option value="testing">Testing</option>
                    <option value="deployment">Deployment</option>
                    <option value="live">Live</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={e => setTaskDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Est. (Mins)
                  </label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={taskEstimateMins}
                    onChange={e => setTaskEstimateMins(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Category
                  </label>
                  <select
                    value={taskCategory}
                    onChange={e => setTaskCategory(e.target.value as TaskCategory)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-bold"
                  >
                    <option value="feature">✦ Feature</option>
                    <option value="bug">🐛 Bug</option>
                    <option value="chore">🔧 Chore</option>
                    <option value="improvement">⬆ Improvement</option>
                    <option value="general">• General</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    placeholder="frontend, performance, api"
                    value={taskTags}
                    onChange={e => setTaskTags(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-content-faint hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black tracking-wide shadow-md transition-all"
                >
                  {quickAddTaskId ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          )}

          {/* PROJECT FORM */}
          {activeTab === 'project' && (
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                  Project Title *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. SnippetForge - Fast code snippet manager"
                  value={projTitle}
                  onChange={e => setProjTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                  One-Line Tagline
                </label>
                <input
                  type="text"
                  placeholder="e.g. Client-side local-first code storage with instant search"
                  value={projTagline}
                  onChange={e => setProjTagline(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Category
                  </label>
                  <select
                    value={projCategory}
                    onChange={e => setProjCategory(e.target.value as AppCategory)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-bold"
                  >
                    <option value="Web App / SaaS">Web App / SaaS</option>
                    <option value="Developer Tool / CLI">Developer Tool / CLI</option>
                    <option value="Mobile App">Mobile App</option>
                    <option value="Chrome Extension">Chrome Extension</option>
                    <option value="AI / ML Tool">AI / ML Tool</option>
                    <option value="Open Source Library">Open Source Library</option>
                    <option value="Desktop App">Desktop App</option>
                    <option value="Portfolio / Website">Portfolio / Website</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Target Launch Deadline
                  </label>
                  <input
                    type="date"
                    value={projDeadline}
                    onChange={e => setProjDeadline(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Current Stage
                  </label>
                  <select
                    value={projStage}
                    onChange={e => setProjStage(e.target.value as ProjectStage)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none font-bold"
                  >
                    <option value="ideation">Ideation</option>
                    <option value="planning">Planning</option>
                    <option value="architecture">Design & Architecture</option>
                    <option value="development">Development</option>
                    <option value="testing">Testing & QA</option>
                    <option value="deployment">Deployment</option>
                    <option value="live">Live & Shipped</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Tech Stack (comma separated)
                  </label>
                  <input
                    type="text"
                    value={projTechStack}
                    onChange={e => setProjTechStack(e.target.value)}
                    placeholder="React, TypeScript, Tailwind"
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                  Project Folder Path <span className="text-slate-600 normal-case">(optional — enables one-click open in Explorer)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. D:\projects\my-app"
                  value={projDirPath}
                  onChange={e => setProjDirPath(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-indigo-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                  Description & Scope
                </label>
                <textarea
                  rows={2}
                  placeholder="Outline key value proposition, target user, core MVP scope..."
                  value={projDesc}
                  onChange={e => setProjDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-content-faint hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black tracking-wide shadow-md transition-all"
                >
                  Launch Project
                </button>
              </div>
            </form>
          )}

          {/* IDEA FORM */}
          {activeTab === 'idea' && (
            <form onSubmit={handleCreateIdea} className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                  Idea Concept Title *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. MarkdownToSlides - Instant deck maker"
                  value={ideaTitle}
                  onChange={e => setIdeaTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Problem It Solves
                  </label>
                  <textarea
                    rows={2}
                    placeholder="What pain point does this solve?"
                    value={ideaProblem}
                    onChange={e => setIdeaProblem(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Proposed Solution
                  </label>
                  <textarea
                    rows={2}
                    placeholder="How will your app solve it simply?"
                    value={ideaSolution}
                    onChange={e => setIdeaSolution(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 focus:border-amber-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                    Category
                  </label>
                  <select
                    value={ideaCategory}
                    onChange={e => setIdeaCategory(e.target.value as AppCategory)}
                    className="w-full px-3 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content focus:border-amber-500 outline-none font-bold"
                  >
                    <option value="Web App / SaaS">Web App / SaaS</option>
                    <option value="Developer Tool / CLI">Developer Tool / CLI</option>
                    <option value="Chrome Extension">Chrome Extension</option>
                    <option value="AI / ML Tool">AI / ML Tool</option>
                    <option value="Mobile App">Mobile App</option>
                  </select>
                </div>

              </div>

              <div className="pt-3 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-content-faint hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-black tracking-wide shadow-md transition-all"
                >
                  Save Idea Spark
                </button>
              </div>
            </form>
          )}

          {/* TIMER TRIGGER */}
          {activeTab === 'timer' && (
            <form onSubmit={handleStartTimer} className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-content-muted mb-1.5 font-mono">
                  Focus Project
                </label>
                <select
                  value={timerProjectId}
                  onChange={e => setTimerProjectId(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-surface-2 border border-line rounded-xl text-content focus:border-rose-500 outline-none font-bold"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTimerMode('pomodoro')}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    timerMode === 'pomodoro'
                      ? 'border-rose-500 bg-rose-950/20 text-rose-200 ring-1 ring-rose-500'
                      : 'border-line bg-surface-2 hover:bg-surface-3 text-content-muted'
                  }`}
                >
                  <div className="font-black text-sm">25m Pomodoro</div>
                  <div className="text-xs text-content-faint mt-1">
                    Structured 25-minute deep focus sprints with short breaks
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTimerMode('stopwatch')}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    timerMode === 'stopwatch'
                      ? 'border-rose-500 bg-rose-950/20 text-rose-200 ring-1 ring-rose-500'
                      : 'border-line bg-surface-2 hover:bg-surface-3 text-content-muted'
                  }`}
                >
                  <div className="font-black text-sm">Open Stopwatch</div>
                  <div className="text-xs text-content-faint mt-1">
                    Count-up timer for unconstrained flow state sessions
                  </div>
                </button>
              </div>

              <div className="pt-3 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-content-faint hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black tracking-wide shadow-md transition-all"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Start Focus Session</span>
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};
