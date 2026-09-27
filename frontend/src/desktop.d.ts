interface SolodevDesktopBridge {
  isDesktop: boolean;
  apiBase: string;
  getSettings: () => Promise<{ backendPort: number | null; apiBase: string; appVersion?: string; buildId?: string; companionEnabled?: boolean; companionPinned?: boolean; cloudApiUrl?: string | null }>;
  setBackendPort: (backendPort: number | null) => Promise<{ backendPort: number | null; restartRequired: boolean }>;
  setCloudUrl: (cloudUrl: string | null) => Promise<{ cloudApiUrl: string | null }>;
  cloudRequest: (request: { method?: string; url: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; bodyText: string }>;
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
