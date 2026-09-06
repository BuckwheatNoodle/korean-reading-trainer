import { describe, expect, it } from "vitest";
import passagesData from "../data/passages.json";
import translationsData from "../data/translations-ja.json";
import type { Passage, PassageTranslation, TrainingSession } from "../types";
import {
  calculatePace,
  countEojeol,
  getCalibratedTtsPace,
  getGapRate,
  getPaceZone,
  getRecommendedPace,
  getReviewCandidates,
  getTopicProgress,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_SESSIONS,
  parseImportBundle,
  splitForSpeech,
  splitSentences,
} from "./training";

const passages = passagesData as Passage[];
const translations = translationsData as PassageTranslation[];

describe("pace zones", () => {
  it.each([
    [34.9, "outside"],
    [35, "q34"],
    [48.9, "q34"],
    [49, "q41"],
    [61.9, "q41"],
    [62, "minimum"],
    [71.9, "minimum"],
    [72, "practical"],
    [84.9, "practical"],
    [85, "ideal"],
  ])("maps %s to %s", (pace, zone) => {
    expect(getPaceZone(pace).id).toBe(zone);
  });

  it("uses the same one-decimal value shown to the learner at a boundary", () => {
    expect(getPaceZone(48.96).id).toBe("q41");
    expect(getPaceZone(61.96).id).toBe("minimum");
  });
});

describe("training calculations", () => {
  it("counts the displayed text at runtime", () => {
    expect(countEojeol("  하나  둘\n셋 ")).toBe(3);
  });

  it("uses wall-clock time for the measured pace", () => {
    expect(calculatePace(90, 90_000)).toBe(60);
    expect(getGapRate(100_000, 85_000)).toBeCloseTo(0.15);
  });

  it("keeps queued TTS chunks below the long-utterance cutoff", () => {
    const chunks = splitForSpeech(["하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열"], 30);
    expect(chunks.map((chunk) => chunk.wordCount)).toEqual([6, 4]);
    expect(Math.max(...chunks.map((chunk) => (chunk.wordCount / 30) * 60_000))).toBeLessThanOrEqual(12_000);
  });

  it("adjusts by comprehension and clamps at both limits", () => {
    expect(getRecommendedPace(49, 2)).toBe(51);
    expect(getRecommendedPace(49, 1)).toBe(49);
    expect(getRecommendedPace(49, 0)).toBe(47);
    expect(getRecommendedPace(110, 2)).toBe(110);
    expect(getRecommendedPace(30, 0)).toBe(30);
  });

  it("calibrates the 1.00x TTS pace from audio sessions only", () => {
    const base = {
      id: "1",
      passageId: "p1",
      passageTitle: "test",
      requestedMode: "audio",
      effectiveMode: "audio",
      targetPace: 60,
      playbackRate: 0.5,
      wordCount: 100,
      wallTimeMs: 100_000,
      speechTimeMs: 100_000,
      gapTimeMs: 0,
      startupDelayMs: 0,
      measuredPace: 60,
      speechPace: 60,
      correctCount: 2,
      answers: [0, 1],
      zoneId: "q41",
      recommendedPace: 62,
      completedAt: "2026-08-15T00:00:00.000Z",
    } satisfies TrainingSession;
    expect(getCalibratedTtsPace([base])).toBe(120);
  });
});

describe("review prioritization", () => {
  function session(id: string, passageId: string, correctCount: number, completedAt: string): TrainingSession {
    return {
      id,
      passageId,
      passageTitle: passageId,
      requestedMode: "visual",
      effectiveMode: "visual",
      targetPace: 49,
      playbackRate: null,
      wordCount: 90,
      wallTimeMs: 100_000,
      speechTimeMs: 0,
      gapTimeMs: 0,
      startupDelayMs: 0,
      measuredPace: 54,
      speechPace: null,
      correctCount,
      answers: [0, 1],
      zoneId: "q41",
      recommendedPace: 49,
      completedAt,
    };
  }

  it("keeps only passages whose latest attempt still needs review", () => {
    const candidates = getReviewCandidates([
      session("a1", "weekend-01", 0, "2026-08-01T00:00:00.000Z"),
      session("a2", "weekend-01", 2, "2026-08-03T00:00:00.000Z"),
      session("b1", "season-02", 1, "2026-08-05T00:00:00.000Z"),
    ], new Date("2026-08-15T00:00:00.000Z"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ passageId: "season-02", incorrectCount: 1, daysSinceAttempt: 10 });
  });

  it("prioritizes two missed questions before one missed question", () => {
    const candidates = getReviewCandidates([
      session("a", "weekend-01", 1, "2026-08-01T00:00:00.000Z"),
      session("b", "season-02", 0, "2026-08-14T00:00:00.000Z"),
    ], new Date("2026-08-15T00:00:00.000Z"));
    expect(candidates.map((item) => item.passageId)).toEqual(["season-02", "weekend-01"]);
  });

  it("aggregates comprehension by passage topic", () => {
    const progress = getTopicProgress([
      session("a", "weekend-01", 2, "2026-08-01T00:00:00.000Z"),
      session("b", "season-02", 1, "2026-08-02T00:00:00.000Z"),
    ], passages);
    expect(progress.map((item) => [item.topic, item.accuracy])).toEqual([["계절", 0.5], ["주말", 1]]);
  });
});

describe("passage dataset", () => {
  it("contains the starter and challenge passages with unique ordered IDs and valid questions", () => {
    expect(passages.length).toBeGreaterThanOrEqual(18);
    const ids = new Set<string>();
    const questionIds = new Set<string>();
    for (const [index, passage] of passages.entries()) {
      expect(ids.has(passage.id)).toBe(false);
      ids.add(passage.id);
      expect(passage.order).toBe(index + 1);
      expect(passage.title.trim()).not.toBe("");
      expect(passage.titleKo.trim()).not.toBe("");
      expect(passage.topic.trim()).not.toBe("");
      expect(["1–2級", "2–3級", "3–4級"]).toContain(passage.level);
      const wordCount = countEojeol(passage.text);
      if (passage.level === "1–2級") {
        expect(wordCount).toBeGreaterThanOrEqual(80);
        expect(wordCount).toBeLessThanOrEqual(110);
      } else {
        expect(wordCount).toBeGreaterThanOrEqual(110);
        expect(wordCount).toBeLessThanOrEqual(190);
      }
      expect(passage.questions).toHaveLength(2);
      const sentences = splitSentences(passage.text);
      expect(sentences.join(" ")).toBe(passage.text.trim().replace(/\s+/g, " "));
      expect(Math.max(...sentences.map(countEojeol))).toBeLessThanOrEqual(20);
      for (const question of passage.questions) {
        expect(questionIds.has(question.id)).toBe(false);
        questionIds.add(question.id);
        expect(question.prompt.trim()).not.toBe("");
        expect(question.explanation.trim()).not.toBe("");
        expect(question.choices).toHaveLength(4);
        expect(question.choices.every((choice) => choice.trim().length > 0)).toBe(true);
        expect(new Set(question.choices).size).toBe(4);
        expect(question.answer).toBeGreaterThanOrEqual(0);
        expect(question.answer).toBeLessThan(4);
        expect(sentences[question.evidenceSentence]).toBeTruthy();
      }
    }
  });

  it("offers a meaningful intermediate long-form set", () => {
    const challenges = passages.filter((passage) => passage.level !== "1–2級");
    expect(challenges.length).toBeGreaterThanOrEqual(6);
    expect(challenges.every((passage) => countEojeol(passage.text) >= 110)).toBe(true);
    expect(new Set(challenges.map((passage) => passage.topic)).size).toBe(challenges.length);
  });

  it("keeps the answer positions balanced as the dataset grows", () => {
    const distribution = passages
      .flatMap((passage) => passage.questions)
      .reduce((counts, question) => {
        counts[question.answer] += 1;
        return counts;
      }, [0, 0, 0, 0]);
    expect(Math.max(...distribution) - Math.min(...distribution)).toBeLessThanOrEqual(2);
  });

  it("has one aligned Japanese translation for every sentence", () => {
    expect(translations).toHaveLength(passages.length);
    expect(new Set(translations.map((translation) => translation.passageId)).size).toBe(translations.length);
    for (const passage of passages) {
      const translation = translations.find((item) => item.passageId === passage.id);
      expect(translation, passage.id).toBeTruthy();
      expect(translation?.sentences).toHaveLength(splitSentences(passage.text).length);
      expect(translation?.sentences.every((sentence) => sentence.trim().length > 0)).toBe(true);
    }
  });
});

describe("JSON import migration", () => {
  it("migrates a legacy array and calculates missing fields", () => {
    const result = parseImportBundle(JSON.stringify([
      {
        textId: "legacy-1",
        mode: "tts",
        target: 50,
        eojeolCount: 100,
        durationMs: 120_000,
        speakingMs: 100_000,
        comprehension: 2,
        date: "2026-08-01T00:00:00.000Z",
      },
    ]));
    expect(result.migrated).toBe(true);
    expect(result.baselineMeasurements).toEqual([]);
    expect(result.sessions[0]).toMatchObject({
      passageId: "legacy-1",
      effectiveMode: "audio",
      measuredPace: 50,
      gapTimeMs: 20_000,
      recommendedPace: 52,
    });
  });

  it("rejects an object without a sessions array", () => {
    expect(() => parseImportBundle("{}")).toThrow(/sessions/);
  });

  it("rejects oversized or excessive imports before processing them", () => {
    expect(() => parseImportBundle(" ".repeat(MAX_IMPORT_BYTES + 1))).toThrow(/2MB/);
    expect(() => parseImportBundle(JSON.stringify({
      sessions: Array.from({ length: MAX_IMPORT_SESSIONS + 1 }, () => ({})),
    }))).toThrow(/多すぎます/);
  });

  it("rejects incompatible app and future-schema exports", () => {
    expect(() => parseImportBundle(JSON.stringify({ app: "another-app", sessions: [] }))).toThrow(/別のアプリ/);
    expect(() => parseImportBundle(JSON.stringify({ schemaVersion: 99, sessions: [] }))).toThrow(/新しい形式/);
  });

  it("bounds imported values and text to safe application ranges", () => {
    const result = parseImportBundle(JSON.stringify({
      schemaVersion: 3,
      sessions: [{
        id: "x".repeat(300),
        passageId: "weekend-01",
        effectiveMode: "audio",
        playbackRate: 99,
        wordCount: 99_999,
        wallTimeMs: 999_999_999,
        speechTimeMs: 999_999_999,
        correctCount: 99,
        answers: [-99, 99, 1, 2],
        completedAt: "not-a-date",
      }],
      settings: { baselinePace: 999, targetPace: 999, weeklyGoal: 999 },
      baselineMeasurements: [{ pace: 999, note: "n".repeat(200), measuredAt: "invalid" }],
    }));

    expect(result.sessions[0]).toMatchObject({
      playbackRate: 10,
      wordCount: 10_000,
      wallTimeMs: 86_400_000,
      correctCount: 2,
      answers: [-1, 3],
    });
    expect(result.sessions[0].id).toHaveLength(160);
    expect(Number.isNaN(new Date(result.sessions[0].completedAt).getTime())).toBe(false);
    expect(result.settings).toEqual({ baselinePace: 200, targetPace: 110, weeklyGoal: 21 });
    expect(result.baselineMeasurements[0].pace).toBe(200);
    expect(result.baselineMeasurements[0].note).toHaveLength(80);
  });
});
