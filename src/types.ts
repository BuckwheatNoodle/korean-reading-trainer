export type TrainingMode = "audio" | "visual";

export interface Question {
  id: string;
  prompt: string;
  choices: string[];
  answer: number;
  evidenceSentence: number;
  explanation: string;
}

export interface Passage {
  id: string;
  order: number;
  title: string;
  titleKo: string;
  topic: string;
  level: "1–2級" | "2–3級" | "3–4級";
  text: string;
  questions: Question[];
}

export interface PassageTranslation {
  passageId: string;
  sentences: string[];
}

export interface BaselineMeasurement {
  id: string;
  pace: number;
  measuredAt: string;
  note?: string;
}

export interface PaceZone {
  id: "outside" | "q34" | "q41" | "minimum" | "practical" | "ideal";
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  color: string;
  description: string;
}

export interface ReadingMeasurement {
  effectiveMode: TrainingMode;
  playbackRate: number | null;
  wallTimeMs: number;
  speechTimeMs: number;
  gapTimeMs: number;
  startupDelayMs: number;
  measuredPace: number;
  speechPace: number | null;
  fallbackReason?: string;
}

export interface TrainingSession extends ReadingMeasurement {
  id: string;
  passageId: string;
  passageTitle: string;
  requestedMode: TrainingMode;
  targetPace: number;
  wordCount: number;
  correctCount: number;
  answers: number[];
  zoneId: PaceZone["id"];
  recommendedPace: number;
  completedAt: string;
}

export interface TrainerSettings {
  baselinePace: number;
  targetPace: number;
  weeklyGoal: number;
}

export interface ExportBundle {
  schemaVersion: 3;
  app: "topik-reading-pace-trainer";
  exportedAt: string;
  settings: TrainerSettings;
  baselineMeasurements: BaselineMeasurement[];
  sessions: TrainingSession[];
}

export type Screen = "home" | "reading" | "quiz" | "result" | "history" | "guide";
export type HistoryView = "overview" | "sessions" | "baselines";
