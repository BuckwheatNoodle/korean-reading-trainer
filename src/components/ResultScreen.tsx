import { useMemo, useState } from "react";
import translationsData from "../data/translations-ja.json";
import { MAX_PACE, formatAnswerDuration, getGapRate, getPaceZone, splitSentences } from "../lib/training";
import type { Passage, PassageTranslation, TrainingSession } from "../types";
import { Icon } from "./Icon";
import { ZoneBar } from "./ZoneBar";

// Each entry keys its explanations by question id, so TypeScript infers a per-passage literal
// shape from the JSON; widen through unknown to the shared record type.
const translations = translationsData as unknown as PassageTranslation[];
type ResultTab = "summary" | "answers" | "translation";

const TAB_LABELS: Record<ResultTab, string> = {
  summary: "結果",
  answers: "回答レビュー",
  translation: "本文と訳",
};

function getEvidenceIndexes(question: Passage["questions"][number]) {
  return Array.from(new Set(question.evidenceSentences ?? [question.evidenceSentence]));
}

function getReviewHint(prompt: string) {
  if (/중심 내용|주장|결론|교훈|강조|보여 준 점|핵심 방법/.test(prompt)) {
    return "導入の課題と、その後の変化・結果を結びます。一つの細部だけでなく、文章全体を説明できる選択肢を選びましょう。";
  }
  if (/이유|원인/.test(prompt)) {
    return "結果と原因を入れ替えず、「なぜ」に直接答える部分を確認します。理由を表す 때문에・아서/어서 も手掛かりです。";
  }
  if (/어떻게|방법/.test(prompt)) {
    return "人物・組織が実際に取った行動を探し、目的や結果だけを述べた選択肢を外します。";
  }
  if (/언제|몇 시/.test(prompt)) {
    return "時を示す語を先に見つけ、似た時刻や前後の予定と取り違えないようにします。";
  }
  if (/어디|장소/.test(prompt)) {
    return "場所を表す助詞 에・에서 と、そこで行った行動を組にして確認します。";
  }
  if (/무엇|누구/.test(prompt)) {
    return "質問の主語を固定してから、根拠文の名詞と選択肢を対応させます。";
  }
  return "質問の主語・時点・因果関係を本文と一つずつ照合すると、似た選択肢を外しやすくなります。";
}

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
  const evidenceIndexes = new Set(passage.questions.flatMap(getEvidenceIndexes));

  // Show what the pace actually did, not what the answer count implies: the value is clamped to
  // 30-110, and a first 2/2 now holds the pace until a second one confirms it.
  const paceDelta = session.recommendedPace - session.targetPace;
  const paceNote = paceDelta > 0
    ? `+${paceDelta}`
    : paceDelta < 0
      ? `${paceDelta}`
      : passed
        ? session.targetPace >= MAX_PACE ? "上限に到達" : "あと1回2/2で+2"
        : "維持";

  return (
    <main className="page result-page result-page--v2" tabIndex={-1}>
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
          <div className="is-primary"><span>訓練ペース</span><strong>{session.measuredPace.toFixed(1)}</strong><small>語節/分 · {zone.label}</small></div>
          <div><span>内容確認</span><strong>{session.correctCount}<small>/2</small></strong><small>{passed ? "安定ペースに反映" : "安定ペース対象外"}</small></div>
          <div><span>次回</span><strong>{session.recommendedPace}</strong><small>語節/分 · {paceNote}</small></div>
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

      <p role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {TAB_LABELS[tab]}を表示中
      </p>

      {tab === "summary" && (
        <div className="result-tab-panel">
          <section className="result-zone card">
            <div className="section-heading section-heading--inline">
              <div><p className="section-kicker">TRAINING LOAD</p><h2>今回の到達域</h2></div>
              {baselinePace !== undefined && <div className="legend-inline"><span className="legend-triangle" aria-hidden="true">▲</span> 無音実測 {baselinePace.toFixed(1)}</div>}
            </div>
            <ZoneBar pace={session.measuredPace} baseline={baselinePace} />
            <p className="result-zone__note"><Icon name="info" size={16} /> バーは訓練負荷、▲は無音・自力の実力値です。</p>
          </section>
          <section className="card timing-card timing-card--wide">
            <div className="section-heading"><p className="section-kicker">MEASUREMENT</p><h2>計測の内訳</h2></div>
            <dl>
              <div><dt>モード</dt><dd>{session.effectiveMode === "audio" ? "音声つき" : "ハイライトのみ"}</dd></div>
              <div><dt>壁時計</dt><dd>{(session.wallTimeMs / 1000).toFixed(1)} 秒</dd></div>
              <div><dt>回答（2問）</dt><dd>{session.quizTimeMs > 0 ? `${formatAnswerDuration(session.quizTimeMs)} / 目安 ${formatAnswerDuration(session.quizTargetTimeMs)}` : "記録なし"}</dd></div>
              {session.effectiveMode === "audio" && <>
                <div><dt>発話時間</dt><dd>{(session.speechTimeMs / 1000).toFixed(1)} 秒</dd></div>
                <div><dt>文間の空白</dt><dd>{(session.gapTimeMs / 1000).toFixed(1)} 秒 · {(gapRate * 100).toFixed(0)}%</dd></div>
                <div><dt>起動待ち</dt><dd>{(session.startupDelayMs / 1000).toFixed(1)} 秒</dd></div>
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
            const questionEvidenceIndexes = getEvidenceIndexes(question);
            const explanationJa = translation?.explanations?.[question.id];
            const questionTargetTime = session.quizTargetTimeMs / passage.questions.length;
            const questionTime = session.questionTimeMs[index] ?? 0;
            return (
              <article className="feedback-card card" key={question.id}>
                <div className="feedback-card__header">
                  <span className={correct ? "is-correct" : "is-wrong"}>
                    <span aria-hidden="true">{correct ? "✓" : "×"}</span>
                    <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
                      {correct ? "正解" : "不正解"}
                    </span>
                  </span>
                  <div>
                    <small>QUESTION {index + 1}</small>
                    <h2 lang="ko">{question.prompt}</h2>
                    {session.questionTimeMs[index] > 0 && (
                      <p className="feedback-card__time">
                        回答 {formatAnswerDuration(questionTime)} / 目安 {formatAnswerDuration(questionTargetTime)} · {questionTime <= questionTargetTime ? "目安内" : `${formatAnswerDuration(questionTime - questionTargetTime)}超過`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="feedback-choices">
                  <div>
                    <span>あなたの回答</span>
                    <strong lang={selectedIndex >= 0 ? "ko" : undefined}>
                      {selectedIndex >= 0 ? question.choices[selectedIndex] : "未回答"}
                    </strong>
                  </div>
                  {!correct && <div className="is-answer"><span>正解</span><strong lang="ko">{question.choices[question.answer]}</strong></div>}
                </div>
                <div className="evidence-box">
                  <span><Icon name="book" size={15} /> 本文の根拠</span>
                  {questionEvidenceIndexes.map((evidenceIndex) => (
                    <div className="evidence-box__sentence" key={`${question.id}-evidence-${evidenceIndex}`}>
                      <p lang="ko">{sentences[evidenceIndex]}</p>
                      {translation?.sentences[evidenceIndex] && <p className="evidence-box__ja">{translation.sentences[evidenceIndex]}</p>}
                    </div>
                  ))}
                </div>
                <details className="feedback-details">
                  <summary><Icon name="info" size={15} /> なぜこの答えか・見分け方</summary>
                  <div className="feedback-details__body">
                    <p className="feedback-explanation"><span lang="ko">{question.explanation}</span></p>
                    {explanationJa && <p className="feedback-explanation">{explanationJa}</p>}
                    {!correct && selectedIndex >= 0 && (
                      <p className="feedback-selected-note">選んだ「<span lang="ko">{question.choices[selectedIndex]}</span>」は、根拠文の内容と一致しません。</p>
                    )}
                    <div className="feedback-choice-check" aria-label="選択肢の確認">
                      {question.choices.map((choice, choiceIndex) => (
                        <p className={choiceIndex === question.answer ? "is-correct" : choiceIndex === selectedIndex ? "is-selected-wrong" : ""} key={`${question.id}-choice-${choiceIndex}`}>
                          <span>{choiceIndex === question.answer ? "正解" : choiceIndex === selectedIndex ? "選択" : "不一致"}</span>
                          <span lang="ko">{choice}</span>
                        </p>
                      ))}
                    </div>
                    <p className="feedback-review-hint"><strong>見分け方</strong>{getReviewHint(question.prompt)}</p>
                  </div>
                </details>
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
