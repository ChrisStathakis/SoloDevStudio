interface SolodevDesktopBridge {
  isDesktop: boolean;
  apiBase: string;
  getSettings: () => Promise<{ backendPort: number | null; apiBase: string; companionEnabled?: boolean; cloudApiUrl?: string | null }>;
  setBackendPort: (backendPort: number | null) => Promise<{ backendPort: number | null; restartRequired: boolean }>;
  setCloudUrl: (cloudUrl: string | null) => Promise<{ cloudApiUrl: string | null }>;
  setCompanionEnabled: (enabled: boolean) => Promise<{ companionEnabled: boolean }>;
  updateCompanionState: (state: unknown) => void;
  onCompanionCommand: (callback: (command: string) => void) => () => void;
}

interface Window {
  solodevDesktop?: SolodevDesktopBridge;
}
