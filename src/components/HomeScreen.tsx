import { useMemo, useState } from "react";
import passagesData from "../data/passages.json";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { countEojeol, getNextZoneBoundary, getPaceZone, getQuestionTimeTargetSeconds, getReviewCandidates } from "../lib/training";
import type { BaselineMeasurement, Passage, TrainerSettings, TrainingMode, TrainingSession } from "../types";
import { Icon } from "./Icon";
import { ZoneBar } from "./ZoneBar";

const passages = passagesData as Passage[];
const foundationPassages = passages.filter((passage) => passage.level === "1–2級");
const challengePassages = passages.filter((passage) => passage.level !== "1–2級");

function localDateInput(date: Date = new Date()): string {
  const offsetCorrected = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetCorrected.toISOString().slice(0, 10);
}

interface HomeScreenProps {
  selectedPassageId: string;
  mode: TrainingMode;
  settings: TrainerSettings;
  sessions: TrainingSession[];
  koreanVoiceAvailable: boolean | null;
  calibratedTtsPace: number;
  baselineMeasurements: BaselineMeasurement[];
  storageError: string | null;
  onSelectPassage: (id: string) => void;
  onModeChange: (mode: TrainingMode) => void;
  onSettingsChange: (settings: TrainerSettings) => void;
  onAddBaseline: (pace: number, measuredAt: string, note?: string) => void;
  onStartReview: (session: TrainingSession) => void;
  onStartMeasurement: (passageId: string) => void;
  onStart: () => void;
}

export function HomeScreen({
  selectedPassageId,
  mode,
  settings,
  sessions,
  koreanVoiceAvailable,
  calibratedTtsPace,
  baselineMeasurements,
  storageError,
  onSelectPassage,
  onModeChange,
  onSettingsChange,
  onAddBaseline,
  onStartReview,
  onStartMeasurement,
  onStart,
}: HomeScreenProps) {
  const latestBaseline = baselineMeasurements[baselineMeasurements.length - 1];
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);
  // Never pre-fill a number the user has not actually measured: it used to be saved as if it were real.
  const [baselineInput, setBaselineInput] = useState(latestBaseline ? String(settings.baselinePace) : "");
  const [baselineDate, setBaselineDate] = useState(localDateInput());
  const [baselineNote, setBaselineNote] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const baselineDialogRef = useDialogFocus(baselineDialogOpen, () => setBaselineDialogOpen(false));
  const passage = passages.find((item) => item.id === selectedPassageId) ?? passages[0];
  const wordCount = countEojeol(passage.text);
  const estimatedSeconds = Math.round((wordCount / settings.targetPace) * 60);
  const questionTargetSeconds = getQuestionTimeTargetSeconds(settings.targetPace);
  const estimatedTotalMinutes = Math.max(1, Math.round((estimatedSeconds + questionTargetSeconds * passage.questions.length) / 60));
  const zone = getPaceZone(settings.targetPace);
  const passageRuns = sessions.filter((session) => session.passageId === passage.id).length;
  const completedIds = new Set(sessions.map((session) => session.passageId));
  const nextBoundary = latestBaseline ? getNextZoneBoundary(settings.baselinePace) : null;
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weeklySessions = sessions.filter((session) => new Date(session.completedAt) >= weekStart).length;
  const reviewCandidate = useMemo(() => getReviewCandidates(sessions)[0], [sessions]);
  // Mistakes made today are held back until tomorrow; say so, or the queue just looks empty.
  const heldUntilTomorrow = useMemo(
    () => getReviewCandidates(sessions, new Date(), { minDays: 0 }).length - getReviewCandidates(sessions).length,
    [sessions],
  );
  const reviewPassage = reviewCandidate
    ? passages.find((item) => item.id === reviewCandidate.passageId)
    : undefined;
  // A review candidate whose passage is gone (an old backup, a renamed id) must not drive the UI.
  const activeReview = reviewCandidate && reviewPassage ? { candidate: reviewCandidate, passage: reviewPassage } : null;
  const recommendedPassage = useMemo(
    () => reviewPassage ?? passages.find((item) => !completedIds.has(item.id)) ?? passages[(sessions.length + 1) % passages.length],
    [reviewPassage, sessions],
  );
  // Measure on whatever the reader has seen least recently — the closest thing to a fresh text.
  const measurePassage = useMemo(() => {
    const lastRunAt = new Map<string, number>();
    for (const session of sessions) {
      const at = new Date(session.completedAt).getTime();
      if (!lastRunAt.has(session.passageId) || at > (lastRunAt.get(session.passageId) ?? 0)) {
        lastRunAt.set(session.passageId, at);
      }
    }
    const untouched = passages.filter((item) => !lastRunAt.has(item.id));
    if (untouched.length) return untouched[0];
    return [...passages].sort((a, b) => (lastRunAt.get(a.id) ?? 0) - (lastRunAt.get(b.id) ?? 0))[0];
  }, [sessions]);
  const quickPassage = activeReview?.passage ?? passage;
  const quickWordCount = countEojeol(quickPassage.text);
  const quickPace = activeReview?.candidate.session.recommendedPace ?? settings.targetPace;
  const quickMode = activeReview?.candidate.session.requestedMode ?? mode;
  const quickModeLabel = quickMode === "audio"
    ? koreanVoiceAvailable === false ? "音声つき（音声なしのためハイライト）" : "音声つき"
    : "ハイライト";

  function openBaselineDialog() {
    setBaselineInput(latestBaseline ? String(settings.baselinePace) : "");
    setBaselineDate(localDateInput());
    setDateError(null);
    setBaselineDialogOpen(true);
  }

  function setWeeklyGoal(next: number) {
    onSettingsChange({ ...settings, weeklyGoal: Math.min(14, Math.max(1, next)) });
  }

  return (
    <main className="page page--home" tabIndex={-1}>
      <section className="mobile-quick-start card">
        <div className="mobile-quick-start__top">
          <div><p className="section-kicker">{activeReview ? "REVIEW" : "TODAY"}</p><span>{activeReview ? "今日の復習" : "今日のおすすめ"}</span></div>
          <span className={`auto-save-chip ${activeReview ? "is-review" : ""}`}><Icon name={activeReview ? "history" : "check"} size={13} /> {activeReview ? `誤答 ${activeReview.candidate.incorrectCount}` : "自動保存"}</span>
        </div>
        <h1>{quickPassage.title}</h1>
        <p lang="ko">{quickPassage.titleKo}</p>
        <div className="mobile-quick-start__facts">
          <span>{quickModeLabel}</span>
          <strong>{quickPace}<small> 語節/分</small></strong>
          <span>{quickWordCount}語節</span>
        </div>
        <button className="primary-button primary-button--large" type="button" onClick={() => activeReview ? onStartReview(activeReview.candidate.session) : onStart()}>
          {activeReview ? "この文章で復習する" : "この設定で始める"} <Icon name="arrow" size={19} />
        </button>
        <button className="mobile-settings-link" type="button" onClick={() => document.getElementById("training-builder")?.scrollIntoView({ behavior: "smooth" })}>
          文章・モード・速度を変更
        </button>
      </section>

      {activeReview && (
        <section className="home-review-banner card">
          <span className="home-review-banner__icon"><Icon name="history" size={20} /></span>
          <div><p className="section-kicker">TODAY'S REVIEW</p><h2>今日の復習: {activeReview.passage.title}</h2><p>{activeReview.candidate.session.correctCount}/2だった文章を、{activeReview.candidate.session.recommendedPace}語節/分で確認します。</p></div>
          <button className="primary-button" type="button" onClick={() => onStartReview(activeReview.candidate.session)}>復習を始める <Icon name="arrow" size={17} /></button>
        </section>
      )}

      {!activeReview && heldUntilTomorrow > 0 && (
        <section className="home-review-banner card">
          <span className="home-review-banner__icon"><Icon name="history" size={20} /></span>
          <div>
            <p className="section-kicker">REVIEW TOMORROW</p>
            <h2>今日の誤答{heldUntilTomorrow}件は、明日から復習できます</h2>
            <p>答えを見た直後に同じ2問を解くと、理解ではなく直前の記憶を測ってしまうため、日をまたいでから出します。</p>
          </div>
        </section>
      )}

      <section className="home-intro">
        <div>
          <p className="eyebrow"><span /> 3分で、読むリズムを整える</p>
          <h1>一語ずつではなく、<br /><em>文の流れ</em>で読む。</h1>
          <p className="home-intro__lead">
            やさしい韓国語を一定のペースで追い、理解を保てる速度を少しずつ引き上げます。
          </p>
        </div>
        <div className="baseline-card">
          <div className="baseline-card__top">
            <span>無音・自力の基準値</span>
            <span style={{ display: "flex", gap: 10 }}>
              <button className="text-button" type="button" onClick={() => onStartMeasurement(measurePassage.id)}>実測する</button>
              <button className="text-button" type="button" onClick={openBaselineDialog}>手入力</button>
            </span>
          </div>
          <div className="baseline-card__value"><strong>{latestBaseline ? settings.baselinePace.toFixed(1) : "—"}</strong><span>語節 / 分</span></div>
          <div className="baseline-card__goal">
            <span>{latestBaseline ? `${new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(latestBaseline.measuredAt))} 測定` : "未測定"}</span>
            <b>
              {!latestBaseline && "まず基準値を実測"}
              {latestBaseline && nextBoundary && `${nextBoundary.zone.label}まであと ${(nextBoundary.boundary - settings.baselinePace).toFixed(1)}`}
              {latestBaseline && !nextBoundary && "最上位の到達域です"}
            </b>
          </div>
        </div>
      </section>

      <section className="progress-overview card">
        <div className="section-heading section-heading--inline">
          <div>
            <p className="section-kicker">YOUR POSITION</p>
            <h2>到達域</h2>
          </div>
          <div className="legend-inline">
            {latestBaseline ? <><span className="legend-triangle" aria-hidden="true">▲</span> 無音実測ベースライン</> : "基準値を記録すると▲で表示"}
          </div>
        </div>
        <ZoneBar baseline={latestBaseline ? settings.baselinePace : undefined} />
      </section>

      <section className="training-builder" id="training-builder">
        <div className="builder-main card">
          <div className="section-heading">
            <p className="section-kicker">TODAY'S SESSION</p>
            <h2>今日のトレーニング</h2>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label htmlFor="passage">01 <span>文章を選ぶ</span></label>
              <button className="suggestion-pill" type="button" onClick={() => onSelectPassage(recommendedPassage.id)}>
                <Icon name={reviewPassage ? "history" : "spark"} size={14} /> {reviewPassage ? "復習" : "おすすめ"}: {recommendedPassage.order.toString().padStart(2, "0")}
              </button>
            </div>
            <div className="passage-select-wrap">
              <select id="passage" value={passage.id} onChange={(event) => onSelectPassage(event.target.value)}>
                <optgroup label="基礎・標準（1–2級）">
                  {foundationPassages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.order.toString().padStart(2, "0")} · {item.title} — {item.titleKo}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="中級・長文（2–4級）">
                  {challengePassages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.order.toString().padStart(2, "0")} · {item.title} — {item.titleKo}
                    </option>
                  ))}
                </optgroup>
              </select>
              <span className="select-chevron" aria-hidden="true">⌄</span>
            </div>
            <div className="passage-meta">
              <span lang="ko">{passage.topic}</span><span>{passage.level}語彙</span><span>{wordCount}語節</span><span>約{estimatedSeconds}秒</span>
              {passageRuns > 0 && <span>{passageRuns}回実施</span>}
            </div>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label id="mode-group-label">02 <span>モードを選ぶ</span></label>
            </div>
            <div className="mode-grid" role="radiogroup" aria-labelledby="mode-group-label">
              <button
                type="button"
                role="radio"
                aria-checked={mode === "audio"}
                className={`mode-card ${mode === "audio" ? "is-selected" : ""}`}
                onClick={() => onModeChange("audio")}
              >
                <span className="mode-card__icon"><Icon name="headphones" size={23} /></span>
                <span className="mode-card__copy">
                  <strong>音声つき <em>推奨</em></strong>
                  <small>韓国語TTSに合わせて文を追う</small>
                </span>
                <span className="radio-dot" />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "visual"}
                className={`mode-card ${mode === "visual" ? "is-selected" : ""}`}
                onClick={() => onModeChange("visual")}
              >
                <span className="mode-card__icon"><Icon name="eye" size={23} /></span>
                <span className="mode-card__copy">
                  <strong>ハイライトのみ</strong>
                  <small>無音で文の切り替えだけを追う</small>
                </span>
                <span className="radio-dot" />
              </button>
            </div>
            {mode === "audio" && (
              <p className={`voice-status ${koreanVoiceAvailable === false ? "is-warning" : ""}`}>
                <span />
                {koreanVoiceAvailable === null && "韓国語音声を確認中です"}
                {koreanVoiceAvailable === true && `韓国語音声を利用できます · 較正値 ${calibratedTtsPace.toFixed(0)}語節/分`}
                {koreanVoiceAvailable === false && "韓国語音声が見つかりません。開始時にハイライトのみへ切り替えます"}
              </p>
            )}
          </div>

          <div className="field-group pace-field">
            <div className="field-label-row">
              <label htmlFor="pace">03 <span>目標ペース</span></label>
              <div className="pace-readout"><strong>{settings.targetPace}</strong><span>語節 / 分</span></div>
            </div>
            <input
              id="pace"
              className="pace-slider"
              type="range"
              min="30"
              max="110"
              step="1"
              value={settings.targetPace}
              aria-valuetext={`${settings.targetPace}語節/分 ${zone.label}`}
              style={{ "--slider-progress": `${((settings.targetPace - 30) / 80) * 100}%` } as React.CSSProperties}
              onChange={(event) => onSettingsChange({ ...settings, targetPace: Number(event.target.value) })}
            />
            <div className="pace-scale"><span>ゆっくり 30</span><span>110 速い</span></div>
            <div className="pace-zone-note" style={{ borderColor: zone.color }}>
              <span style={{ backgroundColor: zone.color }} />
              <div><strong>{zone.label}</strong><small>{zone.description}</small></div>
            </div>
          </div>

          <button className="primary-button primary-button--large" type="button" onClick={onStart}>
            トレーニングを始める
            <Icon name="arrow" size={20} />
          </button>
          <p className="builder-footnote"><Icon name="clock" size={14} /> 所要時間 約{estimatedTotalMinutes}分（読解 約{estimatedSeconds}秒 + 回答 {questionTargetSeconds}秒×2問）</p>
          <p className={`save-status ${storageError ? "is-warning" : ""}`}>
            <Icon name={storageError ? "info" : "check"} size={14} />
            {storageError ?? "設定と記録はこの端末に自動保存されます"}
          </p>
        </div>

        <aside className="builder-side">
          <div className="side-card side-card--mint">
            <Icon name="target" size={22} />
            <div>
              <span>今週 {weeklySessions} / {settings.weeklyGoal}回</span>
              <strong>{settings.targetPace}で 2 / 2 を保つ</strong>
            </div>
            <span className="weekly-goal-stepper" style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
              <button
                type="button"
                className="text-button"
                aria-label="週の目標回数を減らす"
                disabled={settings.weeklyGoal <= 1}
                onClick={() => setWeeklyGoal(settings.weeklyGoal - 1)}
              >
                −
              </button>
              <button
                type="button"
                className="text-button"
                aria-label="週の目標回数を増やす"
                disabled={settings.weeklyGoal >= 14}
                onClick={() => setWeeklyGoal(settings.weeklyGoal + 1)}
              >
                ＋
              </button>
            </span>
          </div>
          <div className="side-card">
            <p className="section-kicker">3-STEP LADDER</p>
            <h3>足場を少しずつ外す</h3>
            <ol className="ladder-list">
              <li className={mode === "audio" ? "is-current" : ""}><span><Icon name="headphones" size={16} /></span><div><strong>音声つき</strong><small>聴覚の足場あり</small></div></li>
              <li className={mode === "visual" ? "is-current" : ""}><span><Icon name="eye" size={16} /></span><div><strong>ハイライトのみ</strong><small>視覚ペーシング</small></div></li>
              <li><span><Icon name="book" size={16} /></span><div><strong>無音・自力測定</strong><small>2〜3週ごとに実力を確認</small></div></li>
            </ol>
            <button className="text-action" type="button" onClick={() => onStartMeasurement(measurePassage.id)}>
              無音で実測する（{measurePassage.title}） <Icon name="arrow" size={16} />
            </button>
          </div>
          <div className="side-card side-card--note">
            <Icon name="info" size={18} />
            <p><strong>数値の読み方</strong>ここで出る速度は訓練の負荷です。実力の変化は、無音測定の▲で確認します。</p>
          </div>
        </aside>
      </section>

      {baselineDialogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setBaselineDialogOpen(false);
        }}>
          <section ref={baselineDialogRef} className="app-modal" role="dialog" aria-modal="true" aria-labelledby="baseline-dialog-title" tabIndex={-1}>
            <div className="app-modal__header">
              <div><p className="section-kicker">SILENT BASELINE</p><h2 id="baseline-dialog-title">無音実測値を手入力</h2></div>
              <button type="button" className="icon-button" aria-label="閉じる" onClick={() => setBaselineDialogOpen(false)}><Icon name="close" size={18} /></button>
            </div>
            <p className="app-modal__lead">
              アプリの外で測った値を入れます。ストップウォッチで黙読の時間を測り、語節数 ÷ 秒数 × 60 で計算してください。
              アプリ内で測るなら「実測する」の方が確実です。
            </p>
            <form onSubmit={(event) => {
              event.preventDefault();
              const value = Number(baselineInput);
              if (!Number.isFinite(value) || value <= 0) return;
              if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineDate) || Number.isNaN(new Date(`${baselineDate}T12:00:00`).getTime())) {
                setDateError("測定日を YYYY-MM-DD の形式で入力してください。");
                return;
              }
              setDateError(null);
              onAddBaseline(value, baselineDate, baselineNote.trim() || undefined);
              setBaselineDialogOpen(false);
              setBaselineNote("");
            }}>
              <label className="form-field"><span>語節 / 分</span><input type="number" min="1" max="200" step="0.1" required placeholder="例: 45.0" value={baselineInput} onChange={(event) => setBaselineInput(event.target.value)} /></label>
              <label className="form-field"><span>測定日</span><input type="date" required value={baselineDate} onChange={(event) => setBaselineDate(event.target.value)} /></label>
              {dateError && <p className="timing-warning" role="alert"><Icon name="info" size={15} /> {dateError}</p>}
              <label className="form-field"><span>メモ <small>任意</small></span><input type="text" maxLength={80} placeholder="例：朝、集中良好" value={baselineNote} onChange={(event) => setBaselineNote(event.target.value)} /></label>
              <div className="app-modal__actions">
                <button className="secondary-button" type="button" onClick={() => setBaselineDialogOpen(false)}>キャンセル</button>
                <button className="primary-button" type="submit">記録する <Icon name="check" size={16} /></button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
