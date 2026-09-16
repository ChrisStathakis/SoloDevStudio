interface SolodevDesktopBridge {
  isDesktop: boolean;
  apiBase: string;
  getSettings: () => Promise<{ backendPort: number | null; apiBase: string; companionEnabled?: boolean; companionPinned?: boolean; cloudApiUrl?: string | null }>;
  setBackendPort: (backendPort: number | null) => Promise<{ backendPort: number | null; restartRequired: boolean }>;
  setCloudUrl: (cloudUrl: string | null) => Promise<{ cloudApiUrl: string | null }>;
  setCompanionEnabled: (enabled: boolean) => Promise<{ companionEnabled: boolean }>;
  setCompanionPinned: (pinned: boolean) => Promise<{ companionPinned: boolean }>;
  updateCompanionState: (state: unknown) => void;
  onCompanionCommand: (
    callback: (
      command:
        | string
        | { type: 'pet-input'; sessionId?: string; text?: string }
        | { type: 'pet-interrupt'; sessionId?: string }
        | { type: 'set-watched'; sessionId?: string | null },
    ) => void,
  ) => () => void;
}

interface Window {
  solodevDesktop?: SolodevDesktopBridge;
}
