interface SolodevDesktopBridge {
  isDesktop: boolean;
  apiBase: string;
  getSettings: () => Promise<{ backendPort: number | null; apiBase: string; companionEnabled?: boolean }>;
  setBackendPort: (backendPort: number | null) => Promise<{ backendPort: number | null; restartRequired: boolean }>;
  setCompanionEnabled: (enabled: boolean) => Promise<{ companionEnabled: boolean }>;
  updateCompanionState: (state: unknown) => void;
  onCompanionCommand: (callback: (command: string) => void) => () => void;
}

interface Window {
  solodevDesktop?: SolodevDesktopBridge;
}
