import { Project, Task, Idea, TimeEntry } from '../types';
import { INITIAL_PROJECTS, INITIAL_TASKS, INITIAL_IDEAS, INITIAL_TIME_ENTRIES } from '../data/initialData';

const STORAGE_KEYS = {
  PROJECTS: 'solodev_projects_v1',
  TASKS: 'solodev_tasks_v1',
  IDEAS: 'solodev_ideas_v1',
  TIME_ENTRIES: 'solodev_time_entries_v1',
  THEME: 'solodev_theme_v1'
};

export const StorageService = {
  getProjects(): Project[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PROJECTS);
      if (!data) {
        this.saveProjects(INITIAL_PROJECTS);
        return INITIAL_PROJECTS;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_PROJECTS;
    }
  },

  saveProjects(projects: Project[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
    } catch (e) {
      console.error('Failed to save projects to localStorage', e);
    }
  },

  getTasks(): Task[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TASKS);
      if (!data) {
        this.saveTasks(INITIAL_TASKS);
        return INITIAL_TASKS;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_TASKS;
    }
  },

  saveTasks(tasks: Task[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    } catch (e) {
      console.error('Failed to save tasks to localStorage', e);
    }
  },

  getIdeas(): Idea[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.IDEAS);
      if (!data) {
        this.saveIdeas(INITIAL_IDEAS);
        return INITIAL_IDEAS;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_IDEAS;
    }
  },

  saveIdeas(ideas: Idea[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.IDEAS, JSON.stringify(ideas));
    } catch (e) {
      console.error('Failed to save ideas to localStorage', e);
    }
  },

  getTimeEntries(): TimeEntry[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TIME_ENTRIES);
      if (!data) {
        this.saveTimeEntries(INITIAL_TIME_ENTRIES);
        return INITIAL_TIME_ENTRIES;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_TIME_ENTRIES;
    }
  },

  saveTimeEntries(entries: TimeEntry[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.TIME_ENTRIES, JSON.stringify(entries));
    } catch (e) {
      console.error('Failed to save time entries to localStorage', e);
    }
  },

  exportAllData() {
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projects: this.getProjects(),
      tasks: this.getTasks(),
      ideas: this.getIdeas(),
      timeEntries: this.getTimeEntries()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solodev-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importAllData(jsonData: string): { success: boolean; message: string } {
    try {
      const parsed = JSON.parse(jsonData);
      if (parsed.projects && Array.isArray(parsed.projects)) {
        this.saveProjects(parsed.projects);
      }
      if (parsed.tasks && Array.isArray(parsed.tasks)) {
        this.saveTasks(parsed.tasks);
      }
      if (parsed.ideas && Array.isArray(parsed.ideas)) {
        this.saveIdeas(parsed.ideas);
      }
      if (parsed.timeEntries && Array.isArray(parsed.timeEntries)) {
        this.saveTimeEntries(parsed.timeEntries);
      }
      return { success: true, message: 'All workspace data imported successfully!' };
    } catch {
      return { success: false, message: 'Invalid JSON file format.' };
    }
  },

  resetToDefaults() {
    this.saveProjects(INITIAL_PROJECTS);
    this.saveTasks(INITIAL_TASKS);
    this.saveIdeas(INITIAL_IDEAS);
    this.saveTimeEntries(INITIAL_TIME_ENTRIES);
  }
};
