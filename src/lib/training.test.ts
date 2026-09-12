import { describe, expect, it } from "vitest";
import passagesData from "../data/passages.json";
import translationsData from "../data/translations-ja.json";
import type { Passage, PassageTranslation, TrainingSession } from "../types";
import {
  calculatePace,
  countEojeol,
  DEFAULT_TTS_PACE,
  formatAnswerDuration,
  getCalibratedTtsPace,
  getGapRate,
  getNextZoneBoundary,
  getPaceZone,
  getQuestionTimeTargetSeconds,
  getRecommendedPace,
  getReviewCandidates,
  getTopicProgress,
  MAX_IMPORT_BASELINES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_SESSIONS,
  PACE_ZONES,
  parseImportBundle,
  shuffleOrder,
  splitForSpeech,
  splitSentences,
  splitSentencesFallback,
} from "./training";

const passages = passagesData as Passage[];
// TypeScript infers a per-passage literal shape for each `explanations` map, so widen it.
const translations = translationsData as unknown as PassageTranslation[];

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

  it("falls back to 圏外 rather than 理想 for values that match no zone", () => {
    expect(getPaceZone(Number.NaN).id).toBe("outside");
    expect(getPaceZone(Number.POSITIVE_INFINITY).id).toBe("outside");
    expect(getPaceZone(-1).id).toBe("outside");
  });

  it("reserves the violet family for the baseline marker", () => {
    expect(PACE_ZONES.map((zone) => zone.color)).toEqual([
      "#c0c7c3",
      "#9db8b2",
      "#6da39b",
      "#3e8f89",
      "#0e6e6b",
      "#0a4744",
    ]);
  });

  it("states the score figures as a ceiling that assumes every answer is correct", () => {
    const q34 = PACE_ZONES.find((zone) => zone.id === "q34");
    const q41 = PACE_ZONES.find((zone) => zone.id === "q41");
    expect(q34?.description).toContain("全問正解なら");
    expect(q41?.description).toContain("全問正解なら");
  });

  it("reports the next zone boundary instead of a hardcoded 49", () => {
    expect(getNextZoneBoundary(30)).toMatchObject({ boundary: 35, zone: { id: "q34" } });
    expect(getNextZoneBoundary(52)).toMatchObject({ boundary: 62, zone: { id: "minimum" } });
    expect(getNextZoneBoundary(61.9)).toMatchObject({ boundary: 62, zone: { id: "minimum" } });
    expect(getNextZoneBoundary(72)).toMatchObject({ boundary: 85, zone: { id: "ideal" } });
  });

  it("has no next boundary in the top zone or for non-finite paces", () => {
    expect(getNextZoneBoundary(85)).toBeNull();
    expect(getNextZoneBoundary(200)).toBeNull();
    expect(getNextZoneBoundary(Number.NaN)).toBeNull();
    expect(getNextZoneBoundary(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("sentence splitting without lookbehind", () => {
  // The literal /(?<=…)/ form is a parse-time SyntaxError on Safari <= 16.3, which would
  // blank the whole app. Both code paths have to produce exactly the same output.
  const samples = [
    "하나.",
    "하나. 둘. 셋.",
    "가격은 1.5배! 그런데? 정말？ 네。 끝.",
    "여기.. 저기! 거기?? 좋다.",
    "A.B. C",
    "줄바꿈이\n있는.\t문장 입니다.",
    "no terminator at all",
    "…생략. 다음.",
    "끝. ",
    " . . .",
    "",
    "   ",
  ];

  it.each(samples)("agrees with the lookbehind implementation for %j", (sample) => {
    const normalized = sample.trim().replace(/\s+/g, " ");
    const expected = normalized ? splitSentencesFallback(normalized) : [];
    expect(splitSentences(sample)).toEqual(expected);
  });

  it("agrees with the lookbehind implementation on every shipped passage", () => {
    for (const passage of passages) {
      const normalized = passage.text.trim().replace(/\s+/g, " ");
      expect(splitSentencesFallback(normalized), passage.id).toEqual(splitSentences(passage.text));
      expect(splitSentencesFallback(normalized).join(" "), passage.id).toBe(normalized);
    }
  });
});

describe("deterministic choice shuffling", () => {
  it("returns the same permutation for the same seed", () => {
    expect(shuffleOrder(4, 12345)).toEqual(shuffleOrder(4, 12345));
    expect(shuffleOrder(4, 12345)).toEqual(shuffleOrder(4, 12345));
  });

  it("is a permutation of display index -> original index", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const order = shuffleOrder(4, seed);
      expect(order).toHaveLength(4);
      expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    }
  });

  it("actually reorders for at least some seeds", () => {
    const identity = [0, 1, 2, 3];
    const seeds = Array.from({ length: 50 }, (_, index) => index);
    expect(seeds.some((seed) => JSON.stringify(shuffleOrder(4, seed)) !== JSON.stringify(identity))).toBe(true);
  });

  it("handles degenerate lengths and seeds", () => {
    expect(shuffleOrder(0, 1)).toEqual([]);
    expect(shuffleOrder(1, 1)).toEqual([0]);
    expect(shuffleOrder(-3, 1)).toEqual([]);
    expect(shuffleOrder(Number.NaN, 1)).toEqual([]);
    expect(shuffleOrder(4, Number.NaN)).toEqual(shuffleOrder(4, 0));
    expect(shuffleOrder(4, -7)).toHaveLength(4);
  });
});

describe("training calculations", () => {
  it("uses the documented 18-second and 26-second answer budgets", () => {
    expect(getQuestionTimeTargetSeconds(49)).toBe(18);
    expect(getQuestionTimeTargetSeconds(71.9)).toBe(18);
    expect(getQuestionTimeTargetSeconds(72)).toBe(26);
    expect(formatAnswerDuration(18_450)).toBe("18.4秒");
  });

  it("counts the displayed text at runtime", () => {
    expect(countEojeol("  하나  둘\n셋 ")).toBe(3);
  });

  it("uses wall-clock time for the measured pace", () => {
    expect(calculatePace(90, 90_000)).toBe(60);
    expect(getGapRate(100_000, 85_000)).toBeCloseTo(0.15);
  });

  it("keeps queued TTS chunks below the long-utterance cutoff", () => {
    const chunks = splitForSpeech(["하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열"], 30);
    expect(chunks.map((chunk) => chunk.wordCount)).toEqual([4, 4, 2]);
    // 9s planned. Chrome cuts network voices at roughly 15s, so even an engine
    // running ~60% slower than assumed still lands inside the window.
    expect(Math.max(...chunks.map((chunk) => (chunk.wordCount / 30) * 60_000))).toBeLessThanOrEqual(9_000);
  });

  it("raises the target only after two consecutive 2/2 sessions", () => {
    expect(getRecommendedPace(49, 2, 2)).toBe(51);
    expect(getRecommendedPace(49, 2, 1)).toBe(49);
    expect(getRecommendedPace(49, 2, 0)).toBe(49);
    expect(getRecommendedPace(49, 2, null)).toBe(49);
    expect(getRecommendedPace(49, 2)).toBe(49);
  });

  it("still drops immediately on 0/2 and holds on 1/2", () => {
    expect(getRecommendedPace(49, 1, 2)).toBe(49);
    expect(getRecommendedPace(49, 0, 2)).toBe(47);
    expect(getRecommendedPace(49, 0)).toBe(47);
  });

  it("clamps at both limits", () => {
    expect(getRecommendedPace(110, 2, 2)).toBe(110);
    expect(getRecommendedPace(30, 0, 0)).toBe(30);
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
      quizTimeMs: 36_000,
      questionTimeMs: [18_000, 18_000],
      quizTargetTimeMs: 36_000,
      zoneId: "q41",
      recommendedPace: 62,
      completedAt: "2026-08-15T00:00:00.000Z",
    } satisfies TrainingSession;
    expect(getCalibratedTtsPace([base])).toBe(120);
  });

  it("refuses a calibration outside the realistic 60-300 band", () => {
    const base = {
      id: "1",
      passageId: "p1",
      passageTitle: "test",
      requestedMode: "audio",
      effectiveMode: "audio",
      targetPace: 60,
      playbackRate: 0.1,
      wordCount: 100,
      wallTimeMs: 100_000,
      speechTimeMs: 100_000,
      gapTimeMs: 0,
      startupDelayMs: 0,
      // 500 / 0.1 = 5,000 語節/分. Import validation allows exactly this pair.
      measuredPace: 500,
      speechPace: 500,
      correctCount: 2,
      answers: [0, 1],
      quizTimeMs: 36_000,
      questionTimeMs: [18_000, 18_000],
      quizTargetTimeMs: 36_000,
      zoneId: "ideal",
      recommendedPace: 62,
      completedAt: "2026-08-15T00:00:00.000Z",
    } satisfies TrainingSession;
    expect(getCalibratedTtsPace([base])).toBe(DEFAULT_TTS_PACE);
    expect(getCalibratedTtsPace([{ ...base, playbackRate: 10, measuredPace: 10 }])).toBe(DEFAULT_TTS_PACE);
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
      quizTimeMs: 36_000,
      questionTimeMs: [18_000, 18_000],
      quizTargetTimeMs: 36_000,
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

  it("does not offer a passage back for review on the same day", () => {
    // The result screen has just shown the answers, the evidence sentence and the
    // translation. Re-running the same two questions minutes later measures memory.
    const sessions = [session("a", "weekend-01", 0, "2026-08-15T09:00:00.000Z")];
    expect(getReviewCandidates(sessions, new Date("2026-08-15T09:05:00.000Z"))).toEqual([]);
    expect(getReviewCandidates(sessions, new Date("2026-08-16T09:05:00.000Z"))).toHaveLength(1);
  });

  it("accepts an explicit minDays, including 0 for the old behaviour", () => {
    const sessions = [session("a", "weekend-01", 0, "2026-08-15T09:00:00.000Z")];
    const now = new Date("2026-08-15T09:05:00.000Z");
    expect(getReviewCandidates(sessions, now, { minDays: 0 })).toHaveLength(1);
    expect(getReviewCandidates(sessions, now, { minDays: 3 })).toEqual([]);
    expect(getReviewCandidates(sessions, new Date("2026-08-19T09:05:00.000Z"), { minDays: 3 })).toHaveLength(1);
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
    expect(passages.length).toBeGreaterThanOrEqual(31);
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
        if (question.evidenceSentences) {
          expect(question.evidenceSentences.length).toBeGreaterThanOrEqual(2);
          expect(new Set(question.evidenceSentences).size).toBe(question.evidenceSentences.length);
          for (const evidenceIndex of question.evidenceSentences) {
            expect(sentences[evidenceIndex], `${question.id} の根拠文 ${evidenceIndex}`).toBeTruthy();
          }
        }
      }
    }
  });

  it("offers a meaningful intermediate long-form set", () => {
    const challenges = passages.filter((passage) => passage.level !== "1–2級");
    expect(challenges.length).toBeGreaterThanOrEqual(6);
    expect(challenges.every((passage) => countEojeol(passage.text) >= 110)).toBe(true);
    // The 2–3級 band is the bridge out of the beginner set; one lone passage makes the step too steep.
    expect(passages.filter((passage) => passage.level === "2–3級").length).toBeGreaterThanOrEqual(14);
  });

  it("keeps the ten added intermediate passages and their reusable TOPIK vocabulary", () => {
    const added = passages.filter((passage) => passage.order >= 22 && passage.order <= 31);
    expect(added).toHaveLength(10);
    expect(added.every((passage) => passage.level === "2–3級")).toBe(true);
    const reusableTerms = [
      "영향", "참여", "효과", "비용", "증가", "감소", "원인", "제도", "예방", "조사",
      "운영", "이용", "확인", "정보", "계획", "제공", "기준", "변화", "문제", "방법",
      "필요", "결과", "시설", "조건", "지원", "공개", "관리", "신뢰", "신청", "기록", "안내",
    ];
    for (const passage of added) {
      const hits = reusableTerms.filter((term) => passage.text.includes(term));
      expect(hits.length, `${passage.id} の再利用性が高い中級語彙`).toBeGreaterThanOrEqual(5);
    }
    const corpus = added.map((passage) => passage.text).join(" ");
    for (const term of ["영향", "참여", "효과", "비용", "증가", "감소", "원인", "제도", "예방", "조사"]) {
      expect(corpus, `${term} を中級10本の本文に含める`).toContain(term);
    }
  });

  it("repeats topics so the per-topic breakdown has something to average", () => {
    const perTopic = new Map<string, number>();
    for (const passage of passages) {
      perTopic.set(passage.topic, (perTopic.get(passage.topic) ?? 0) + 1);
    }
    expect([...perTopic.values()].some((count) => count > 1)).toBe(true);
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

  it("does not make the correct choice uniquely longest often enough to become a shortcut", () => {
    for (const level of ["1–2級", "2–3級", "3–4級"] as const) {
      const questions = passages.filter((passage) => passage.level === level).flatMap((passage) => passage.questions);
      const uniquelyLongestCorrect = questions.filter((question) => {
        const lengths = question.choices.map((choice) => [...choice.replace(/\s/g, "")].length);
        const maximum = Math.max(...lengths);
        return lengths[question.answer] === maximum && lengths.filter((length) => length === maximum).length === 1;
      });
      expect(uniquelyLongestCorrect.length / questions.length, `${level} の正解最長率`).toBeLessThanOrEqual(0.4);
    }
  });

  it("uses evidence from across the passage for synthesis questions", () => {
    const synthesisQuestionIds = [
      "local-festival-16-q2",
      "recommendation-18-q2",
      "market-19-q1",
      "hospital-20-q1",
      "exercise-21-q1",
      "housing-contract-22-q1",
      "work-training-23-q2",
      "heat-shelter-24-q1",
      "night-museum-25-q2",
      "payment-habit-26-q1",
      "toy-library-27-q2",
      "battery-return-28-q2",
      "transfer-sign-29-q2",
      "used-trade-30-q2",
      "tourism-flow-31-q2",
    ];
    for (const questionId of synthesisQuestionIds) {
      const passage = passages.find((item) => item.questions.some((question) => question.id === questionId));
      const question = passage?.questions.find((item) => item.id === questionId);
      const sentenceCount = passage ? splitSentences(passage.text).length : 0;
      expect(question?.evidenceSentences, questionId).toBeTruthy();
      expect(question?.evidenceSentences?.length ?? 0, questionId).toBeGreaterThanOrEqual(2);
      expect(question?.evidenceSentences?.some((index) => index < sentenceCount - 2), questionId).toBe(true);
    }
  });

  it("keeps audited Korean and Japanese wording fixes in place", () => {
    const koreanCorpus = passages.map((passage) => `${passage.titleKo} ${passage.text}`).join(" ");
    for (const wording of [
      "우산의 색과 탄 시간",
      "정리한다고 하면서",
      "회사 친구들",
      "결혼한 지 오 년이 된 날",
      "병원의 기다리는 시간",
      "과정 완료율",
      "버스 운행을 한 차례 늘렸습니다",
      "짧은 설명 프로그램",
      "작은 연회비",
      "표지가 늦게 나타난",
      "방문 시간과 장소를 나누어 안내한",
    ]) {
      expect(koreanCorpus, `不自然な表現「${wording}」`).not.toContain(wording);
    }
    const japaneseCorpus = translations.flatMap((translation) => translation.sentences).join(" ");
    expect(japaneseCorpus).not.toContain("温かいお湯");
    expect(japaneseCorpus).not.toContain("会社の友達");
    expect(japaneseCorpus).not.toContain("建物に設定された債務");
    expect(japaneseCorpus).not.toContain("お金が出入りする時点");
    expect(japaneseCorpus).not.toContain("共有所");
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

  it("has a Japanese explanation for every question", () => {
    // The result screen reads these with optional chaining, so a missing one disappears silently.
    for (const passage of passages) {
      const translation = translations.find((item) => item.passageId === passage.id);
      for (const question of passage.questions) {
        const explanation = translation?.explanations?.[question.id];
        expect(explanation, `${question.id} の日本語解説`).toBeTruthy();
        expect(explanation?.trim().length ?? 0).toBeGreaterThan(0);
      }
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
      // One 2/2 alone no longer raises the target; the previous session is unknown here.
      recommendedPace: 50,
      // No rate was recorded, so it must not be fabricated as 1 and fed to TTS calibration.
      playbackRate: null,
      quizTimeMs: 0,
      questionTimeMs: [],
      quizTargetTimeMs: 0,
    });
  });

  it("gives an id-less legacy record the same id every time it is imported", () => {
    const backup = JSON.stringify([
      {
        textId: "legacy-1",
        mode: "tts",
        target: 50,
        eojeolCount: 100,
        durationMs: 120_000,
        comprehension: 2,
        date: "2026-08-01T00:00:00.000Z",
      },
      {
        textId: "legacy-2",
        mode: "visual",
        target: 50,
        eojeolCount: 100,
        durationMs: 120_000,
        comprehension: 1,
        date: "2026-08-02T00:00:00.000Z",
      },
    ]);
    const first = parseImportBundle(backup).sessions.map((item) => item.id);
    const second = parseImportBundle(backup).sessions.map((item) => item.id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
    expect(first.every((id) => id.startsWith("legacy-"))).toBe(true);
  });

  it("keeps a recorded playback rate for audio sessions", () => {
    const result = parseImportBundle(JSON.stringify({
      schemaVersion: 3,
      sessions: [{ passageId: "weekend-01", effectiveMode: "audio", rate: 0.8, completedAt: "2026-08-01T00:00:00.000Z" }],
    }));
    expect(result.sessions[0].playbackRate).toBe(0.8);
  });

  it("rejects an object without a sessions array", () => {
    expect(() => parseImportBundle("{}")).toThrow(/sessions/);
  });

  it("rejects oversized or excessive imports before processing them", () => {
    expect(() => parseImportBundle(" ".repeat(MAX_IMPORT_BYTES + 1))).toThrow(/2MB/);
    expect(() => parseImportBundle(JSON.stringify({
      sessions: Array.from({ length: MAX_IMPORT_SESSIONS + 1 }, () => ({})),
    }))).toThrow(/多すぎます/);
    expect(() => parseImportBundle(JSON.stringify({
      sessions: [],
      baselineMeasurements: Array.from({ length: MAX_IMPORT_BASELINES + 1 }, () => ({ pace: 40 })),
    }))).toThrow(/多すぎます/);
  });

  it("skips only the size and count caps when enforceLimits is false", () => {
    // Our own localStorage payload must never be rejected by import-sized limits.
    const many = JSON.stringify({
      schemaVersion: 3,
      sessions: Array.from({ length: MAX_IMPORT_SESSIONS + 1 }, (_, index) => ({
        passageId: `p-${index}`,
        completedAt: "2026-08-01T00:00:00.000Z",
      })),
      baselineMeasurements: Array.from({ length: MAX_IMPORT_BASELINES + 1 }, () => ({ pace: 40 })),
    });
    expect(many.length).toBeGreaterThan(0);
    const result = parseImportBundle(many, { enforceLimits: false });
    expect(result.sessions).toHaveLength(MAX_IMPORT_SESSIONS + 1);
    expect(result.baselineMeasurements).toHaveLength(MAX_IMPORT_BASELINES + 1);

    const huge = JSON.stringify({
      schemaVersion: 3,
      sessions: [{ passageId: "x".repeat(MAX_IMPORT_BYTES), completedAt: "2026-08-01T00:00:00.000Z" }],
    });
    expect(huge.length).toBeGreaterThan(MAX_IMPORT_BYTES);
    expect(parseImportBundle(huge, { enforceLimits: false }).sessions).toHaveLength(1);
  });

  it("still validates and normalises when enforceLimits is false", () => {
    expect(() => parseImportBundle("{}", { enforceLimits: false })).toThrow(/sessions/);
    expect(() => parseImportBundle(JSON.stringify({ app: "another-app", sessions: [] }), { enforceLimits: false }))
      .toThrow(/別のアプリ/);
    expect(() => parseImportBundle(JSON.stringify({ schemaVersion: 99, sessions: [] }), { enforceLimits: false }))
      .toThrow(/新しい形式/);
    const result = parseImportBundle(JSON.stringify({
      schemaVersion: 3,
      sessions: [{ passageId: "weekend-01", wordCount: 99_999, correctCount: 99, completedAt: "not-a-date" }],
    }), { enforceLimits: false });
    expect(result.sessions[0]).toMatchObject({ wordCount: 10_000, correctCount: 2 });
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
        quizTimeMs: 999_999_999,
        questionTimeMs: [-1, 999_999_999, 20_000],
        quizTargetTimeMs: 999_999_999,
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
      quizTimeMs: 7_200_000,
      questionTimeMs: [0, 3_600_000],
      quizTargetTimeMs: 7_200_000,
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
