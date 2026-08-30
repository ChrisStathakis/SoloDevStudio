interface SolodevDesktopBridge {
  isDesktop: boolean;
  apiBase: string;
  getSettings: () => Promise<{ backendPort: number | null; apiBase: string }>;
  setBackendPort: (backendPort: number | null) => Promise<{ backendPort: number | null; restartRequired: boolean }>;
}

interface Window {
  solodevDesktop?: SolodevDesktopBridge;
}
