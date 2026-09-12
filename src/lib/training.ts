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

/*
 * 定数の根拠（2026-09 の総合レビューで「どこにも記録がない」と指摘されたため明文化する）
 *
 * ゾーン境界（PACE_ZONES の min）
 *   TOPIK II 読解は 70分・50問。設問と選択肢を読み判断する時間を差し引くと、
 *   本文にかけられるのは概ね半分程度になる。各到達点に必要な「語節/分」を
 *   本文語節数から逆算した概算が下の境界である。厳密な実測値ではなく設計上の目安。
 *     35 … 1〜34番へ到達できる下限
 *     49 … 1〜41番へ到達できる下限
 *     62 … 全50問へ到達できる下限
 *     72 … 全50問に加えて判断時間を確保できる
 *     85 … 迷った問題へ戻る余裕がある
 *   各ゾーンの「約76点/約86点」は到達できた設問を全問正解した場合の上限であり、
 *   期待値ではない（description の文言もそう読めるようにしてある）。
 *
 * MIN_PACE = 30 / MAX_PACE = 110
 *   目標ペースの可動域。30 は学習初期でも本文を追えるとみなせる下限、
 *   110 は本アプリが訓練対象とする上端で、これ以上は速読というより飛ばし読みになる。
 *   実測ペース自体はこの範囲外にもなり得る（clampPace は目標ペースにだけ効く）。
 *
 * ±2（getRecommendedPace の刻み）
 *   1セッションは 90〜182語節・約2〜4分。2語節/分はその尺度で体感できる最小の変化で、
 *   かつ数セッションで収束する程度に小さい。1刻みだと丸め誤差に埋もれ、5刻みだと
 *   1回の当たり外れで目標が大きく振れる。
 *
 * DEFAULT_TTS_PACE = 116
 *   rate=1.0 の韓国語 TTS が何語節/分で読むかの初期推定値。端末と音声で実際は変わるため、
 *   音声セッションが貯まり次第 getCalibratedTtsPace が直近5件の実測で置き換える。
 *   あくまで実測が無い間の暫定値。
 */
export const MIN_PACE = 30;
export const MAX_PACE = 110;
export const DEFAULT_TTS_PACE = 116;
/** getCalibratedTtsPace が採用する現実的な下限・上限（外れたら DEFAULT_TTS_PACE に戻す）。 */
export const MIN_TTS_PACE = 60;
export const MAX_TTS_PACE = 300;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_SESSIONS = 5_000;
export const MAX_IMPORT_BASELINES = 1_000;

// TOPIK II 50問の時間予算から置いた、設問を読んで判断する練習目安。
// 62語節/分なら1問18秒、72語節/分なら読解で浮いた時間を使って1問26秒。
// 公式の制限時間ではなく、このアプリ内のペース配分用の基準である。
export function getQuestionTimeTargetSeconds(targetPace: number): 18 | 26 {
  return Number.isFinite(targetPace) && targetPace >= 72 ? 26 : 18;
}

/*
 * 色は灰→ティールの一本のランプにしてある。紫系は基準値（無音実測）の「▲」マーカー
 * 専用で、ゾーン帯には使わない。以前は q41 が #8480c0 で▲と同系だったため、
 * 「到達圏の帯」と「あなたの実力値」が同じものに見えていた。
 */
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
    color: "#9db8b2",
    description: "1〜34番まで到達でき、全問正解なら約76点",
  },
  {
    id: "q41",
    label: "Q41到達圏",
    shortLabel: "Q41",
    min: 49,
    max: 62,
    color: "#6da39b",
    description: "1〜41番まで到達でき、全問正解なら約86点",
  },
  {
    id: "minimum",
    label: "最低限",
    shortLabel: "最低限",
    min: 62,
    max: 72,
    color: "#3e8f89",
    description: "全50問に目を通せる下限",
  },
  {
    id: "practical",
    label: "実用",
    shortLabel: "実用",
    min: 72,
    max: 85,
    color: "#0e6e6b",
    description: "全50問に加えて判断時間も確保できる",
  },
  {
    id: "ideal",
    label: "理想",
    shortLabel: "理想",
    min: 85,
    max: Infinity,
    color: "#0a4744",
    description: "迷った問題へ戻る余裕がある",
  },
];

export function countEojeol(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const SENTENCE_TERMINATORS = new Set([".", "!", "?", "。", "！", "？"]);
const WHITESPACE = /\s/u;

/*
 * 文末記号の直後の空白で切る。素直に書くと後読み `(?<=[.!?。！？])\s+` になるが、
 * この構文は Safari 16.3 以下（iOS 16.3 以下）ではモジュール解析時点で SyntaxError になり、
 * React ツリーごとマウントに失敗して真っ白な画面になる。リテラルで書くと catch できないので
 * new RegExp で組み立て、失敗した環境では後読みを使わない実装に落とす。
 * 両者の出力は完全に一致していなければならない（training.test.ts で照合している）。
 */
const LOOKBEHIND_SENTENCE_BOUNDARY: RegExp | null = (() => {
  try {
    return new RegExp("(?<=[.!?。！？])\\s+", "u");
  } catch {
    return null;
  }
})();

/**
 * 後読みを使わない `split(/(?<=[.!?。！？])\s+/u)` 相当。
 * 空白の連なりの直前の1文字が文末記号のときだけ、その連なり全体を区切りとして扱う。
 * テストから直接呼ぶためにエクスポートしている。
 */
export function splitSentencesFallback(normalized: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let index = 0;
  while (index < normalized.length) {
    if (index > 0 && WHITESPACE.test(normalized[index]) && SENTENCE_TERMINATORS.has(normalized[index - 1])) {
      let end = index;
      while (end < normalized.length && WHITESPACE.test(normalized[end])) end += 1;
      parts.push(normalized.slice(start, index));
      start = end;
      index = end;
      continue;
    }
    index += 1;
  }
  parts.push(normalized.slice(start));
  return parts.filter(Boolean);
}

export function splitSentences(text: string): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  if (!LOOKBEHIND_SENTENCE_BOUNDARY) return splitSentencesFallback(normalized);
  return normalized.split(LOOKBEHIND_SENTENCE_BOUNDARY).filter(Boolean);
}

export interface SpeechChunk {
  text: string;
  sentenceIndex: number;
  wordCount: number;
}

/*
 * 既定を 9 秒にしてある。分割幅は targetPace（想定語節/分）で計算するが、実際の発話長は
 * エンジン側の速度で決まる。エンジンが DEFAULT_TTS_PACE=116 の想定より遅いと、12 秒想定の
 * チャンクが Chrome のネットワーク音声の約15秒打ち切りを超えて onerror になる。
 * 9 秒なら想定より 6 割ほど遅いエンジンでも 15 秒に収まる。
 */
export function splitForSpeech(
  sentences: string[],
  targetPace: number,
  maxChunkMs = 9_000,
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
  // 該当なしのときに最上位（理想）を返すと、NaN が最高評価として表示される。圏外に倒す。
  if (!Number.isFinite(pace) || pace < 0) return PACE_ZONES[0];
  const displayedPace = Math.round(pace * 10) / 10;
  return (
    PACE_ZONES.find((zone) => displayedPace >= zone.min && displayedPace < zone.max) ??
    PACE_ZONES[0]
  );
}

/**
 * 次に到達するゾーンの下限と、そのゾーン自体を返す。
 * 最上位ゾーンにいる場合と pace が有限でない場合は null。
 */
export function getNextZoneBoundary(pace: number): { boundary: number; zone: PaceZone } | null {
  // 負の pace では最下位ゾーンの min(=0) が「次」に見えてしまうため、0 未満も除く。
  if (!Number.isFinite(pace) || pace < 0) return null;
  const next = PACE_ZONES.find((zone) => zone.min > pace);
  return next ? { boundary: next.min, zone: next } : null;
}

export function clampPace(pace: number): number {
  return Math.min(MAX_PACE, Math.max(MIN_PACE, Math.round(pace)));
}

/*
 * 2問ゲートの階段法。従来の 1-up/1-down（2/2で+2、0/2で−2）は設問正答率50%で釣り合い、
 * 4択の当て推量を補正すると真の理解度 1/3 の速度まで目標が上がってしまう。
 * +2 の条件を「2セッション連続の2/2」にすることで平衡点を押し上げる。0/2 は従来どおり即 −2。
 * previousCorrectCount が null / undefined（前回が無い、または不明）なら +2 はしない。
 */
export function getRecommendedPace(
  targetPace: number,
  correctCount: number,
  previousCorrectCount?: number | null,
): number {
  if (correctCount >= 2) {
    if (previousCorrectCount != null && previousCorrectCount >= 2) return clampPace(targetPace + 2);
    return clampPace(targetPace);
  }
  if (correctCount <= 0) return clampPace(targetPace - 2);
  return clampPace(targetPace);
}

export function getReviewCandidates(
  sessions: TrainingSession[],
  now: Date = new Date(),
  options: { minDays?: number } = {},
): ReviewCandidate[] {
  // 正解と解説を見た直後に同じ2問を復習できると、理解度ゲートが記憶テストになる。
  // 既定では翌日以降になるまで候補に出さない。
  const minDays = options.minDays ?? 1;
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
    // 暦日で数える。23時に落とした文章が翌朝には復習できるようにするため、
    // 経過24時間ではなく日付の差で判定する。
    .filter((session) => calendarDaysBetween(new Date(session.completedAt), now) >= minDays)
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

function calendarDaysBetween(from: Date, to: Date): number {
  const startOfDay = (date: Date) => {
    const copy = new Date(date.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy.getTime();
  };
  if (Number.isNaN(from.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
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

  const weighted = candidates.reduce((sum, session) => {
    const normalizedPace = session.measuredPace / (session.playbackRate ?? 1);
    return sum + normalizedPace * (session.wordCount / totalWords);
  }, 0);

  // インポート検証は measuredPace を最大500、playbackRate を最小0.1まで許すので、
  // 正規化後は 5,000 語節/分まで出得る。そのまま採用すると次回の再生速度が下限に張り付く。
  // 現実的な帯から外れた値は信用せず既定値に戻す。
  if (!Number.isFinite(weighted) || weighted < MIN_TTS_PACE || weighted > MAX_TTS_PACE) {
    return DEFAULT_TTS_PACE;
  }
  return weighted;
}

/*
 * 決定的な Fisher-Yates。Math.random は使わない（同じ (length, seed) は必ず同じ並び）。
 * 返り値は 表示インデックス -> 元インデックス の対応表で、選択肢の並びを試行ごとに
 * 入れ替えつつ、セッションには元のインデックスで保存できるようにするためのもの。
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffleOrder(length: number, seed: number): number[] {
  const size = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  const order = Array.from({ length: size }, (_, index) => index);
  const random = mulberry32(Number.isFinite(seed) ? Math.trunc(seed) : 0);
  for (let index = size - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = order[index];
    order[index] = order[swap];
    order[swap] = held;
  }
  return order;
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

/** FNV-1a 32bit。id を持たない旧バックアップに、中身から決まる安定した id を与えるために使う。 */
function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
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
  // 速度の記録が無い音声セッションに 1 を捏造すると、そのまま TTS 較正の材料になってしまう。
  // 不明は null にして getCalibratedTtsPace の対象から外す。
  const playbackRate = effectiveMode === "audio" && playbackRateRaw !== undefined && playbackRateRaw !== null
    ? boundedNumber(playbackRateRaw, 1, 0.1, 10)
    : null;
  const questionTimeMs = Array.isArray(item.questionTimeMs)
    ? item.questionTimeMs.slice(0, 2).map((time) => Math.round(boundedNumber(time, 0, 0, 3_600_000)))
    : [];
  const summedQuestionTimeMs = questionTimeMs.reduce((sum, time) => sum + time, 0);
  const quizTimeMs = Math.round(boundedNumber(item.quizTimeMs, summedQuestionTimeMs, 0, 7_200_000));
  const quizTargetTimeMs = Math.round(boundedNumber(item.quizTargetTimeMs, 0, 0, 7_200_000));
  const passageId = limitedString(item.passageId ?? item.textId, `imported-${index + 1}`, 160);
  const fallbackDate = new Date().toISOString();
  const rawCompletedAt = item.completedAt ?? item.date;
  // id を Date.now() から作ると、同じ旧バックアップを2回読むたびに別 id になり、
  // App 側の Map による重複排除をすり抜けて全セッションが二重登録される。
  // レコードの中身だけから決まる id にして、何度読み込んでも同じ値にする。
  const fallbackId = `legacy-${stableHash([
    passageId,
    typeof rawCompletedAt === "string" ? rawCompletedAt : "",
    measuredPace,
    wordCount,
    index,
  ].join("|"))}`;

  return {
    id: limitedString(item.id, fallbackId, 160),
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
    quizTimeMs,
    questionTimeMs,
    quizTargetTimeMs,
    zoneId: getPaceZone(measuredPace).id,
    recommendedPace: clampPace(
      asNumber(item.recommendedPace, getRecommendedPace(targetPace, correctCount)),
    ),
    completedAt: normalizedDate(item.completedAt ?? item.date, fallbackDate),
  };
}

/**
 * `enforceLimits` は既定 true（手動インポートの挙動）。
 * false のときは MAX_IMPORT_BYTES / MAX_IMPORT_SESSIONS / MAX_IMPORT_BASELINES の
 * 件数・サイズ検査だけを飛ばす。検証と正規化は同じものが走る。
 * 自分の localStorage を読むときに、インポート用の上限で自分の記録が拒否されるのを防ぐため。
 */
export function parseImportBundle(input: string, options: { enforceLimits?: boolean } = {}): {
  sessions: TrainingSession[];
  settings?: TrainerSettings;
  baselineMeasurements: BaselineMeasurement[];
  migrated: boolean;
} {
  const enforceLimits = options.enforceLimits ?? true;
  if (enforceLimits && input.length > MAX_IMPORT_BYTES) {
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
  if (enforceLimits && rawSessions.length > MAX_IMPORT_SESSIONS) {
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
  if (enforceLimits && rawBaselines.length > MAX_IMPORT_BASELINES) {
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
        quizTimeMs: item.quizTimeMs === undefined
          ? undefined
          : Math.round(boundedNumber(item.quizTimeMs, 0, 0, 7_200_000)),
        quizTargetTimeMs: item.quizTargetTimeMs === undefined
          ? undefined
          : Math.round(boundedNumber(item.quizTargetTimeMs, 0, 0, 7_200_000)),
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

export function formatAnswerDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return `${(safeMs / 1000).toFixed(1)}秒`;
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
