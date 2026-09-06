import type {
  BaselineMeasurement,
  ExportBundle,
  Passage,
  PaceZone,
  TrainerSettings,
  TrainingMode,
  TrainingSession,
} from "../types";

export interface ReviewCandidate {
  passageId: string;
  session: TrainingSession;
  incorrectCount: number;
  previousMisses: number;
  daysSinceAttempt: number;
  priority: number;
}

export interface TopicProgress {
  topic: string;
  passageTitles: string[];
  sessionCount: number;
  correctCount: number;
  questionCount: number;
  accuracy: number;
  latestAt: string;
}

export const MIN_PACE = 30;
export const MAX_PACE = 110;
export const DEFAULT_TTS_PACE = 116;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_SESSIONS = 5_000;
export const MAX_IMPORT_BASELINES = 1_000;

export const PACE_ZONES: PaceZone[] = [
  {
    id: "outside",
    label: "圏外",
    shortLabel: "圏外",
    min: 0,
    max: 35,
    color: "#c0c7c3",
    description: "Q34にも届かないペース",
  },
  {
    id: "q34",
    label: "Q34到達圏",
    shortLabel: "Q34",
    min: 35,
    max: 49,
    color: "#93a6b6",
    description: "1〜34番で約76点が見込めるペース",
  },
  {
    id: "q41",
    label: "Q41到達圏",
    shortLabel: "Q41",
    min: 49,
    max: 62,
    color: "#8480c0",
    description: "1〜41番で約86点が見込めるペース",
  },
  {
    id: "minimum",
    label: "最低限",
    shortLabel: "最低限",
    min: 62,
    max: 72,
    color: "#3e8f89",
    description: "全50問へ到達できる目安",
  },
  {
    id: "practical",
    label: "実用",
    shortLabel: "実用",
    min: 72,
    max: 85,
    color: "#0e6e6b",
    description: "判断時間も確保しやすいペース",
  },
  {
    id: "ideal",
    label: "理想",
    shortLabel: "理想",
    min: 85,
    max: Infinity,
    color: "#0a4744",
    description: "迷った問題へ戻る余裕があるペース",
  },
];

export function countEojeol(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function splitSentences(text: string): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  return normalized.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
}

export interface SpeechChunk {
  text: string;
  sentenceIndex: number;
  wordCount: number;
}

export function splitForSpeech(
  sentences: string[],
  targetPace: number,
  maxChunkMs = 12_000,
): SpeechChunk[] {
  const maxWords = Math.max(1, Math.floor((targetPace * maxChunkMs) / 60_000));
  return sentences.flatMap((sentence, sentenceIndex) => {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    const chunks: SpeechChunk[] = [];
    for (let start = 0; start < words.length; start += maxWords) {
      const slice = words.slice(start, start + maxWords);
      chunks.push({ text: slice.join(" "), sentenceIndex, wordCount: slice.length });
    }
    return chunks;
  });
}

export function getPaceZone(pace: number): PaceZone {
  const displayedPace = Math.round(pace * 10) / 10;
  return (
    PACE_ZONES.find((zone) => displayedPace >= zone.min && displayedPace < zone.max) ??
    PACE_ZONES[PACE_ZONES.length - 1]
  );
}

export function clampPace(pace: number): number {
  return Math.min(MAX_PACE, Math.max(MIN_PACE, Math.round(pace)));
}

export function getRecommendedPace(targetPace: number, correctCount: number): number {
  if (correctCount >= 2) return clampPace(targetPace + 2);
  if (correctCount <= 0) return clampPace(targetPace - 2);
  return clampPace(targetPace);
}

export function getReviewCandidates(
  sessions: TrainingSession[],
  now: Date = new Date(),
): ReviewCandidate[] {
  const latestByPassage = new Map<string, TrainingSession>();
  const missesByPassage = new Map<string, number>();

  for (const session of sessions) {
    const current = latestByPassage.get(session.passageId);
    if (!current || new Date(session.completedAt).getTime() > new Date(current.completedAt).getTime()) {
      latestByPassage.set(session.passageId, session);
    }
    missesByPassage.set(
      session.passageId,
      (missesByPassage.get(session.passageId) ?? 0) + Math.max(0, 2 - session.correctCount),
    );
  }

  return [...latestByPassage.values()]
    .filter((session) => session.correctCount < 2)
    .map((session) => {
      const incorrectCount = Math.max(0, 2 - session.correctCount);
      const elapsedMs = Math.max(0, now.getTime() - new Date(session.completedAt).getTime());
      const daysSinceAttempt = Math.floor(elapsedMs / 86_400_000);
      const previousMisses = missesByPassage.get(session.passageId) ?? incorrectCount;
      return {
        passageId: session.passageId,
        session,
        incorrectCount,
        previousMisses,
        daysSinceAttempt,
        priority: incorrectCount * 100 + Math.min(30, daysSinceAttempt) + Math.min(20, previousMisses),
      };
    })
    .sort((a, b) => b.priority - a.priority || new Date(a.session.completedAt).getTime() - new Date(b.session.completedAt).getTime());
}

export function getTopicProgress(sessions: TrainingSession[], passages: Passage[]): TopicProgress[] {
  const passageById = new Map(passages.map((passage) => [passage.id, passage]));
  const byTopic = new Map<string, Omit<TopicProgress, "accuracy">>();

  for (const session of sessions) {
    const passage = passageById.get(session.passageId);
    if (!passage) continue;
    const current = byTopic.get(passage.topic) ?? {
      topic: passage.topic,
      passageTitles: [],
      sessionCount: 0,
      correctCount: 0,
      questionCount: 0,
      latestAt: session.completedAt,
    };
    current.sessionCount += 1;
    current.correctCount += session.correctCount;
    current.questionCount += passage.questions.length;
    if (!current.passageTitles.includes(passage.title)) current.passageTitles.push(passage.title);
    if (new Date(session.completedAt).getTime() > new Date(current.latestAt).getTime()) {
      current.latestAt = session.completedAt;
    }
    byTopic.set(passage.topic, current);
  }

  return [...byTopic.values()]
    .map((item) => ({
      ...item,
      accuracy: item.questionCount ? item.correctCount / item.questionCount : 0,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.sessionCount - a.sessionCount || b.latestAt.localeCompare(a.latestAt));
}

export function getGapRate(wallTimeMs: number, speechTimeMs: number): number {
  if (wallTimeMs <= 0) return 0;
  return Math.max(0, (wallTimeMs - speechTimeMs) / wallTimeMs);
}

export function calculatePace(wordCount: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return (wordCount * 60_000) / durationMs;
}

export function getCalibratedTtsPace(sessions: TrainingSession[]): number {
  const candidates = sessions
    .filter(
      (session) =>
        session.effectiveMode === "audio" &&
        session.playbackRate !== null &&
        session.playbackRate > 0 &&
        session.speechTimeMs > 0 &&
        session.measuredPace > 0,
    )
    .slice(-5);

  if (!candidates.length) return DEFAULT_TTS_PACE;

  const totalWords = candidates.reduce((sum, session) => sum + session.wordCount, 0);
  if (!totalWords) return DEFAULT_TTS_PACE;

  return candidates.reduce((sum, session) => {
    const normalizedPace = session.measuredPace / (session.playbackRate ?? 1);
    return sum + normalizedPace * (session.wordCount / totalWords);
  }, 0);
}

export function makeExportBundle(
  sessions: TrainingSession[],
  settings: TrainerSettings,
  baselineMeasurements: BaselineMeasurement[] = [],
): ExportBundle {
  return {
    schemaVersion: 3,
    app: "topik-reading-pace-trainer",
    exportedAt: new Date().toISOString(),
    settings,
    baselineMeasurements,
    sessions,
  };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, asNumber(value, fallback)));
}

function limitedString(value: unknown, fallback: string, maxLength: number): string {
  return (typeof value === "string" ? value : fallback).slice(0, maxLength);
}

function normalizedDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeMode(value: unknown): TrainingMode {
  return value === "audio" || value === "tts" || value === "音声つき" ? "audio" : "visual";
}

function migrateSession(raw: unknown, index: number): TrainingSession | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const wordCount = Math.round(boundedNumber(item.wordCount ?? item.eojeolCount, 0, 0, 10_000));
  const wallTimeMs = boundedNumber(item.wallTimeMs ?? item.durationMs, 0, 0, 86_400_000);
  const speechTimeMs = boundedNumber(item.speechTimeMs ?? item.speakingMs, 0, 0, wallTimeMs);
  const measuredPace = boundedNumber(
    item.measuredPace ?? item.pace,
    calculatePace(wordCount, wallTimeMs),
    0,
    500,
  );
  const correctCount = Math.round(boundedNumber(item.correctCount ?? item.comprehension, 0, 0, 2));
  const targetPace = clampPace(asNumber(item.targetPace ?? item.target, 46));
  const effectiveMode = normalizeMode(item.effectiveMode ?? item.mode);
  const playbackRateRaw = item.playbackRate ?? item.rate;
  const playbackRate = effectiveMode === "audio"
    ? boundedNumber(playbackRateRaw, 1, 0.1, 10)
    : null;
  const passageId = limitedString(item.passageId ?? item.textId, `imported-${index + 1}`, 160);
  const fallbackDate = new Date().toISOString();

  return {
    id: limitedString(item.id, `imported-${Date.now()}-${index}`, 160),
    passageId,
    passageTitle: limitedString(item.passageTitle ?? item.title, passageId, 160),
    requestedMode: normalizeMode(item.requestedMode ?? item.mode),
    effectiveMode,
    targetPace,
    playbackRate,
    wordCount,
    wallTimeMs,
    speechTimeMs,
    gapTimeMs: boundedNumber(
      item.gapTimeMs ?? item.gapMs,
      Math.max(0, wallTimeMs - speechTimeMs),
      0,
      wallTimeMs,
    ),
    startupDelayMs: boundedNumber(item.startupDelayMs, 0, 0, wallTimeMs),
    measuredPace,
    speechPace:
      effectiveMode === "audio"
        ? boundedNumber(item.speechPace, calculatePace(wordCount, speechTimeMs), 0, 500)
        : null,
    fallbackReason: typeof item.fallbackReason === "string" ? item.fallbackReason.slice(0, 240) : undefined,
    correctCount,
    answers: Array.isArray(item.answers)
      ? item.answers.slice(0, 2).map((answer) => Math.round(boundedNumber(answer, -1, -1, 3)))
      : [],
    zoneId: getPaceZone(measuredPace).id,
    recommendedPace: clampPace(
      asNumber(item.recommendedPace, getRecommendedPace(targetPace, correctCount)),
    ),
    completedAt: normalizedDate(item.completedAt ?? item.date, fallbackDate),
  };
}

export function parseImportBundle(input: string): {
  sessions: TrainingSession[];
  settings?: TrainerSettings;
  baselineMeasurements: BaselineMeasurement[];
  migrated: boolean;
} {
  if (input.length > MAX_IMPORT_BYTES) {
    throw new Error("JSONが大きすぎます（上限2MB）。");
  }
  const parsed: unknown = JSON.parse(input);
  const isLegacyArray = Array.isArray(parsed);
  const root = (!isLegacyArray && parsed !== null && typeof parsed === "object")
    ? parsed as Record<string, unknown>
    : {};
  if (root.app !== undefined && root.app !== "topik-reading-pace-trainer") {
    throw new Error("別のアプリで作成されたJSONです。");
  }
  if (typeof root.schemaVersion === "number" && root.schemaVersion > 3) {
    throw new Error("このアプリより新しい形式のJSONです。アプリを更新してから読み込んでください。");
  }
  const rawSessions = isLegacyArray ? parsed : root?.sessions;
  if (!Array.isArray(rawSessions)) {
    throw new Error("sessions 配列が見つかりません。");
  }
  if (rawSessions.length > MAX_IMPORT_SESSIONS) {
    throw new Error(`練習履歴が多すぎます（上限${MAX_IMPORT_SESSIONS.toLocaleString("ja-JP")}件）。`);
  }

  const sessions = rawSessions
    .map((session, index) => migrateSession(session, index))
    .filter((session): session is TrainingSession => session !== null);

  if (!sessions.length && rawSessions.length) {
    throw new Error("読み込めるセッションがありませんでした。");
  }

  const rawSettings = root.settings && typeof root.settings === "object" && !Array.isArray(root.settings)
    ? root.settings as Record<string, unknown>
    : undefined;
  const settings = rawSettings
    ? {
        baselinePace: boundedNumber(rawSettings.baselinePace, 46.1, 1, 200),
        targetPace: clampPace(asNumber(rawSettings.targetPace, 49)),
        weeklyGoal: Math.round(boundedNumber(rawSettings.weeklyGoal, 4, 1, 21)),
      }
    : undefined;

  const rawBaselines = Array.isArray(root?.baselineMeasurements)
    ? root.baselineMeasurements
    : [];
  if (rawBaselines.length > MAX_IMPORT_BASELINES) {
    throw new Error(`無音実測の記録が多すぎます（上限${MAX_IMPORT_BASELINES.toLocaleString("ja-JP")}件）。`);
  }
  const baselineMeasurements = rawBaselines
    .map((raw, index): BaselineMeasurement | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const pace = boundedNumber(item.pace, 0, 0, 200);
      if (pace <= 0) return null;
      const fallbackDate = new Date().toISOString();
      return {
        id: limitedString(item.id, `baseline-${index}-${Date.now()}`, 160),
        pace,
        measuredAt: normalizedDate(item.measuredAt ?? item.date, fallbackDate),
        note: typeof item.note === "string" ? item.note.slice(0, 80) : undefined,
      };
    })
    .filter((item): item is BaselineMeasurement => item !== null);

  return {
    sessions,
    settings,
    baselineMeasurements,
    migrated: isLegacyArray || root?.schemaVersion !== 3,
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
