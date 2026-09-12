import { describe, expect, it } from "vitest";
import type { TrainingSession } from "../types";
import { MAX_IMPORT_BYTES, MAX_IMPORT_SESSIONS } from "./training";
import {
  loadPersistedState,
  loadPersistedStateResult,
  QUARANTINE_KEY,
  savePersistedState,
  STORAGE_KEY,
} from "./storage";

const session: TrainingSession = {
  id: "session-1",
  passageId: "weekend-01",
  passageTitle: "週末の市場",
  requestedMode: "visual",
  effectiveMode: "visual",
  targetPace: 49,
  playbackRate: null,
  wordCount: 90,
  wallTimeMs: 110_000,
  speechTimeMs: 0,
  gapTimeMs: 0,
  startupDelayMs: 0,
  measuredPace: 49.1,
  speechPace: null,
  correctCount: 2,
  answers: [0, 1],
  quizTimeMs: 35_400,
  questionTimeMs: [16_200, 19_200],
  quizTargetTimeMs: 36_000,
  zoneId: "q41",
  recommendedPace: 51,
  completedAt: "2026-08-15T00:00:00.000Z",
};

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function sessionAt(index: number, passageTitle = session.passageTitle): TrainingSession {
  return {
    ...session,
    id: `session-${index}`,
    passageId: `passage-${index % 18}`,
    passageTitle,
    completedAt: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString(),
  };
}

describe("browser persistence", () => {
  it("round-trips settings, sessions and silent baselines", () => {
    const storage = makeStorage();
    savePersistedState(storage, {
      selectedPassageId: "weekend-01",
      mode: "visual",
      settings: { baselinePace: 47.2, targetPace: 51, weeklyGoal: 4 },
      baselineMeasurements: [{ id: "baseline-1", pace: 47.2, measuredAt: "2026-08-14T00:00:00.000Z", quizTimeMs: 34_000, quizTargetTimeMs: 36_000 }],
      sessions: [session],
    });

    expect(storage.values.has(STORAGE_KEY)).toBe(true);
    expect(loadPersistedState(storage)).toMatchObject({
      schemaVersion: 3,
      selectedPassageId: "weekend-01",
      mode: "visual",
      settings: { baselinePace: 47.2, targetPace: 51, weeklyGoal: 4 },
      baselineMeasurements: [{ id: "baseline-1", pace: 47.2, quizTimeMs: 34_000, quizTargetTimeMs: 36_000 }],
      sessions: [{ id: "session-1", measuredPace: 49.1, quizTimeMs: 35_400, questionTimeMs: [16_200, 19_200] }],
    });
  });

  it("returns null without quarantining when nothing is stored", () => {
    expect(loadPersistedStateResult(makeStorage())).toEqual({ state: null, quarantined: false });
  });
});

describe("our own saved data is not subject to import limits", () => {
  // These two cases used to throw, which made loadPersistedState return null, which made
  // App start empty, which made its mount-time save effect overwrite localStorage with
  // that empty state. Total, silent history loss with no warning and no way back.
  it("round-trips a payload larger than the 2MB import cap", () => {
    const storage = makeStorage();
    // Stay well under the 5,000 count cap so this test isolates the byte cap:
    // 4,200 sessions with a long (but legal, 160-char) title crosses 2MB on its own.
    const longTitle = "週".repeat(160);
    const sessions = Array.from({ length: 4_200 }, (_, index) => sessionAt(index, longTitle));
    expect(sessions.length).toBeLessThan(MAX_IMPORT_SESSIONS);
    savePersistedState(storage, {
      selectedPassageId: "weekend-01",
      mode: "visual",
      settings: { baselinePace: 47.2, targetPace: 51, weeklyGoal: 4 },
      baselineMeasurements: [],
      sessions,
    });

    const raw = storage.values.get(STORAGE_KEY) ?? "";
    expect(raw.length).toBeGreaterThan(MAX_IMPORT_BYTES);

    const result = loadPersistedStateResult(storage);
    expect(result.quarantined).toBe(false);
    expect(result.state?.sessions).toHaveLength(4_200);
    expect(result.state?.sessions[0].id).toBe("session-0");
    expect(storage.values.has(QUARANTINE_KEY)).toBe(false);
  });

  it("round-trips more sessions than the import count cap", () => {
    const storage = makeStorage();
    const sessions = Array.from({ length: MAX_IMPORT_SESSIONS + 1 }, (_, index) => sessionAt(index));
    savePersistedState(storage, {
      selectedPassageId: "weekend-01",
      mode: "visual",
      settings: { baselinePace: 47.2, targetPace: 51, weeklyGoal: 4 },
      baselineMeasurements: [],
      sessions,
    });

    const result = loadPersistedStateResult(storage);
    expect(result.quarantined).toBe(false);
    expect(result.state?.sessions).toHaveLength(MAX_IMPORT_SESSIONS + 1);
  });
});

describe("unreadable saved data", () => {
  it("quarantines the raw string instead of dropping it", () => {
    const storage = makeStorage({ [STORAGE_KEY]: "not-json" });
    expect(loadPersistedStateResult(storage)).toEqual({ state: null, quarantined: true });
    expect(storage.values.get(QUARANTINE_KEY)).toBe("not-json");
    // The original is left in place too; nothing here deletes it.
    expect(storage.values.get(STORAGE_KEY)).toBe("not-json");
  });

  it("quarantines valid JSON that is not a readable bundle", () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ schemaVersion: 99, sessions: [] }) });
    const result = loadPersistedStateResult(storage);
    expect(result).toMatchObject({ state: null, quarantined: true });
    expect(storage.values.get(QUARANTINE_KEY)).toBe(storage.values.get(STORAGE_KEY));
  });

  it("does not throw when the quarantine copy itself fails", () => {
    const storage = {
      getItem: () => "not-json",
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(loadPersistedStateResult(storage)).toEqual({ state: null, quarantined: true });
  });

  it("keeps the older loadPersistedState signature working", () => {
    expect(loadPersistedState({ getItem: () => "not-json" })).toBeNull();
    expect(loadPersistedState({ getItem: () => null })).toBeNull();
  });
});
