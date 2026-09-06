import { useCallback, useEffect, useRef, useState } from "react";
import { calculatePace, countEojeol, splitForSpeech } from "../lib/training";
import type { ReadingMeasurement, TrainingMode } from "../types";

type RunnerStatus = "idle" | "preparing" | "running" | "restarting" | "complete";

interface RunnerOptions {
  sentences: string[];
  targetPace: number;
  requestedMode: TrainingMode;
  calibratedTtsPace: number;
  onComplete: (measurement: ReadingMeasurement) => void;
}

interface ReadingRunner {
  status: RunnerStatus;
  activeSentence: number;
  progress: number;
  elapsedMs: number;
  notice: string | null;
  playbackRate: number | null;
  start: () => void;
  cancel: () => void;
}

function findKoreanVoice(): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === "ko-kr") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ko")) ??
    null
  );
}

export function useReadingRunner({
  sentences,
  targetPace,
  requestedMode,
  calibratedTtsPace,
  onComplete,
}: RunnerOptions): ReadingRunner {
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [activeSentence, setActiveSentence] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const animationRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);
  const visualFallbackRef = useRef(false);
  const speechStartedRef = useRef(false);
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const rawPlaybackRate = targetPace / calibratedTtsPace;
  const playbackRate = requestedMode === "audio" ? Math.min(10, Math.max(0.1, rawPlaybackRate)) : null;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    startedRef.current = false;
    clearTimers();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    utterancesRef.current = [];
    setStatus("idle");
    setActiveSentence(-1);
    setProgress(0);
    setElapsedMs(0);
    setNotice(null);
  }, [clearTimers]);

  useEffect(() => cancel, [cancel]);

  const runVisual = useCallback(
    (fallbackReason?: string) => {
      clearTimers();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      utterancesRef.current = [];
      const totalWords = sentences.reduce((sum, sentence) => sum + countEojeol(sentence), 0);
      const plannedTotalMs = (totalWords / targetPace) * 60_000;
      const startTime = performance.now();
      let accumulatedMs = 0;

      sentences.forEach((sentence, index) => {
        if (index > 0) {
          const timer = window.setTimeout(() => {
            if (!cancelledRef.current) setActiveSentence(index);
          }, accumulatedMs);
          timersRef.current.push(timer);
        }
        accumulatedMs += (countEojeol(sentence) / targetPace) * 60_000;
      });

      setStatus("running");
      setNotice(fallbackReason ? "音声を利用できなかったため、ハイライトのみで続けます。" : null);
      setActiveSentence(0);

      const tick = () => {
        if (cancelledRef.current) return;
        const elapsed = performance.now() - startTime;
        setElapsedMs(elapsed);
        setProgress(Math.min(1, elapsed / plannedTotalMs));
        if (elapsed < plannedTotalMs) {
          animationRef.current = window.requestAnimationFrame(tick);
        }
      };
      animationRef.current = window.requestAnimationFrame(tick);

      const finishTimer = window.setTimeout(() => {
        if (cancelledRef.current) return;
        const wallTimeMs = performance.now() - startTime;
        setProgress(1);
        setElapsedMs(wallTimeMs);
        setStatus("complete");
        onCompleteRef.current({
          effectiveMode: "visual",
          playbackRate: null,
          wallTimeMs,
          speechTimeMs: 0,
          gapTimeMs: 0,
          startupDelayMs: 0,
          measuredPace: calculatePace(totalWords, wallTimeMs),
          speechPace: null,
          fallbackReason,
        });
      }, plannedTotalMs);
      timersRef.current.push(finishTimer);
    },
    [clearTimers, sentences, targetPace],
  );

  const fallbackToVisual = useCallback(
    (reason: string) => {
      if (visualFallbackRef.current || cancelledRef.current) return;
      visualFallbackRef.current = true;
      clearTimers();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setStatus("restarting");
      setNotice("音声が使えないため、ハイライトのみで最初から開始します。");
      const timer = window.setTimeout(() => runVisual(reason), 900);
      timersRef.current.push(timer);
    },
    [clearTimers, runVisual],
  );

  const runAudio = useCallback(() => {
    const voice = findKoreanVoice();
    if (!voice || !("SpeechSynthesisUtterance" in window)) {
      fallbackToVisual("韓国語音声が見つかりませんでした");
      return;
    }

    const synth = window.speechSynthesis;
    const totalWords = sentences.reduce((sum, sentence) => sum + countEojeol(sentence), 0);
    const speechChunks = splitForSpeech(sentences, targetPace);
    const queuedAt = performance.now();
    const sentenceStarts = new Map<number, number>();
    let firstStart = 0;
    let speechTimeMs = 0;

    synth.cancel();
    utterancesRef.current = [];
    setStatus("preparing");
    setNotice("韓国語音声を準備しています…");

    speechChunks.forEach((chunk, chunkIndex) => {
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      utterance.lang = "ko-KR";
      utterance.voice = voice;
      utterance.rate = playbackRate ?? 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onstart = () => {
        if (cancelledRef.current) return;
        const now = performance.now();
        speechStartedRef.current = true;
        if (!firstStart) firstStart = now;
        sentenceStarts.set(chunkIndex, now);
        setStatus("running");
        setNotice(null);
        setActiveSentence(chunk.sentenceIndex);
        setElapsedMs(now - firstStart);
        setProgress(chunkIndex / speechChunks.length);
      };

      utterance.onend = () => {
        if (cancelledRef.current || visualFallbackRef.current) return;
        const now = performance.now();
        const sentenceStart = sentenceStarts.get(chunkIndex);
        if (sentenceStart) speechTimeMs += now - sentenceStart;

        if (chunkIndex === speechChunks.length - 1 && firstStart) {
          const wallTimeMs = now - firstStart;
          const gapTimeMs = Math.max(0, wallTimeMs - speechTimeMs);
          setProgress(1);
          setElapsedMs(wallTimeMs);
          setStatus("complete");
          onCompleteRef.current({
            effectiveMode: "audio",
            playbackRate,
            wallTimeMs,
            speechTimeMs,
            gapTimeMs,
            startupDelayMs: firstStart - queuedAt,
            measuredPace: calculatePace(totalWords, wallTimeMs),
            speechPace: calculatePace(totalWords, speechTimeMs),
          });
        }
      };

      utterance.onerror = () => {
        if (!cancelledRef.current) {
          fallbackToVisual(
            speechStartedRef.current
              ? "再生中に韓国語音声が停止しました"
              : "韓国語音声を開始できませんでした",
          );
        }
      };

      utterancesRef.current.push(utterance);
      synth.speak(utterance);
    });

    const startupGuard = window.setTimeout(() => {
      if (!speechStartedRef.current && !cancelledRef.current) {
        fallbackToVisual("韓国語音声の開始がタイムアウトしました");
      }
    }, 5000);
    timersRef.current.push(startupGuard);
  }, [fallbackToVisual, playbackRate, sentences, targetPace]);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    cancelledRef.current = false;
    visualFallbackRef.current = false;
    speechStartedRef.current = false;
    setProgress(0);
    setElapsedMs(0);
    setActiveSentence(-1);
    setNotice(null);
    if (requestedMode === "audio") runAudio();
    else runVisual();
  }, [requestedMode, runAudio, runVisual]);

  return {
    status,
    activeSentence,
    progress,
    elapsedMs,
    notice,
    playbackRate,
    start,
    cancel,
  };
}
