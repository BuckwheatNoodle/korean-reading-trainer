import { clampPace, formatAnswerDuration, formatDuration, getPaceZone } from "../lib/training";
import type { Passage } from "../types";
import { Icon } from "./Icon";
import { ZoneBar } from "./ZoneBar";

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

interface BaselineResultScreenProps {
  outcome: BaselineOutcome;
  targetPace: number;
  onApplyTarget: (pace: number) => void;
  onRetry: () => void;
  onHome: () => void;
}

export function BaselineResultScreen({
  outcome,
  targetPace,
  onApplyTarget,
  onRetry,
  onHome,
}: BaselineResultScreenProps) {
  const zone = getPaceZone(outcome.pace);
  // Rate build-up starts just above the reader's comfortable speed, not far above it.
  const suggestedTarget = clampPace(outcome.pace + 3);
  const targetIsFar = Math.abs(targetPace - suggestedTarget) >= 5;

  return (
    <main className="page result-page result-page--v2" tabIndex={-1}>
      <section className="result-hero result-hero--compact">
        <div className={`result-badge ${outcome.recorded ? "is-pass" : ""}`}>
          <Icon name={outcome.recorded ? "spark" : "info"} size={18} />
          {outcome.recorded ? "実力値として記録しました" : "記録は見送りました"}
        </div>
        <p className="section-kicker">SILENT BASELINE</p>
        <h1>{outcome.recorded ? "これが今の実力です。" : "内容確認が通りませんでした。"}</h1>
        <p>{outcome.passage.title} · 無音・自力</p>
      </section>

      <section className="result-summary-card card">
        <div className="result-summary-metrics">
          <div className="is-primary">
            <span>無音実測</span>
            <strong>{outcome.pace.toFixed(1)}</strong>
            <small>語節/分 · {zone.label}</small>
          </div>
          <div>
            <span>内容確認</span>
            <strong>{outcome.correctCount}<small>/2</small></strong>
            <small>{outcome.recorded ? "2問正解で記録" : "2問正解が条件"}</small>
          </div>
          <div>
            <span>所要時間</span>
            <strong>{formatDuration(outcome.wallTimeMs)}</strong>
            <small>{Math.round(outcome.wallTimeMs / 1000)}秒</small>
          </div>
        </div>
        {!outcome.recorded && (
          <p className="timing-warning">
            <Icon name="info" size={16} />
            読む速さだけでは実力になりません。内容を保てた読みだけを記録するため、この回は基準値に反映していません。
          </p>
        )}
      </section>

      <p className="baseline-answer-time">
        <Icon name="clock" size={15} /> 回答 {formatAnswerDuration(outcome.quizTimeMs)} / 練習目安 {formatAnswerDuration(outcome.quizTargetTimeMs)}
      </p>

      <section className="result-zone card">
        <div className="section-heading section-heading--inline">
          <div><p className="section-kicker">YOUR POSITION</p><h2>いまの到達域</h2></div>
        </div>
        <ZoneBar baseline={outcome.pace} />
        <p className="result-zone__note">
          <Icon name="info" size={16} /> ▲が無音・自力の実力値です。訓練中のバー（負荷）とは別の指標です。
        </p>
      </section>

      {outcome.recorded && (
        <section className="card timing-card timing-card--wide">
          <div className="section-heading"><p className="section-kicker">NEXT STEP</p><h2>次の目標ペース</h2></div>
          <p className="result-zone__note">
            <Icon name="target" size={16} />
            <span>
              実測の少し上、{suggestedTarget}語節/分から始めるのが目安です。
              {targetIsFar
                ? `現在の目標は${targetPace}語節/分で、実測とかなり離れています。`
                : `現在の目標は${targetPace}語節/分です。`}
            </span>
          </p>
          <button className="primary-button" type="button" onClick={() => onApplyTarget(suggestedTarget)}>
            目標を {suggestedTarget} 語節/分にする <Icon name="check" size={16} />
          </button>
        </section>
      )}

      <section className="result-actions result-actions--v2">
        <button className="secondary-button" type="button" onClick={onRetry}>もう一度実測する</button>
        <button className="quiet-button" type="button" onClick={onHome}>ホームへ戻る</button>
      </section>
    </main>
  );
}
