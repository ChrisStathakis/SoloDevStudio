const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

export const FRONTEND_BUILD_ID = env?.VITE_SOLODEV_BUILD_ID || 'dev';
