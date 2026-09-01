import React, { useState, useEffect, useCallback } from 'react';
import { Folder, File as FileIcon, ChevronUp, X, Loader2, HardDrive } from 'lucide-react';
import { api } from '../services/api';

interface PathPickerModalProps {
  mode: 'folder' | 'file';
  fileFilter?: string[]; // e.g. ['.bat', '.cmd'] — only these file extensions selectable
  initialPath?: string;
  title?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export const PathPickerModal: React.FC<PathPickerModalProps> = ({
  mode,
  fileFilter,
  initialPath,
  title,
  onClose,
  onSelect,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(initialPath || '');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [isRoots, setIsRoots] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const res = await api.get('/filesystem/', { params: { path } });
      const data = res.data;
      setCurrentPath(data.path || '');
      setParent(data.parent ?? null);
      setIsRoots(Boolean(data.is_roots));
      let list: FsEntry[] = data.entries || [];
      if (mode === 'file' && fileFilter && fileFilter.length) {
        const lowers = fileFilter.map(f => f.toLowerCase());
        list = list.filter(e => e.is_dir || lowers.some(ext => e.name.toLowerCase().endsWith(ext)));
      }
      setEntries(list);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to browse filesystem.');
    } finally {
      setLoading(false);
    }
  }, [mode, fileFilter]);

  useEffect(() => {
    browse(currentPath);
  }, [browse]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEntryClick = (entry: FsEntry) => {
    if (entry.is_dir) {
      browse(entry.path);
    } else {
      setSelected(entry.path);
    }
  };

  const handleUp = () => {
    if (parent) browse(parent);
    else browse(''); // go to drive roots
  };

  const handleSelect = () => {
    if (mode === 'folder') {
      if (!currentPath) return;
      onSelect(currentPath);
    } else {
      if (!selected) return;
      onSelect(selected);
    }
  };

  const selectableSelected = mode === 'folder' ? Boolean(currentPath) : Boolean(selected);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-2xl bg-surface-1 border border-line rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div className="flex items-center gap-2 text-sm font-black text-content">
            {mode === 'folder' ? <Folder className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> : <FileIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            <span>{title || (mode === 'folder' ? 'Select Folder' : 'Select File')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current path bar */}
        <div className="flex items-center gap-2 px-5 py-2.5 bg-surface-2 border-b border-line">
          <button
            type="button"
            onClick={handleUp}
            disabled={loading}
            className="p-1.5 rounded-lg bg-surface-3 border border-line text-content hover:text-content transition-colors disabled:opacity-40"
            title="Up one level"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-surface-1 border border-line text-[12px] font-mono text-content-faint truncate" title={currentPath || 'This PC'}>
            {currentPath || 'This PC'}
          </div>
        </div>

        {/* Entries */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-content-faint text-xs font-bold">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {!loading && error && (
            <div className="px-3 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="px-3 py-10 text-center text-content-faint text-xs font-bold">
              {isRoots ? 'No drives found.' : 'Empty folder.'}
            </div>
          )}
          {!loading && !error && entries.map((entry) => {
            const isSelected = mode === 'folder' ? false : selected === entry.path;
            const disabledFile = mode === 'file' && !entry.is_dir && fileFilter?.length
              ? !fileFilter.map(f => f.toLowerCase()).some(ext => entry.name.toLowerCase().endsWith(ext))
              : false;
            return (
              <button
                key={entry.path}
                type="button"
                disabled={disabledFile}
                onClick={() => handleEntryClick(entry)}
                onDoubleClick={() => { if (entry.is_dir) browse(entry.path); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors ${
                  isSelected
                    ? 'bg-indigo-600/20 border border-indigo-500/40'
                    : 'hover:bg-surface-3 border border-transparent'
                } ${disabledFile ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {entry.is_dir ? (
                  isRoots ? <HardDrive className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" /> : <Folder className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                ) : (
                  <FileIcon className="w-4 h-4 text-content-faint shrink-0" />
                )}
                <span className="text-[13px] font-mono text-content truncate">{entry.name}</span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line">
          <span className="text-[11px] font-bold text-content-faint truncate max-w-[60%]" title={mode === 'folder' ? currentPath : selected || ''}>
            {mode === 'folder'
              ? (currentPath || 'This PC')
              : (selected || 'No file selected')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSelect}
              disabled={!selectableSelected}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black transition-all disabled:opacity-50"
            >
              {mode === 'folder' ? 'Select Folder' : 'Select File'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
