import { useEffect, useMemo, useRef, useState } from "react";
import passagesData from "./data/passages.json";
import { GuideScreen } from "./components/GuideScreen";
import { Header } from "./components/Header";
import { HistoryScreen } from "./components/HistoryScreen";
import { HomeScreen } from "./components/HomeScreen";
import { QuizScreen } from "./components/QuizScreen";
import { ReadingScreen } from "./components/ReadingScreen";
import { ResultScreen } from "./components/ResultScreen";
import { getCalibratedTtsPace, getPaceZone, getRecommendedPace } from "./lib/training";
import { loadPersistedState, savePersistedState } from "./lib/storage";
import type {
  BaselineMeasurement,
  HistoryView,
  Passage,
  ReadingMeasurement,
  Screen,
  TrainerSettings,
  TrainingMode,
  TrainingSession,
} from "./types";

const passages = passagesData as Passage[];
const DEFAULT_SETTINGS: TrainerSettings = { baselinePace: 46.1, targetPace: 49, weeklyGoal: 4 };

interface RunConfig {
  passage: Passage;
  mode: TrainingMode;
  targetPace: number;
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
  const [initialState] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      return loadPersistedState(window.localStorage);
    } catch {
      return null;
    }
  });
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedPassageId, setSelectedPassageId] = useState(initialState?.selectedPassageId ?? passages[0].id);
  const [mode, setMode] = useState<TrainingMode>(initialState?.mode ?? "audio");
  const [settings, setSettings] = useState<TrainerSettings>(initialState?.settings ?? DEFAULT_SETTINGS);
  const [sessions, setSessions] = useState<TrainingSession[]>(initialState?.sessions ?? []);
  const [baselineMeasurements, setBaselineMeasurements] = useState<BaselineMeasurement[]>(
    initialState?.baselineMeasurements ?? [],
  );
  const [storageError, setStorageError] = useState<string | null>(null);
  const [runConfig, setRunConfig] = useState<RunConfig | null>(null);
  const [measurement, setMeasurement] = useState<ReadingMeasurement | null>(null);
  const [resultSession, setResultSession] = useState<TrainingSession | null>(null);
  const [reviewingPastSession, setReviewingPastSession] = useState(false);
  const [reviewMistakesOnly, setReviewMistakesOnly] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryView>("overview");
  const transitionTimerRef = useRef<number | null>(null);
  const koreanVoiceAvailable = useKoreanVoiceAvailability();
  const calibratedTtsPace = useMemo(() => getCalibratedTtsPace(sessions), [sessions]);

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
      setStorageError("端末への自動保存に失敗しました。JSONを書き出してください。");
    }
  }, [baselineMeasurements, mode, selectedPassageId, sessions, settings]);

  useEffect(() => () => {
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
  }, []);

  function clearTransitionTimer() {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  }

  function navigate(next: Screen) {
    if (next === "reading" || next === "quiz" || next === "result") return;
    clearTransitionTimer();
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function beginTraining(config?: RunConfig) {
    clearTransitionTimer();
    const passage = passages.find((item) => item.id === selectedPassageId) ?? passages[0];
    const nextConfig = config ?? { passage, mode, targetPace: settings.targetPace };
    setRunConfig(nextConfig);
    setMeasurement(null);
    setResultSession(null);
    setReviewingPastSession(false);
    setReviewMistakesOnly(false);
    setScreen("reading");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function finishReading(nextMeasurement: ReadingMeasurement) {
    setMeasurement(nextMeasurement);
    clearTransitionTimer();
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      setScreen("quiz");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 750);
  }

  function submitQuiz(answers: number[]) {
    if (!runConfig || !measurement) return;
    const correctCount = runConfig.passage.questions.reduce(
      (sum, question, index) => sum + (question.answer === answers[index] ? 1 : 0),
      0,
    );
    const recommendedPace = getRecommendedPace(runConfig.targetPace, correctCount);
    const session: TrainingSession = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`,
      passageId: runConfig.passage.id,
      passageTitle: runConfig.passage.title,
      requestedMode: runConfig.mode,
      targetPace: runConfig.targetPace,
      wordCount: runConfig.passage.text.trim().split(/\s+/).length,
      correctCount,
      answers,
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
    setScreen("result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goHomeAfterResult() {
    if (runConfig) {
      const currentIndex = passages.findIndex((passage) => passage.id === runConfig.passage.id);
      setSelectedPassageId(passages[(currentIndex + 1) % passages.length].id);
    }
    setScreen("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  function addBaselineMeasurement(pace: number, measuredAt: string, note?: string) {
    const measurement: BaselineMeasurement = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `baseline-${Date.now()}`,
      pace,
      measuredAt: new Date(`${measuredAt}T12:00:00`).toISOString(),
      note,
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
    });
    setResultSession(session);
    setReviewingPastSession(true);
    setReviewMistakesOnly(mistakesOnly);
    setScreen("result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function leaveResult() {
    if (reviewingPastSession) {
      setScreen("history");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    goHomeAfterResult();
  }

  return (
    <div className="app-shell">
      <Header screen={screen} sessionCount={sessions.length} onNavigate={navigate} immersive={screen === "reading"} />
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
          onAbort={() => setScreen("home")}
        />
      )}
      {screen === "quiz" && runConfig && <QuizScreen passage={runConfig.passage} onSubmit={submitQuiz} />}
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
          onStart={() => {
            setScreen("home");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
      {screen === "guide" && <GuideScreen onStart={() => {
        setScreen("home");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }} />}
      {screen !== "reading" && <footer className="app-footer">
        <span>읽기 Pace · 非公式学習ツール</span>
        <p>学習データは端末内だけに保存されます · TOPIKおよび運営機関とは関係ありません</p>
      </footer>}
    </div>
  );
}
