import { useState } from "react";
import type { Passage } from "../types";
import { Icon } from "./Icon";

interface QuizScreenProps {
  passage: Passage;
  onSubmit: (answers: number[]) => void;
}

const choiceLabels = ["①", "②", "③", "④"];

export function QuizScreen({ passage, onSubmit }: QuizScreenProps) {
  const [answers, setAnswers] = useState<number[]>(passage.questions.map(() => -1));
  const allAnswered = answers.every((answer) => answer >= 0);

  return (
    <main className="page quiz-page">
      <section className="quiz-header">
        <div className="quiz-header__step"><Icon name="check" size={17} /> 読解完了</div>
        <p className="section-kicker">COMPREHENSION CHECK</p>
        <h1>内容を確認しましょう</h1>
        <p>本文は見ずに答えてください。ここは時間を計測しません。</p>
      </section>

      <section className="quiz-form">
        {passage.questions.map((question, questionIndex) => (
          <fieldset className="question-card card" key={question.id}>
            <legend><span>Q{questionIndex + 1}</span><strong lang="ko">{question.prompt}</strong></legend>
            <div className="choice-list">
              {question.choices.map((choice, choiceIndex) => (
                <label className={`choice ${answers[questionIndex] === choiceIndex ? "is-selected" : ""}`} key={choice}>
                  <input
                    type="radio"
                    name={question.id}
                    value={choiceIndex}
                    checked={answers[questionIndex] === choiceIndex}
                    onChange={() => {
                      const next = [...answers];
                      next[questionIndex] = choiceIndex;
                      setAnswers(next);
                    }}
                  />
                  <span className="choice__number">{choiceLabels[choiceIndex]}</span>
                  <span lang="ko">{choice}</span>
                  <span className="radio-dot" />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className="primary-button primary-button--large quiz-submit"
          disabled={!allAnswered}
          onClick={() => onSubmit(answers)}
        >
          答えを確定する <Icon name="arrow" size={20} />
        </button>
        {!allAnswered && <p className="quiz-reminder">2問とも選択すると結果へ進めます</p>}
      </section>
    </main>
  );
}
