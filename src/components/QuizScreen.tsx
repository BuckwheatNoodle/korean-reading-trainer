import { useEffect, useMemo, useRef, useState } from "react";
import { formatAnswerDuration, getQuestionTimeTargetSeconds, shuffleOrder } from "../lib/training";
import type { Passage, QuizTiming } from "../types";
import { Icon } from "./Icon";

interface QuizScreenProps {
  passage: Passage;
  targetPace: number;
  measuring?: boolean;
  onSubmit: (answers: number[], timing: QuizTiming) => void;
}

const choiceLabels = ["①", "②", "③", "④"];

export function QuizScreen({ passage, targetPace, measuring = false, onSubmit }: QuizScreenProps) {
  // A fresh order every attempt, so re-reading a passage cannot be passed on remembered positions.
  const [seed] = useState(() => Date.now());
  const orders = useMemo(
    () => passage.questions.map((question, index) => shuffleOrder(question.choices.length, seed + index)),
    [passage, seed],
  );
  // Answers are stored as ORIGINAL choice indices so saved sessions stay comparable across attempts.
  const [answers, setAnswers] = useState<number[]>(passage.questions.map(() => -1));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionTimes, setQuestionTimes] = useState<number[]>(passage.questions.map(() => 0));
  const [now, setNow] = useState(() => performance.now());
  const questionStartedAtRef = useRef(now);
  const advancingRef = useRef(false);
  const submittedRef = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const question = passage.questions[questionIndex];
  const selectedAnswer = answers[questionIndex];
  const targetSeconds = getQuestionTimeTargetSeconds(targetPace);
  const targetTimeMs = targetSeconds * 1000;
  const elapsedQuestionMs = Math.max(0, now - questionStartedAtRef.current);
  const elapsedTotalMs = questionTimes.reduce((sum, time) => sum + time, 0) + elapsedQuestionMs;
  const isOverTarget = elapsedQuestionMs > targetTimeMs;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    advancingRef.current = false;
  }, [questionIndex]);

  function advance() {
    if (submittedRef.current || advancingRef.current || selectedAnswer < 0) return;
    advancingRef.current = true;
    const stamp = performance.now();
    const nextQuestionTimes = [...questionTimes];
    nextQuestionTimes[questionIndex] = Math.max(0, Math.round(stamp - questionStartedAtRef.current));

    if (questionIndex < passage.questions.length - 1) {
      setQuestionTimes(nextQuestionTimes);
      questionStartedAtRef.current = stamp;
      setNow(stamp);
      setQuestionIndex((current) => current + 1);
      return;
    }

    submittedRef.current = true;
    setSubmitted(true);
    const totalTimeMs = nextQuestionTimes.reduce((sum, time) => sum + time, 0);
    onSubmit(answers, {
      totalTimeMs,
      questionTimeMs: nextQuestionTimes,
      targetTimeMs: targetTimeMs * passage.questions.length,
    });
  }

  return (
    <main className="page quiz-page" tabIndex={-1}>
      <section className="quiz-header">
        <div className="quiz-header__step"><Icon name="check" size={17} /> {measuring ? "計測完了" : "読解完了"}</div>
        <p className="section-kicker">COMPREHENSION CHECK</p>
        <h1>内容を確認しましょう</h1>
        <p>
          本文は見ずに、1問ずつ答えてください。設問が表示されてから確定するまでを計測します。
          {measuring && " 2問とも正解したときだけ、実測値を記録します。"}
        </p>
      </section>

      <section className={`quiz-timer card ${isOverTarget ? "is-over" : ""}`} aria-label="回答時間">
        <div className="quiz-timer__top">
          <span>問題 {questionIndex + 1} / {passage.questions.length}</span>
          <strong>1問 {targetSeconds}秒 <small>練習目安</small></strong>
        </div>
        <div className="quiz-timer__metrics">
          <div><span>この問題</span><strong role="timer">{formatAnswerDuration(elapsedQuestionMs)}</strong><small> / {targetSeconds}秒</small></div>
          <div><span>2問合計</span><strong>{formatAnswerDuration(elapsedTotalMs)}</strong><small> / {targetSeconds * passage.questions.length}秒</small></div>
        </div>
        <div
          className="quiz-timer__track"
          role="progressbar"
          aria-label="この問題の回答時間"
          aria-valuemin={0}
          aria-valuemax={targetSeconds}
          aria-valuenow={Math.min(targetSeconds, Math.round(elapsedQuestionMs / 1000))}
        >
          <span style={{ width: `${Math.min(100, (elapsedQuestionMs / targetTimeMs) * 100)}%` }} />
        </div>
        <p>{isOverTarget ? "目安を超えました。焦らず正確さを優先しましょう。" : targetSeconds === 26 ? "読解が速い分、判断に使える実用域の時間です。" : "全問到達を目指す時間配分です。"}</p>
      </section>

      <section className="quiz-form">
        <fieldset className="question-card card" key={question.id}>
          <legend><span>Q{questionIndex + 1}</span><strong lang="ko">{question.prompt}</strong></legend>
          <div className="choice-list">
            {orders[questionIndex].map((originalIndex, displayIndex) => (
              <label
                className={`choice ${selectedAnswer === originalIndex ? "is-selected" : ""}`}
                key={`${question.id}-${originalIndex}`}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={originalIndex}
                  checked={selectedAnswer === originalIndex}
                  onChange={() => {
                    setAnswers((current) => {
                      const next = [...current];
                      next[questionIndex] = originalIndex;
                      return next;
                    });
                  }}
                />
                <span className="choice__number">{choiceLabels[displayIndex]}</span>
                <span lang="ko">{question.choices[originalIndex]}</span>
                <span className="radio-dot" />
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className="primary-button primary-button--large quiz-submit"
          disabled={selectedAnswer < 0 || submitted}
          onClick={advance}
        >
          {questionIndex < passage.questions.length - 1 ? "この回答を確定して次へ" : "答えを確定する"} <Icon name="arrow" size={20} />
        </button>
        {selectedAnswer < 0 && <p className="quiz-reminder">1つ選ぶと次へ進めます</p>}
      </section>
    </main>
  );
}
