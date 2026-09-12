import { useEffect, useMemo, useRef, useState } from "react";
import { countEojeol, splitSentences } from "../lib/training";
import type { Passage } from "../types";
import { Icon } from "./Icon";

interface MeasureScreenProps {
  passage: Passage;
  onComplete: (wallTimeMs: number) => void;
  onAbort: () => void;
}

type MeasureStatus = "idle" | "reading" | "done";

/**
 * Silent self-paced reading. No audio, no highlight, and deliberately no visible clock:
 * the point is to measure how fast the reader actually reads, not how fast a timer pushes them.
 */
export function MeasureScreen({ passage, onComplete, onAbort }: MeasureScreenProps) {
  const sentences = useMemo(() => splitSentences(passage.text), [passage.text]);
  const wordCount = useMemo(() => countEojeol(passage.text), [passage.text]);
  const [status, setStatus] = useState<MeasureStatus>("idle");
  const [interruptionNotice, setInterruptionNotice] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && startedAtRef.current !== null && status === "reading") {
        startedAtRef.current = null;
        setStatus("idle");
        setInterruptionNotice("画面が非表示になったため、この計測を中止しました。最初からやり直してください。");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [status]);

  function start() {
    setInterruptionNotice(null);
    startedAtRef.current = performance.now();
    setStatus("reading");
  }

  function finish() {
    const startedAt = startedAtRef.current;
    if (startedAt === null) return;
    startedAtRef.current = null;
    setStatus("done");
    onComplete(performance.now() - startedAt);
  }

  return (
    <main className="page reading-page" tabIndex={-1}>
      <div className="session-toolbar">
        <button type="button" className="quiet-button" onClick={onAbort}>
          <Icon name="close" size={17} /> 中止
        </button>
        <div className="session-toolbar__center">
          <span>{passage.order.toString().padStart(2, "0")} · {passage.title}</span>
          <strong>無音・自力 · {wordCount}語節</strong>
        </div>
        <div className="session-timer" aria-hidden="true">— : —</div>
      </div>

      <section className="reading-shell">
        <div className="reading-heading">
          <div>
            <p className="section-kicker">SILENT BASELINE</p>
            <h1 lang="ko">{passage.titleKo}</h1>
          </div>
          <div className="sentence-counter"><strong>{sentences.length}</strong><span>文</span></div>
        </div>

        {status === "idle" && (
          <div className="reading-start-panel">
            <span className="reading-start-panel__icon"><Icon name="book" size={28} /></span>
            <div>
              <strong>{interruptionNotice ? "計測をやり直せます" : "自分のペースで、声も助けもなく読みます"}</strong>
              <p>
                {interruptionNotice
                  ?? "「読み始める」を押してから、いつもどおり黙読してください。読み終えたらすぐボタンを押します。時間は表示しません。"}
              </p>
            </div>
            <button type="button" className="primary-button" onClick={start}>
              <Icon name="play" size={18} /> {interruptionNotice ? "最初からやり直す" : "読み始める"}
            </button>
          </div>
        )}

        <article className={`reading-paper ${status === "reading" ? "is-running" : ""}`} lang="ko" tabIndex={0} role="region" aria-label="本文">
          {sentences.map((sentence, index) => (
            <span key={`${passage.id}-measure-${index}`} className="reading-sentence">
              {sentence}{" "}
            </span>
          ))}
        </article>

        {status === "reading" && (
          <button type="button" className="primary-button primary-button--large" onClick={finish}>
            <Icon name="check" size={19} /> 読み終えました
          </button>
        )}

        {status === "done" && (
          <div className="reading-complete"><Icon name="check" size={18} /> 計測完了。内容確認へ進みます…</div>
        )}

        <p className="reading-hint">
          <Icon name="info" size={14} /> 実力を測る回です。急がず、いつもどおりの速さで読んでください。このあとの2問に両方正解したときだけ記録します。
        </p>
      </section>
    </main>
  );
}
