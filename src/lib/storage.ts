import type { BaselineMeasurement, TrainerSettings, TrainingMode, TrainingSession } from "../types";
import { parseImportBundle } from "./training";

export const STORAGE_KEY = "topik-reading-pace-state-v3";

export interface PersistedAppState {
  schemaVersion: 3;
  savedAt: string;
  selectedPassageId: string;
  mode: TrainingMode;
  settings: TrainerSettings;
  baselineMeasurements: BaselineMeasurement[];
  sessions: TrainingSession[];
}

export function serializeAppState(state: Omit<PersistedAppState, "schemaVersion" | "savedAt">): string {
  return JSON.stringify({
    schemaVersion: 3,
    savedAt: new Date().toISOString(),
    ...state,
  } satisfies PersistedAppState);
}

export function parsePersistedState(input: string): PersistedAppState {
  const parsed = JSON.parse(input) as Record<string, unknown>;
  const imported = parseImportBundle(JSON.stringify(parsed));
  const settings = imported.settings ?? { baselinePace: 46.1, targetPace: 49, weeklyGoal: 4 };
  const selectedPassageId = typeof parsed.selectedPassageId === "string" ? parsed.selectedPassageId : "weekend-01";
  const mode: TrainingMode = parsed.mode === "visual" ? "visual" : "audio";
  return {
    schemaVersion: 3,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    selectedPassageId,
    mode,
    settings,
    baselineMeasurements: imported.baselineMeasurements,
    sessions: imported.sessions,
  };
}

export function loadPersistedState(storage: Pick<Storage, "getItem">): PersistedAppState | null {
  const value = storage.getItem(STORAGE_KEY);
  if (!value) return null;
  try {
    return parsePersistedState(value);
  } catch {
    return null;
  }
}

export function savePersistedState(
  storage: Pick<Storage, "setItem">,
  state: Omit<PersistedAppState, "schemaVersion" | "savedAt">,
): void {
  storage.setItem(STORAGE_KEY, serializeAppState(state));
}
