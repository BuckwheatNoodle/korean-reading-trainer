import type { BaselineMeasurement, TrainerSettings, TrainingMode, TrainingSession } from "../types";
import { parseImportBundle } from "./training";

export const STORAGE_KEY = "topik-reading-pace-state-v3";
/** 解析できなかった保存データの退避先。上書きで消す前にここへ丸ごと写す。 */
export const QUARANTINE_KEY = "topik-reading-pace-state-v3-unreadable";

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
  // 自分の保存データにインポート用の上限（2MB・5,000件）を当てると、
  // 上限を超えた時点で読み込みが例外になり、直後の保存 effect が空の状態で
  // localStorage を上書きして全履歴が黙って消える。上限だけ外して解析する。
  const imported = parseImportBundle(input, { enforceLimits: false });
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

export interface LoadPersistedStateResult {
  state: PersistedAppState | null;
  /** 解析に失敗し、生の値を QUARANTINE_KEY へ退避した場合に true。画面で伝えるための印。 */
  quarantined: boolean;
}

export function loadPersistedStateResult(
  storage: Pick<Storage, "getItem" | "setItem">,
): LoadPersistedStateResult {
  const value = storage.getItem(STORAGE_KEY);
  if (!value) return { state: null, quarantined: false };
  try {
    return { state: parsePersistedState(value), quarantined: false };
  } catch {
    // 読めなかったものは捨てずに別キーへ退避する。退避自体（容量超過など）で
    // 例外がこの関数の外へ出ないよう、内側でも握りつぶす。
    try {
      storage.setItem(QUARANTINE_KEY, value);
    } catch {
      // 退避できなくても、起動を止めるほどのことではない。
    }
    return { state: null, quarantined: true };
  }
}

export function loadPersistedState(
  storage: Pick<Storage, "getItem"> & Partial<Pick<Storage, "setItem">>,
): PersistedAppState | null {
  return loadPersistedStateResult({
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem?.(key, value),
  }).state;
}

export function savePersistedState(
  storage: Pick<Storage, "setItem">,
  state: Omit<PersistedAppState, "schemaVersion" | "savedAt">,
): void {
  storage.setItem(STORAGE_KEY, serializeAppState(state));
}
