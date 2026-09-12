import { useCallback, useEffect, useRef, useState } from "react";
import { calculatePace, countEojeol, splitForSpeech } from "../lib/training";
import type { SpeechChunk } from "../lib/training";
import type { ReadingMeasurement, TrainingMode } from "../types";

type RunnerStatus = "idle" | "preparing" | "running" | "restarting" | "complete";

/** Chrome は voiceschanged が来るまで getVoices() が空を返す。初回訪問の取りこぼし対策の待ち時間。 */
const VOICE_LIST_TIMEOUT_MS = 1200;
/** 発話が止まったと見なすまでの猶予（想定所要時間の2倍 + この値）。 */
const WATCHDOG_SLACK_MS = 5_000;

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

function getVoicesSafe(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  try {
    return window.speechSynthesis.getVoices() ?? [];
  } catch {
    return [];
  }
}

function pickKoreanVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find((voice) => voice.lang.toLowerCase() === "ko-kr") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ko")) ??
    null
  );
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
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
  const watchdogRef = useRef<number | null>(null);
  const voiceWaitRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);
  const visualFallbackRef = useRef(false);
  const speechStartedRef = useRef(false);
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const rawPlaybackRate = targetPace / calibratedTtsPace;
  const playbackRate = requestedMode === "audio" ? Math.min(10, Math.max(0.1, rawPlaybackRate)) : null;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const stopClock = useCallback(() => {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    stopClock();
    clearWatchdog();
    if (voiceWaitRef.current) {
      voiceWaitRef.current();
      voiceWaitRef.current = null;
    }
  }, [clearWatchdog, stopClock]);

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
      // 非表示のまま走らせると、読んでいない試行が勝手に完走して記録される。
      // ReadingScreen 側にも可視性ガードはあるが、preparing / restarting の隙間を
      // 塞げるのはランナー側だけなので、ここでも止める。
      if (isHidden()) {
        cancel();
        return;
      }
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
        if (cancelledRef.current) {
          animationRef.current = null;
          return;
        }
        const elapsed = performance.now() - startTime;
        setElapsedMs(elapsed);
        setProgress(Math.min(1, elapsed / plannedTotalMs));
        if (elapsed < plannedTotalMs) {
          animationRef.current = window.requestAnimationFrame(tick);
        } else {
          animationRef.current = null;
        }
      };
      animationRef.current = window.requestAnimationFrame(tick);

      const finishTimer = window.setTimeout(() => {
        if (cancelledRef.current) return;
        const wallTimeMs = performance.now() - startTime;
        stopClock();
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
    [cancel, clearTimers, sentences, stopClock, targetPace],
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
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      fallbackToVisual("この端末では音声合成を利用できません");
      return;
    }

    const synth = window.speechSynthesis;
    setStatus("preparing");
    setNotice("韓国語音声を準備しています…");

    const speakWith = (voice: SpeechSynthesisVoice) => {
      const totalWords = sentences.reduce((sum, sentence) => sum + countEojeol(sentence), 0);
      const speechChunks = splitForSpeech(sentences, targetPace);
      const queuedAt = performance.now();
      const chunkStarts = new Map<number, number>();
      let firstStart = 0;
      let speechTimeMs = 0;

      synth.cancel();
      utterancesRef.current = [];

      // 音声モードでも時計を毎フレーム進める。onstart / onend でしか更新しないと、
      // 最初のチャンクが鳴り終わるまで 0:00 のまま止まって見える。
      // 進捗バーはチャンク単位のままでよい。
      const startClock = () => {
        if (animationRef.current !== null) return;
        const tick = () => {
          if (cancelledRef.current || visualFallbackRef.current || !firstStart) {
            animationRef.current = null;
            return;
          }
          setElapsedMs(performance.now() - firstStart);
          animationRef.current = window.requestAnimationFrame(tick);
        };
        animationRef.current = window.requestAnimationFrame(tick);
      };

      // onend も onerror も来ないまま固まる既知の失敗（長い発話の打ち切り、
      // エンジンの停止、タブ復帰後の speaking 固着）を拾う。想定所要の2倍 + 5秒。
      const armWatchdog = (chunk: SpeechChunk) => {
        clearWatchdog();
        const expectedMs = (chunk.wordCount / targetPace) * 60_000;
        watchdogRef.current = window.setTimeout(() => {
          watchdogRef.current = null;
          if (cancelledRef.current || visualFallbackRef.current) return;
          fallbackToVisual("再生中に韓国語音声の応答が止まりました");
        }, expectedMs * 2 + WATCHDOG_SLACK_MS);
      };

      // The queue can also stall between utterances, where neither onend nor onerror fires
      // again. The next chunk should start almost at once, so watch the gap too.
      const armGapWatchdog = () => {
        clearWatchdog();
        watchdogRef.current = window.setTimeout(() => {
          watchdogRef.current = null;
          if (cancelledRef.current || visualFallbackRef.current) return;
          fallbackToVisual("再生中に韓国語音声の応答が止まりました");
        }, WATCHDOG_SLACK_MS);
      };

      speechChunks.forEach((chunk, chunkIndex) => {
        const utterance = new SpeechSynthesisUtterance(chunk.text);
        utterance.lang = "ko-KR";
        utterance.voice = voice;
        utterance.rate = playbackRate ?? 1;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onstart = () => {
          if (cancelledRef.current || visualFallbackRef.current) return;
          if (isHidden()) {
            cancel();
            return;
          }
          const now = performance.now();
          speechStartedRef.current = true;
          if (!firstStart) firstStart = now;
          chunkStarts.set(chunkIndex, now);
          armWatchdog(chunk);
          setStatus("running");
          setNotice(null);
          setActiveSentence(chunk.sentenceIndex);
          setElapsedMs(now - firstStart);
          setProgress(chunkIndex / speechChunks.length);
          startClock();
        };

        utterance.onend = () => {
          if (cancelledRef.current || visualFallbackRef.current) return;
          clearWatchdog();
          const now = performance.now();
          const chunkStart = chunkStarts.get(chunkIndex);
          if (chunkStart) speechTimeMs += now - chunkStart;

          if (chunkIndex === speechChunks.length - 1 && firstStart) {
            const wallTimeMs = now - firstStart;
            const gapTimeMs = Math.max(0, wallTimeMs - speechTimeMs);
            clearTimers();
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
          } else {
            armGapWatchdog();
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
    };

    const begin = (voices: SpeechSynthesisVoice[]) => {
      if (cancelledRef.current) return;
      const voice = pickKoreanVoice(voices);
      if (!voice) {
        fallbackToVisual("韓国語音声が見つかりませんでした");
        return;
      }
      speakWith(voice);
    };

    const initialVoices = getVoicesSafe();
    if (initialVoices.length) {
      begin(initialVoices);
      return;
    }

    // 一覧が空なのは「音声が無い」とは限らない。Chrome では voiceschanged が来るまで
    // 空のままで、同期スナップショット1回で諦めると実際には使えた音声を取り逃がす。
    // 「準備しています」の表示のまま、イベントか約1.2秒のどちらか早いほうまで待つ。
    if (typeof synth.addEventListener !== "function") {
      begin(getVoicesSafe());
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(waitTimer);
      synth.removeEventListener("voiceschanged", finish);
      voiceWaitRef.current = null;
      begin(getVoicesSafe());
    };
    const waitTimer = window.setTimeout(finish, VOICE_LIST_TIMEOUT_MS);
    synth.addEventListener("voiceschanged", finish);
    voiceWaitRef.current = () => {
      settled = true;
      window.clearTimeout(waitTimer);
      synth.removeEventListener("voiceschanged", finish);
    };
  }, [cancel, clearTimers, clearWatchdog, fallbackToVisual, playbackRate, sentences, targetPace]);

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
