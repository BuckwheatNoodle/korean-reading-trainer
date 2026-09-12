import { useEffect, useMemo, useRef, useState } from "react";
import { useReadingRunner } from "../hooks/useReadingRunner";
import { getReadingScrollTarget } from "../lib/readingScroll";
import { formatDuration, splitSentences } from "../lib/training";
import type { Passage, ReadingMeasurement, TrainingMode } from "../types";
import { Icon } from "./Icon";

interface ReadingScreenProps {
  passage: Passage;
  mode: TrainingMode;
  targetPace: number;
  calibratedTtsPace: number;
  onComplete: (measurement: ReadingMeasurement) => void;
  onAbort: () => void;
}

/** Any status where the run is under way, so losing sight of the screen invalidates the measurement. */
const ACTIVE_STATUSES = ["preparing", "running", "restarting"];

export function ReadingScreen({
  passage,
  mode,
  targetPace,
  calibratedTtsPace,
  onComplete,
  onAbort,
}: ReadingScreenProps) {
  const sentences = useMemo(() => splitSentences(passage.text), [passage.text]);
  const [interruptionNotice, setInterruptionNotice] = useState<string | null>(null);
  const paperRef = useRef<HTMLElement>(null);
  const sentenceRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const runner = useReadingRunner({
    sentences,
    targetPace,
    requestedMode: mode,
    calibratedTtsPace,
    onComplete,
  });
  const hasStarted = runner.status !== "idle";
  const currentNumber = runner.activeSentence >= 0 ? runner.activeSentence + 1 : 0;
  const progressPercent = Math.round(runner.progress * 100);

  useEffect(() => {
    const paper = paperRef.current;
    const active = sentenceRefs.current[runner.activeSentence];
    if (!paper || !active || runner.activeSentence < 1) return;
    const paperRect = paper.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const target = getReadingScrollTarget({
      scrollTop: paper.scrollTop,
      viewportTop: paperRect.top,
      viewportBottom: paperRect.bottom,
      activeTop: activeRect.top,
      activeBottom: activeRect.bottom,
      comfortMargin: Math.min(72, paper.clientHeight * 0.18),
    });
    if (target === null) return;
    // The CSS scroll-behavior override for reduced motion does not reach an explicit JS behavior.
    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    paper.scrollTo({
      top: Math.min(target, Math.max(0, paper.scrollHeight - paper.clientHeight)),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [runner.activeSentence]);

  useEffect(() => {
    const handleVisibility = () => {
      // "running" alone leaves a hole: hiding the tab during TTS start-up or the fallback wait
      // used to let the run finish in the background and record a passage nobody read.
      if (document.hidden && ACTIVE_STATUSES.includes(runner.status)) {
        runner.cancel();
        setInterruptionNotice("画面が非表示になったため、この試行を中止しました。最初からやり直してください。");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [runner.cancel, runner.status]);

  return (
    <main className="page reading-page" tabIndex={-1}>
      <div className="session-toolbar">
        <button type="button" className="quiet-button" onClick={() => { runner.cancel(); onAbort(); }}>
          <Icon name="close" size={17} /> 中止
        </button>
        <div className="session-toolbar__center">
          <span>{passage.order.toString().padStart(2, "0")} · {passage.title}</span>
          <strong>{mode === "audio" ? "音声つき" : "ハイライトのみ"} · {targetPace} 語節/分</strong>
        </div>
        <div className="session-timer">{formatDuration(runner.elapsedMs)}</div>
      </div>

      <div
        className="reading-progress"
        role="progressbar"
        aria-label="読解の進捗"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
        aria-valuetext={`${progressPercent}%`}
      >
        <span style={{ width: `${runner.progress * 100}%` }} />
      </div>

      <section className="reading-shell">
        <div className="reading-heading">
          <div>
            <p className="section-kicker">READ WITH THE FLOW</p>
            <h1 lang="ko">{passage.titleKo}</h1>
          </div>
          <div className="sentence-counter"><strong>{currentNumber || "–"}</strong><span>/ {sentences.length} 文</span></div>
        </div>

        {runner.status === "idle" && (
          <div className="reading-start-panel">
            <span className="reading-start-panel__icon"><Icon name={mode === "audio" ? "headphones" : "eye"} size={28} /></span>
            <div>
              <strong>{interruptionNotice ? "最初からやり直せます" : mode === "audio" ? "音声とハイライトに合わせて読みます" : "ハイライトに合わせて読みます"}</strong>
              <p>{interruptionNotice ?? "一語ずつ戻らず、色が移ったら次の文へ進んでください。"}</p>
            </div>
            <button type="button" className="primary-button" onClick={() => { setInterruptionNotice(null); runner.start(); }}>
              <Icon name="play" size={18} /> {interruptionNotice ? "最初からやり直す" : "読み始める"}
            </button>
          </div>
        )}

        <article
          ref={paperRef}
          className={`reading-paper ${hasStarted ? "is-running" : ""}`}
          lang="ko"
          tabIndex={0}
          role="region"
          aria-label="本文"
        >
          {sentences.map((sentence, index) => (
            <span
              key={`${passage.id}-${index}`}
              ref={(element) => { sentenceRefs.current[index] = element; }}
              className={`reading-sentence ${runner.activeSentence === index ? "is-active" : ""} ${runner.activeSentence > index ? "is-read" : ""}`}
            >
              {sentence}{" "}
            </span>
          ))}
        </article>

        <div role="status">
          {runner.notice && (
            <div className={`runner-notice ${runner.status === "restarting" ? "is-warning" : ""}`}>
              <Icon name={runner.status === "preparing" ? "volume" : "info"} size={17} />
              {runner.notice}
            </div>
          )}

          {runner.status === "complete" && (
            <div className="reading-complete"><Icon name="check" size={18} /> 読解完了。内容確認へ進みます…</div>
          )}
        </div>

        <p className="reading-hint">
          <Icon name="info" size={14} /> ハイライトは文単位です。前の文に戻らず、意味のまとまりを保って進みましょう。
        </p>
      </section>
    </main>
  );
}
