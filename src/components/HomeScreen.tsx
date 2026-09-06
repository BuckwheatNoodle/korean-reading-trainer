import { useMemo, useState } from "react";
import passagesData from "../data/passages.json";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { countEojeol, getPaceZone, getReviewCandidates } from "../lib/training";
import type { BaselineMeasurement, Passage, TrainerSettings, TrainingMode, TrainingSession } from "../types";
import { Icon } from "./Icon";
import { ZoneBar } from "./ZoneBar";

const passages = passagesData as Passage[];
const foundationPassages = passages.filter((passage) => passage.level === "1–2級");
const challengePassages = passages.filter((passage) => passage.level !== "1–2級");

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
  onStart,
}: HomeScreenProps) {
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);
  const [baselineInput, setBaselineInput] = useState(String(settings.baselinePace));
  const [baselineDate, setBaselineDate] = useState(new Date().toISOString().slice(0, 10));
  const [baselineNote, setBaselineNote] = useState("");
  const baselineDialogRef = useDialogFocus(baselineDialogOpen, () => setBaselineDialogOpen(false));
  const passage = passages.find((item) => item.id === selectedPassageId) ?? passages[0];
  const wordCount = countEojeol(passage.text);
  const estimatedSeconds = Math.round((wordCount / settings.targetPace) * 60);
  const zone = getPaceZone(settings.targetPace);
  const passageRuns = sessions.filter((session) => session.passageId === passage.id).length;
  const completedIds = new Set(sessions.map((session) => session.passageId));
  const latestBaseline = baselineMeasurements[baselineMeasurements.length - 1];
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weeklySessions = sessions.filter((session) => new Date(session.completedAt) >= weekStart).length;
  const reviewCandidate = useMemo(() => getReviewCandidates(sessions)[0], [sessions]);
  const reviewPassage = reviewCandidate
    ? passages.find((item) => item.id === reviewCandidate.passageId)
    : undefined;
  const recommendedPassage = useMemo(
    () => reviewPassage ?? passages.find((item) => !completedIds.has(item.id)) ?? passages[(sessions.length + 1) % passages.length],
    [reviewPassage, sessions],
  );
  const quickPassage = reviewPassage ?? passage;
  const quickWordCount = countEojeol(quickPassage.text);
  const quickPace = reviewCandidate?.session.recommendedPace ?? settings.targetPace;
  const quickMode = reviewCandidate?.session.requestedMode ?? mode;

  return (
    <main className="page page--home">
      <section className="mobile-quick-start card">
        <div className="mobile-quick-start__top">
          <div><p className="section-kicker">{reviewCandidate ? "REVIEW" : "TODAY"}</p><span>{reviewCandidate ? "今日の復習" : "今日のおすすめ"}</span></div>
          <span className={`auto-save-chip ${reviewCandidate ? "is-review" : ""}`}><Icon name={reviewCandidate ? "history" : "check"} size={13} /> {reviewCandidate ? `誤答 ${reviewCandidate.incorrectCount}` : "自動保存"}</span>
        </div>
        <h1>{quickPassage.title}</h1>
        <p lang="ko">{quickPassage.titleKo}</p>
        <div className="mobile-quick-start__facts">
          <span>{quickMode === "audio" ? "音声つき" : "ハイライト"}</span>
          <strong>{quickPace}<small> 語節/分</small></strong>
          <span>{quickWordCount}語節</span>
        </div>
        <button className="primary-button primary-button--large" type="button" onClick={() => reviewCandidate ? onStartReview(reviewCandidate.session) : onStart()}>
          {reviewCandidate ? "この文章で復習する" : "この設定で始める"} <Icon name="arrow" size={19} />
        </button>
        <button className="mobile-settings-link" type="button" onClick={() => document.getElementById("training-builder")?.scrollIntoView({ behavior: "smooth" })}>
          文章・モード・速度を変更
        </button>
      </section>

      {reviewCandidate && reviewPassage && (
        <section className="home-review-banner card">
          <span className="home-review-banner__icon"><Icon name="history" size={20} /></span>
          <div><p className="section-kicker">TODAY'S REVIEW</p><h2>今日の復習: {reviewPassage.title}</h2><p>{reviewCandidate.session.correctCount}/2だった文章を、{reviewCandidate.session.recommendedPace}語節/分で確認します。</p></div>
          <button className="primary-button" type="button" onClick={() => onStartReview(reviewCandidate.session)}>復習を始める <Icon name="arrow" size={17} /></button>
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
            <button className="text-button" type="button" onClick={() => {
              setBaselineInput(String(settings.baselinePace));
              setBaselineDialogOpen(true);
            }}>更新</button>
          </div>
          <div className="baseline-card__value"><strong>{latestBaseline ? settings.baselinePace.toFixed(1) : "—"}</strong><span>語節 / 分</span></div>
          <div className="baseline-card__goal">
            <span>{latestBaseline ? `${new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(latestBaseline.measuredAt))} 測定` : "未測定"}</span>
            <b>{latestBaseline ? `次まであと ${Math.max(0, 49 - settings.baselinePace).toFixed(1)}` : "まず基準値を記録"}</b>
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
            {latestBaseline ? <><span className="legend-triangle">▲</span> 無音実測ベースライン</> : "基準値を記録すると▲で表示"}
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
              <span className="select-chevron">⌄</span>
            </div>
            <div className="passage-meta">
              <span>{passage.topic}</span><span>{passage.level}語彙</span><span>{wordCount}語節</span><span>約{estimatedSeconds}秒</span>
              {passageRuns > 0 && <span>{passageRuns}回実施</span>}
            </div>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label>02 <span>モードを選ぶ</span></label>
            </div>
            <div className="mode-grid">
              <button
                type="button"
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
          <p className="builder-footnote"><Icon name="clock" size={14} /> 所要時間 約3分 · 本文のあとに内容確認が2問あります</p>
          <p className={`save-status ${storageError ? "is-warning" : ""}`}>
            <Icon name={storageError ? "info" : "check"} size={14} />
            {storageError ?? "設定と記録はこの端末に自動保存されます"}
          </p>
        </div>

        <aside className="builder-side">
          <div className="side-card side-card--mint">
            <Icon name="target" size={22} />
            <div><span>今週 {weeklySessions} / {settings.weeklyGoal}回</span><strong>{settings.targetPace}で 2 / 2 を保つ</strong></div>
          </div>
          <div className="side-card">
            <p className="section-kicker">3-STEP LADDER</p>
            <h3>足場を少しずつ外す</h3>
            <ol className="ladder-list">
              <li className={mode === "audio" ? "is-current" : ""}><span><Icon name="headphones" size={16} /></span><div><strong>音声つき</strong><small>聴覚の足場あり</small></div></li>
              <li className={mode === "visual" ? "is-current" : ""}><span><Icon name="eye" size={16} /></span><div><strong>ハイライトのみ</strong><small>視覚ペーシング</small></div></li>
              <li><span><Icon name="book" size={16} /></span><div><strong>無音・自力測定</strong><small>2〜3週ごとに別測定</small></div></li>
            </ol>
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
              <div><p className="section-kicker">SILENT BASELINE</p><h2 id="baseline-dialog-title">無音実測値を記録</h2></div>
              <button type="button" className="icon-button" aria-label="閉じる" onClick={() => setBaselineDialogOpen(false)}><Icon name="close" size={18} /></button>
            </div>
            <p className="app-modal__lead">別の測定台で、音声なし・自分のペースで測った値を入力します。</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              const value = Number(baselineInput);
              if (!Number.isFinite(value) || value <= 0) return;
              onAddBaseline(value, baselineDate, baselineNote.trim() || undefined);
              setBaselineDialogOpen(false);
              setBaselineNote("");
            }}>
              <label className="form-field"><span>語節 / 分</span><input type="number" min="1" max="200" step="0.1" required value={baselineInput} onChange={(event) => setBaselineInput(event.target.value)} /></label>
              <label className="form-field"><span>測定日</span><input type="date" required value={baselineDate} onChange={(event) => setBaselineDate(event.target.value)} /></label>
              <label className="form-field"><span>メモ <small>任意</small></span><input type="text" maxLength={80} placeholder="例：Track A、集中良好" value={baselineNote} onChange={(event) => setBaselineNote(event.target.value)} /></label>
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
