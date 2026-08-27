// Pure config, no browser APIs — split out of rtc.ts so callers that only
// need the signal URL (e.g. Lobby.tsx) don't force a static import of the
// WebRTC plumbing, which driver.ts otherwise loads lazily.
export const SIGNAL_URL: string = import.meta.env.VITE_SIGNAL_URL ?? "ws://localhost:5200";
