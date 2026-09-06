import { useMemo, useState } from "react";
import translationsData from "../data/translations-ja.json";
import { getGapRate, getPaceZone, splitSentences } from "../lib/training";
import type { Passage, PassageTranslation, TrainingSession } from "../types";
import { Icon } from "./Icon";
import { ZoneBar } from "./ZoneBar";

const translations = translationsData as PassageTranslation[];
type ResultTab = "summary" | "answers" | "translation";

interface ResultScreenProps {
  passage: Passage;
  session: TrainingSession;
  baselinePace?: number;
  reviewOnly?: boolean;
  initialMistakesOnly?: boolean;
  onHome: () => void;
  onRetry: () => void;
  onContinue: () => void;
}

export function ResultScreen({
  passage,
  session,
  baselinePace,
  reviewOnly = false,
  initialMistakesOnly = false,
  onHome,
  onRetry,
  onContinue,
}: ResultScreenProps) {
  const incorrectCount = passage.questions.filter((question, index) => session.answers[index] !== question.answer).length;
  const [tab, setTab] = useState<ResultTab>(initialMistakesOnly || session.correctCount < 2 ? "answers" : "summary");
  const [showOnlyIncorrect, setShowOnlyIncorrect] = useState(initialMistakesOnly && incorrectCount > 0);
  const [showJapanese, setShowJapanese] = useState(true);
  const zone = getPaceZone(session.measuredPace);
  const gapRate = getGapRate(session.wallTimeMs, session.speechTimeMs);
  const passed = session.correctCount >= 2;
  const sentences = useMemo(() => splitSentences(passage.text), [passage.text]);
  const translation = translations.find((item) => item.passageId === passage.id);
  const evidenceIndexes = new Set(passage.questions.map((question) => question.evidenceSentence));

  return (
    <main className="page result-page result-page--v2">
      <section className="result-hero result-hero--compact">
        <div className={`result-badge ${passed ? "is-pass" : ""}`}>
          <Icon name={passed ? "spark" : "info"} size={18} />
          {reviewOnly ? "保存されたセッション" : passed ? "理解度ゲート通過" : "復習してペースを調整"}
        </div>
        <p className="section-kicker">SESSION COMPLETE</p>
        <h1>{passed ? "いいリズムです。" : "根拠を確認しましょう。"}</h1>
        <p>{passage.title} · {session.wordCount}語節</p>
      </section>

      <section className="result-summary-card card">
        <div className="result-summary-metrics">
          <div className="is-primary"><span>実測</span><strong>{session.measuredPace.toFixed(1)}</strong><small>語節/分 · {zone.label}</small></div>
          <div><span>内容確認</span><strong>{session.correctCount}<small>/2</small></strong><small>{passed ? "記録に採用" : "参考値"}</small></div>
          <div><span>次回</span><strong>{session.recommendedPace}</strong><small>語節/分 · {session.correctCount === 2 ? "+2" : session.correctCount === 1 ? "維持" : "−2"}</small></div>
        </div>
        <button className="continue-button" type="button" onClick={reviewOnly ? onRetry : onContinue}>
          <span><small>{reviewOnly ? "TRY AGAIN" : "NEXT SESSION"}</small><strong>{reviewOnly ? `この文章を ${session.recommendedPace} でもう一度` : `次の文章を ${session.recommendedPace} で始める`}</strong></span>
          <Icon name="arrow" size={21} />
        </button>
      </section>

      <nav className="result-tabs" aria-label="結果の詳細">
        <button type="button" className={tab === "summary" ? "is-active" : ""} aria-pressed={tab === "summary"} onClick={() => setTab("summary")}><Icon name="chart" size={17} /> 結果</button>
        <button type="button" className={tab === "answers" ? "is-active" : ""} aria-pressed={tab === "answers"} onClick={() => setTab("answers")}><Icon name="check" size={17} /> 回答レビュー</button>
        <button type="button" className={tab === "translation" ? "is-active" : ""} aria-pressed={tab === "translation"} onClick={() => setTab("translation")}><Icon name="book" size={17} /> 本文と訳</button>
      </nav>

      {tab === "summary" && (
        <div className="result-tab-panel">
          <section className="result-zone card">
            <div className="section-heading section-heading--inline">
              <div><p className="section-kicker">TRAINING LOAD</p><h2>今回の到達域</h2></div>
              {baselinePace !== undefined && <div className="legend-inline"><span className="legend-triangle">▲</span> 無音実測 {baselinePace.toFixed(1)}</div>}
            </div>
            <ZoneBar pace={session.measuredPace} baseline={baselinePace} />
            <p className="result-zone__note"><Icon name="info" size={16} /> バーは訓練負荷、▲は無音・自力の実力値です。</p>
          </section>
          <section className="card timing-card timing-card--wide">
            <div className="section-heading"><p className="section-kicker">MEASUREMENT</p><h2>計測の内訳</h2></div>
            <dl>
              <div><dt>モード</dt><dd>{session.effectiveMode === "audio" ? "音声つき" : "ハイライトのみ"}</dd></div>
              <div><dt>壁時計</dt><dd>{(session.wallTimeMs / 1000).toFixed(1)} 秒</dd></div>
              {session.effectiveMode === "audio" && <>
                <div><dt>発話時間</dt><dd>{(session.speechTimeMs / 1000).toFixed(1)} 秒</dd></div>
                <div><dt>文間の空白</dt><dd>{(session.gapTimeMs / 1000).toFixed(1)} 秒 · {(gapRate * 100).toFixed(0)}%</dd></div>
                <div><dt>再生倍率</dt><dd>{session.playbackRate?.toFixed(2)}×</dd></div>
              </>}
            </dl>
            {gapRate > 0.15 && session.effectiveMode === "audio" && <p className="timing-warning"><Icon name="info" size={16} /> 空白率が15%を超えています。</p>}
            {session.fallbackReason && <p className="timing-warning"><Icon name="info" size={16} /> {session.fallbackReason}</p>}
          </section>
        </div>
      )}

      {tab === "answers" && (
        <section className="result-tab-panel answer-feedback-list">
          {incorrectCount > 0 && (
            <div className="answer-filter" aria-label="回答レビューの絞り込み">
              <span>{showOnlyIncorrect ? `${incorrectCount}問を重点復習` : "全問を表示中"}</span>
              <div>
                <button type="button" className={!showOnlyIncorrect ? "is-active" : ""} aria-pressed={!showOnlyIncorrect} onClick={() => setShowOnlyIncorrect(false)}>すべて {passage.questions.length}</button>
                <button type="button" className={showOnlyIncorrect ? "is-active" : ""} aria-pressed={showOnlyIncorrect} onClick={() => setShowOnlyIncorrect(true)}>誤答 {incorrectCount}</button>
              </div>
            </div>
          )}
          {passage.questions.map((question, index) => ({ question, index })).filter(({ question, index }) => !showOnlyIncorrect || session.answers[index] !== question.answer).map(({ question, index }) => {
            const selectedIndex = session.answers[index];
            const correct = selectedIndex === question.answer;
            const evidenceKo = sentences[question.evidenceSentence];
            const evidenceJa = translation?.sentences[question.evidenceSentence];
            return (
              <article className="feedback-card card" key={question.id}>
                <div className="feedback-card__header">
                  <span className={correct ? "is-correct" : "is-wrong"}>{correct ? "✓" : "×"}</span>
                  <div><small>QUESTION {index + 1}</small><h2 lang="ko">{question.prompt}</h2></div>
                </div>
                <div className="feedback-choices">
                  <div><span>あなたの回答</span><strong lang="ko">{selectedIndex >= 0 ? question.choices[selectedIndex] : "未回答"}</strong></div>
                  {!correct && <div className="is-answer"><span>正解</span><strong lang="ko">{question.choices[question.answer]}</strong></div>}
                </div>
                <div className="evidence-box">
                  <span><Icon name="book" size={15} /> 本文の根拠</span>
                  <p lang="ko">{evidenceKo}</p>
                  {evidenceJa && <p className="evidence-box__ja">{evidenceJa}</p>}
                </div>
                <p className="feedback-explanation"><Icon name="info" size={15} /> {question.explanation}</p>
              </article>
            );
          })}
          <button className="text-action" type="button" onClick={() => setTab("translation")}>本文全体を日本語訳と確認する <Icon name="arrow" size={16} /></button>
        </section>
      )}

      {tab === "translation" && (
        <section className="result-tab-panel translation-review card">
          <div className="translation-review__header">
            <div><p className="section-kicker">SENTENCE REVIEW</p><h2>本文を振り返る</h2><p>訓練後だけ、日本語訳を確認できます。</p></div>
            <button type="button" className="translation-toggle" aria-pressed={showJapanese} onClick={() => setShowJapanese((value) => !value)}>
              {showJapanese ? "韓国語だけ" : "日本語訳を表示"}
            </button>
          </div>
          <div className="sentence-review-list">
            {sentences.map((sentence, index) => (
              <article className={evidenceIndexes.has(index) ? "is-evidence" : ""} key={`${passage.id}-review-${index}`}>
                {evidenceIndexes.has(index) && <span className="evidence-label"><Icon name="check" size={12} /> 設問の根拠</span>}
                <p lang="ko">{sentence}</p>
                {showJapanese && translation?.sentences[index] && <p className="sentence-ja">{translation.sentences[index]}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="result-actions result-actions--v2">
        <button className="secondary-button" type="button" onClick={onRetry}>同じ文章でもう一度</button>
        <button className="quiet-button" type="button" onClick={onHome}>{reviewOnly ? "履歴へ戻る" : "ホームへ戻る"}</button>
      </section>
    </main>
  );
}
