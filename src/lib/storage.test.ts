import { describe, expect, it } from "vitest";
import type { TrainingSession } from "../types";
import { loadPersistedState, savePersistedState, STORAGE_KEY } from "./storage";

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
  zoneId: "q41",
  recommendedPace: 51,
  completedAt: "2026-08-15T00:00:00.000Z",
};

describe("browser persistence", () => {
  it("round-trips settings, sessions and silent baselines", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    savePersistedState(storage, {
      selectedPassageId: "weekend-01",
      mode: "visual",
      settings: { baselinePace: 47.2, targetPace: 51, weeklyGoal: 4 },
      baselineMeasurements: [{ id: "baseline-1", pace: 47.2, measuredAt: "2026-08-14T00:00:00.000Z" }],
      sessions: [session],
    });

    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadPersistedState(storage)).toMatchObject({
      schemaVersion: 3,
      selectedPassageId: "weekend-01",
      mode: "visual",
      settings: { baselinePace: 47.2, targetPace: 51, weeklyGoal: 4 },
      baselineMeasurements: [{ id: "baseline-1", pace: 47.2 }],
      sessions: [{ id: "session-1", measuredPace: 49.1 }],
    });
  });

  it("ignores corrupt saved data", () => {
    expect(loadPersistedState({ getItem: () => "not-json" })).toBeNull();
  });
});
