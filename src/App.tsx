import { useEffect, useMemo, useRef, useState } from "react";
import passagesData from "./data/passages.json";
import { GuideScreen } from "./components/GuideScreen";
import { Header } from "./components/Header";
import { HistoryScreen } from "./components/HistoryScreen";
import { HomeScreen } from "./components/HomeScreen";
import { MeasureScreen } from "./components/MeasureScreen";
import { BaselineResultScreen } from "./components/BaselineResultScreen";
import { QuizScreen } from "./components/QuizScreen";
import { ReadingScreen } from "./components/ReadingScreen";
import { ResultScreen } from "./components/ResultScreen";
import {
  calculatePace,
  countEojeol,
  getCalibratedTtsPace,
  getPaceZone,
  getRecommendedPace,
} from "./lib/training";
import { QUARANTINE_KEY, loadPersistedStateResult, savePersistedState } from "./lib/storage";
import type {
  BaselineMeasurement,
  HistoryView,
  Passage,
  QuizTiming,
  ReadingMeasurement,
  Screen,
  TrainerSettings,
  TrainingMode,
  TrainingSession,
} from "./types";

const passages = passagesData as Passage[];
const DEFAULT_SETTINGS: TrainerSettings = { baselinePace: 46.1, targetPace: 49, weeklyGoal: 4 };

/** Screens that only exist inside App's orchestration; Header never needs to know them. */
type AppScreen = Screen | "measure" | "measure-result";

/** Screens the user must leave through an explicit in-page control, never the header. */
const LOCKED_SCREENS: AppScreen[] = ["reading", "quiz", "result", "measure", "measure-result"];

/** Screens where a stray reload or back gesture would throw away an unsaved measurement. */
const IN_SESSION_SCREENS: AppScreen[] = ["reading", "quiz", "measure"];

const SCREEN_TITLES: Record<AppScreen, string> = {
  home: "トレーニングの設定",
  reading: "読解",
  quiz: "内容確認",
  result: "結果",
  history: "学習の記録",
  guide: "使い方",
  measure: "無音実測",
  "measure-result": "無音実測の結果",
};

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

interface RunConfig {
  passage: Passage;
  mode: TrainingMode;
  targetPace: number;
  kind: "training" | "measure";
}

interface BaselineOutcome {
  passage: Passage;
  pace: number;
  wallTimeMs: number;
  correctCount: number;
  answers: number[];
  quizTimeMs: number;
  quizTargetTimeMs: number;
  recorded: boolean;
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // randomUUID needs a secure context; over plain http we still must not collide across devices.
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Hand the unreadable data back to the user; keeping it on the device alone helps nobody. */
function downloadQuarantinedState(): void {
  const raw = window.localStorage.getItem(QUARANTINE_KEY);
  if (!raw) return;
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `topik-reading-unreadable-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function localDateInput(date: Date = new Date()): string {
  const offsetCorrected = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetCorrected.toISOString().slice(0, 10);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function useKoreanVoiceAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setAvailable(false);
      return;
    }
    const synth = window.speechSynthesis;
    const check = () => {
      const voices = synth.getVoices();
      if (voices.length) setAvailable(voices.some((voice) => voice.lang.toLowerCase().startsWith("ko")));
    };
    check();
    synth.addEventListener("voiceschanged", check);
    const timer = window.setTimeout(() => {
      const voices = synth.getVoices();
      setAvailable(voices.some((voice) => voice.lang.toLowerCase().startsWith("ko")));
    }, 1200);
    return () => {
      synth.removeEventListener("voiceschanged", check);
      window.clearTimeout(timer);
    };
  }, []);

  return available;
}

export default function App() {
  const [initial] = useState(() => {
    if (typeof window === "undefined") return { state: null, quarantined: false };
    try {
      return loadPersistedStateResult(window.localStorage);
    } catch {
      return { state: null, quarantined: false };
    }
  });
  const initialState = initial.state;
  const [screen, setScreen] = useState<AppScreen>("home");
  const [selectedPassageId, setSelectedPassageId] = useState(initialState?.selectedPassageId ?? passages[0].id);
  const [mode, setMode] = useState<TrainingMode>(initialState?.mode ?? "audio");
  const [settings, setSettings] = useState<TrainerSettings>(initialState?.settings ?? DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<TrainingSession[]>(initialState?.sessions ?? []);
  const [baselineMeasurements, setBaselineMeasurements] = useState<BaselineMeasurement[]>(
    initialState?.baselineMeasurements ?? [],
  );
  const [storageError, setStorageError] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState(initial.quarantined);
  const [runConfig, setRunConfig] = useState<RunConfig | null>(null);
  const [measurement, setMeasurement] = useState<ReadingMeasurement | null>(null);
  const [baselineWallTimeMs, setBaselineWallTimeMs] = useState<number | null>(null);
  const [baselineOutcome, setBaselineOutcome] = useState<BaselineOutcome | null>(null);
  const [resultSession, setResultSession] = useState<TrainingSession | null>(null);
  const [reviewingPastSession, setReviewingPastSession] = useState(false);
  const [reviewMistakesOnly, setReviewMistakesOnly] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryView>("overview");
  const [skipLinkVisible, setSkipLinkVisible] = useState(false);
  const transitionTimerRef = useRef<number | null>(null);
  const historyGuardRef = useRef(false);
  const ignorePopRef = useRef(false);
  const firstRenderRef = useRef(true);
  const koreanVoiceAvailable = useKoreanVoiceAvailability();
  const calibratedTtsPace = useMemo(() => getCalibratedTtsPace(sessions), [sessions]);
  const previousCorrectCount = sessions.length ? sessions[sessions.length - 1].correctCount : null;

  useEffect(() => {
    try {
      savePersistedState(window.localStorage, {
        selectedPassageId,
        mode,
        settings,
        baselineMeasurements,
        sessions,
      });
      setStorageError(null);
    } catch {
      setStorageError("端末への自動保存に失敗しました。記録画面の「バックアップを保存」からJSONを書き出してください。");
    }
  }, [baselineMeasurements, mode, selectedPassageId, sessions, settings]);

  useEffect(() => () => {
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
  }, []);

  // Move focus to the new screen so keyboard and screen-reader users are not stranded on the header.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const main = document.querySelector<HTMLElement>("main.page");
    main?.focus({ preventScroll: true });
  }, [screen]);

  // A reload or tab close mid-session silently discards the measurement, so warn first.
  useEffect(() => {
    if (!IN_SESSION_SCREENS.includes(screen)) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [screen]);

  // The back gesture is the most common way to leave a screen on Android. Catch it instead of
  // letting it drop the user out of the site with an unsaved session.
  useEffect(() => {
    const handlePop = () => {
      if (ignorePopRef.current) {
        ignorePopRef.current = false;
        return;
      }
      if (!historyGuardRef.current) return;
      historyGuardRef.current = false;
      clearTransitionTimer();
      setRunConfig(null);
      setMeasurement(null);
      setBaselineWallTimeMs(null);
      setScreen("home");
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  function pushHistoryGuard() {
    if (historyGuardRef.current) return;
    historyGuardRef.current = true;
    window.history.pushState({ trainerGuard: true }, "");
  }

  function releaseHistoryGuard() {
    if (!historyGuardRef.current) return;
    historyGuardRef.current = false;
    ignorePopRef.current = true;
    window.history.back();
  }

  function clearTransitionTimer() {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }

  function goTo(next: AppScreen) {
    setScreen(next);
    scrollToTop();
  }

  function navigate(next: Screen) {
    if (LOCKED_SCREENS.includes(next)) return;
    clearTransitionTimer();
    goTo(next);
  }

  function beginTraining(config?: RunConfig) {
    clearTransitionTimer();
    const passage = passages.find((item) => item.id === selectedPassageId) ?? passages[0];
    const nextConfig = config ?? { passage, mode, targetPace: settings.targetPace, kind: "training" as const };
    setRunConfig(nextConfig);
    setMeasurement(null);
    setResultSession(null);
    setBaselineOutcome(null);
    setBaselineWallTimeMs(null);
    setReviewingPastSession(false);
    setReviewMistakesOnly(false);
    pushHistoryGuard();
    goTo("reading");
  }

  function beginBaselineMeasurement(passageId: string) {
    const passage = passages.find((item) => item.id === passageId) ?? passages[0];
    clearTransitionTimer();
    setRunConfig({ passage, mode: "visual", targetPace: settings.targetPace, kind: "measure" });
    setMeasurement(null);
    setResultSession(null);
    setBaselineOutcome(null);
    setBaselineWallTimeMs(null);
    setReviewingPastSession(false);
    setReviewMistakesOnly(false);
    pushHistoryGuard();
    goTo("measure");
  }

  /** Leaving a session for good: drop the run state and the extra history entry together. */
  function exitSession(next: AppScreen) {
    clearTransitionTimer();
    releaseHistoryGuard();
    setRunConfig(null);
    setMeasurement(null);
    setBaselineWallTimeMs(null);
    goTo(next);
  }

  function finishReading(nextMeasurement: ReadingMeasurement) {
    setMeasurement(nextMeasurement);
    clearTransitionTimer();
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      goTo("quiz");
    }, 750);
  }

  function finishBaselineReading(wallTimeMs: number) {
    setBaselineWallTimeMs(wallTimeMs);
    clearTransitionTimer();
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      goTo("quiz");
    }, 750);
  }

  function countCorrect(passage: Passage, answers: number[]): number {
    return passage.questions.reduce(
      (sum, question, index) => sum + (question.answer === answers[index] ? 1 : 0),
      0,
    );
  }

  function submitQuiz(answers: number[], timing: QuizTiming) {
    if (!runConfig) return;
    if (runConfig.kind === "measure") {
      submitBaselineQuiz(answers, timing);
      return;
    }
    if (!measurement) return;
    const correctCount = countCorrect(runConfig.passage, answers);
    const recommendedPace = getRecommendedPace(runConfig.targetPace, correctCount, previousCorrectCount);
    const session: TrainingSession = {
      id: createId("session-"),
      passageId: runConfig.passage.id,
      passageTitle: runConfig.passage.title,
      requestedMode: runConfig.mode,
      targetPace: runConfig.targetPace,
      wordCount: countEojeol(runConfig.passage.text),
      correctCount,
      answers,
      quizTimeMs: timing.totalTimeMs,
      questionTimeMs: timing.questionTimeMs,
      quizTargetTimeMs: timing.targetTimeMs,
      zoneId: getPaceZone(measurement.measuredPace).id,
      recommendedPace,
      completedAt: new Date().toISOString(),
      ...measurement,
    };
    setSessions((current) => [...current, session]);
    setSettings((current) => ({ ...current, targetPace: recommendedPace }));
    setResultSession(session);
    setReviewingPastSession(false);
    setReviewMistakesOnly(false);
    goTo("result");
  }

  function submitBaselineQuiz(answers: number[], timing: QuizTiming) {
    if (!runConfig || baselineWallTimeMs === null) return;
    const passage = runConfig.passage;
    const correctCount = countCorrect(passage, answers);
    const pace = calculatePace(countEojeol(passage.text), baselineWallTimeMs);
    // Only a comprehended read tells us anything about reading ability, so the gate guards the record.
    const recorded = correctCount >= 2 && Number.isFinite(pace) && pace > 0;
    if (recorded) {
      addBaselineMeasurement(pace, localDateInput(), `${passage.title}で実測`, timing);
    }
    setBaselineOutcome({
      passage,
      pace,
      wallTimeMs: baselineWallTimeMs,
      correctCount,
      answers,
      quizTimeMs: timing.totalTimeMs,
      quizTargetTimeMs: timing.targetTimeMs,
      recorded,
    });
    setBaselineWallTimeMs(null);
    goTo("measure-result");
  }

  function goHomeAfterResult() {
    if (runConfig) {
      const currentIndex = passages.findIndex((passage) => passage.id === runConfig.passage.id);
      setSelectedPassageId(passages[(currentIndex + 1) % passages.length].id);
    }
    exitSession("home");
  }

  function importSessions(
    imported: TrainingSession[],
    importedSettings?: TrainerSettings,
    importedBaselines: BaselineMeasurement[] = [],
  ) {
    setSessions((current) => {
      const map = new Map(current.map((session) => [session.id, session]));
      imported.forEach((session) => map.set(session.id, session));
      return [...map.values()].sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
      );
    });
    if (importedSettings) setSettings(importedSettings);
    if (importedBaselines.length) {
      setBaselineMeasurements((current) => {
        const map = new Map(current.map((item) => [item.id, item]));
        importedBaselines.forEach((item) => map.set(item.id, item));
        return [...map.values()].sort(
          (a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime(),
        );
      });
    }
  }

  function addBaselineMeasurement(pace: number, measuredAt: string, note?: string, quizTiming?: QuizTiming) {
    const parsed = new Date(`${measuredAt}T12:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt) || Number.isNaN(parsed.getTime())) return;
    const measurement: BaselineMeasurement = {
      id: createId("baseline-"),
      pace,
      measuredAt: parsed.toISOString(),
      note,
      quizTimeMs: quizTiming?.totalTimeMs,
      quizTargetTimeMs: quizTiming?.targetTimeMs,
    };
    setBaselineMeasurements((current) => [...current, measurement]);
    setSettings((current) => ({ ...current, baselinePace: pace }));
  }

  function resetLocalData() {
    setSelectedPassageId(passages[0].id);
    setMode("audio");
    setSettings({ ...DEFAULT_SETTINGS });
    setSessions([]);
    setBaselineMeasurements([]);
    setRunConfig(null);
    setMeasurement(null);
    setResultSession(null);
    setBaselineOutcome(null);
    setBaselineWallTimeMs(null);
    setReviewingPastSession(false);
    setReviewMistakesOnly(false);
    setHistoryView("overview");
  }

  function continueToNextTraining() {
    if (!runConfig || !resultSession) return;
    const currentIndex = passages.findIndex((passage) => passage.id === runConfig.passage.id);
    const nextPassage = passages[(currentIndex + 1) % passages.length];
    setSelectedPassageId(nextPassage.id);
    beginTraining({
      passage: nextPassage,
      mode: runConfig.mode,
      targetPace: resultSession.recommendedPace,
      kind: "training",
    });
  }

  function startSuggestedReview(session: TrainingSession) {
    const passage = passages.find((item) => item.id === session.passageId);
    if (!passage) return;
    setSelectedPassageId(passage.id);
    setMode(session.requestedMode);
    beginTraining({
      passage,
      mode: session.requestedMode,
      targetPace: session.recommendedPace,
      kind: "training",
    });
  }

  function reviewSession(session: TrainingSession, mistakesOnly = false) {
    const passage = passages.find((item) => item.id === session.passageId);
    if (!passage) return;
    clearTransitionTimer();
    setRunConfig({
      passage,
      mode: session.requestedMode,
      targetPace: session.targetPace,
      kind: "training",
    });
    setResultSession(session);
    setReviewingPastSession(true);
    setReviewMistakesOnly(mistakesOnly);
    pushHistoryGuard();
    goTo("result");
  }

  function leaveResult() {
    if (reviewingPastSession) {
      exitSession("history");
      return;
    }
    goHomeAfterResult();
  }

  const immersive = screen === "reading" || screen === "quiz" || screen === "measure";
  const headerScreen: Screen = screen === "measure" || screen === "measure-result" ? "home" : screen;

  return (
    <div className="app-shell">
      <a
        href="#main-content"
        onFocus={() => setSkipLinkVisible(true)}
        onBlur={() => setSkipLinkVisible(false)}
        onClick={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>("main.page")?.focus();
        }}
        style={skipLinkVisible
          ? {
              position: "fixed",
              top: 8,
              left: 8,
              zIndex: 100,
              padding: "8px 14px",
              borderRadius: 8,
              background: "#0e6e6b",
              color: "#ffffff",
              fontSize: 13,
              textDecoration: "none",
            }
          : srOnly}
      >
        本文へスキップ
      </a>

      <Header screen={headerScreen} sessionCount={sessions.length} onNavigate={navigate} immersive={immersive} />

      <p role="status" style={srOnly}>{SCREEN_TITLES[screen]}</p>

      {recoveryNotice && (
        <div
          role="alert"
          style={{
            margin: "12px auto 0",
            maxWidth: 1120,
            width: "calc(100% - 32px)",
            padding: "10px 14px",
            border: "1px solid rgba(168, 58, 44, .45)",
            background: "rgba(168, 58, 44, .10)",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.7,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <span>
            前回の保存データを読み込めなかったため、新しい記録として開始しました。
            バックアップJSONがあれば、記録画面の「バックアップを読み込む」から復元してください。
            読めなかったデータは端末内に退避してあり、下のボタンで書き出せます。
          </span>
          <span style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <button
              type="button"
              onClick={downloadQuarantinedState}
              style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", fontSize: 13, padding: 0, textDecoration: "underline" }}
            >
              退避データを書き出す
            </button>
            <button
              type="button"
              onClick={() => setRecoveryNotice(false)}
              style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", fontSize: 13, padding: 0 }}
            >
              閉じる
            </button>
          </span>
        </div>
      )}

      <div id="main-content" />

      {screen === "home" && (
        <HomeScreen
          selectedPassageId={selectedPassageId}
          mode={mode}
          settings={settings}
          sessions={sessions}
          koreanVoiceAvailable={koreanVoiceAvailable}
          calibratedTtsPace={calibratedTtsPace}
          baselineMeasurements={baselineMeasurements}
          storageError={storageError}
          onSelectPassage={setSelectedPassageId}
          onModeChange={setMode}
          onSettingsChange={setSettings}
          onAddBaseline={addBaselineMeasurement}
          onStartReview={startSuggestedReview}
          onStartMeasurement={beginBaselineMeasurement}
          onStart={() => beginTraining()}
        />
      )}
      {screen === "reading" && runConfig && (
        <ReadingScreen
          passage={runConfig.passage}
          mode={runConfig.mode}
          targetPace={runConfig.targetPace}
          calibratedTtsPace={calibratedTtsPace}
          onComplete={finishReading}
          onAbort={() => exitSession("home")}
        />
      )}
      {screen === "measure" && runConfig && (
        <MeasureScreen
          passage={runConfig.passage}
          onComplete={finishBaselineReading}
          onAbort={() => exitSession("home")}
        />
      )}
      {screen === "quiz" && runConfig && (
        <QuizScreen
          passage={runConfig.passage}
          targetPace={runConfig.targetPace}
          measuring={runConfig.kind === "measure"}
          onSubmit={submitQuiz}
        />
      )}
      {screen === "measure-result" && baselineOutcome && (
        <BaselineResultScreen
          outcome={baselineOutcome}
          targetPace={settings.targetPace}
          onApplyTarget={(pace) => setSettings((current) => ({ ...current, targetPace: pace }))}
          onRetry={() => beginBaselineMeasurement(baselineOutcome.passage.id)}
          onHome={() => exitSession("home")}
        />
      )}
      {screen === "result" && runConfig && resultSession && (
        <ResultScreen
          key={resultSession.id}
          passage={runConfig.passage}
          session={resultSession}
          baselinePace={baselineMeasurements.length ? settings.baselinePace : undefined}
          reviewOnly={reviewingPastSession}
          initialMistakesOnly={reviewMistakesOnly}
          onHome={leaveResult}
          onRetry={() => beginTraining({
            passage: runConfig.passage,
            mode: runConfig.mode,
            targetPace: resultSession.recommendedPace,
            kind: "training",
          })}
          onContinue={continueToNextTraining}
        />
      )}
      {screen === "history" && (
        <HistoryScreen
          sessions={sessions}
          settings={settings}
          view={historyView}
          baselineMeasurements={baselineMeasurements}
          onImport={importSessions}
          onReview={reviewSession}
          onViewChange={setHistoryView}
          onReset={resetLocalData}
          onStart={() => goTo("home")}
        />
      )}
      {screen === "guide" && <GuideScreen onStart={() => goTo("home")} />}
      {!immersive && <footer className="app-footer">
        <span><span lang="ko">읽기</span> Pace · 非公式学習ツール</span>
        <p>学習データは端末内だけに保存されます · TOPIKおよび運営機関とは関係ありません</p>
      </footer>}
    </div>
  );
}
