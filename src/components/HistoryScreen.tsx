import { useMemo, useRef, useState } from "react";
import passagesData from "../data/passages.json";
import { useDialogFocus } from "../hooks/useDialogFocus";
import {
  formatDate,
  formatDuration,
  getPaceZone,
  getReviewCandidates,
  getTopicProgress,
  MAX_IMPORT_BYTES,
  makeExportBundle,
  parseImportBundle,
} from "../lib/training";
import type { BaselineMeasurement, HistoryView, Passage, TrainerSettings, TrainingSession } from "../types";
import { Icon } from "./Icon";
import { ZoneBar } from "./ZoneBar";

const passages = passagesData as Passage[];

function formatMeasurementDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

interface HistoryScreenProps {
  sessions: TrainingSession[];
  settings: TrainerSettings;
  view: HistoryView;
  baselineMeasurements: BaselineMeasurement[];
  onImport: (
    sessions: TrainingSession[],
    settings?: TrainerSettings,
    baselineMeasurements?: BaselineMeasurement[],
  ) => void;
  onReview: (session: TrainingSession, mistakesOnly?: boolean) => void;
  onViewChange: (view: HistoryView) => void;
  onStart: () => void;
  onReset: () => void;
}

export function HistoryScreen({
  sessions,
  settings,
  view,
  baselineMeasurements,
  onImport,
  onReview,
  onViewChange,
  onStart,
  onReset,
}: HistoryScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    bundle: ReturnType<typeof parseImportBundle>;
  } | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const dialogOpen = pendingImport !== null || resetDialogOpen;
  const dialogRef = useDialogFocus(dialogOpen, () => {
    setPendingImport(null);
    setResetDialogOpen(false);
  });
  const latest = sessions[sessions.length - 1];
  const validSessions = sessions.filter((session) => session.correctCount >= 2);
  const recentValid = validSessions.slice(-5);
  const stablePace = recentValid.length
    ? recentValid.reduce((sum, session) => sum + session.measuredPace, 0) / recentValid.length
    : null;
  const averageComprehension = sessions.length
    ? sessions.reduce((sum, session) => sum + session.correctCount, 0) / (sessions.length * 2)
    : 0;
  const recentSessions = sessions.slice(-8);
  const reversedSessions = [...sessions].reverse();
  const reviewQueue = getReviewCandidates(sessions);
  const nextReview = reviewQueue[0]?.session;
  const topicProgress = getTopicProgress(sessions, passages).slice(0, 5);
  const weekStart = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  }, []);
  const weeklySessions = sessions.filter((session) => new Date(session.completedAt) >= weekStart).length;
  const weeklyProgress = Math.min(100, (weeklySessions / Math.max(1, settings.weeklyGoal)) * 100);
  const positionNote = latest
    ? baselineMeasurements.length
      ? "丸は直近の訓練負荷、▲は無音で測った実力値です。"
      : "丸は直近の訓練負荷です。無音実測を記録すると、実力値も▲で比較できます。"
    : baselineMeasurements.length
      ? "▲は無音で測った実力値です。練習すると、直近の訓練負荷も丸で比較できます。"
      : "練習結果と無音実測を記録すると、ここに現在地が表示されます。";

  function exportJson() {
    const json = JSON.stringify(makeExportBundle(sessions, settings, baselineMeasurements), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `topik-reading-log-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`学習${sessions.length}件・基準値${baselineMeasurements.length}件を書き出しました。`);
  }

  async function importJson(file: File) {
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        throw new Error("JSONが大きすぎます（上限2MB）。");
      }
      const bundle = parseImportBundle(await file.text());
      setPendingImport({ fileName: file.name, bundle });
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? `読み込みエラー: ${error.message}` : "JSONを読み込めませんでした。");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function confirmImport() {
    if (!pendingImport) return;
    const { bundle } = pendingImport;
    onImport(bundle.sessions, bundle.settings, bundle.baselineMeasurements);
    setMessage(`${bundle.sessions.length}件を読み込みました${bundle.migrated ? "（旧形式を自動移行）" : ""}。`);
    setPendingImport(null);
  }

  return (
    <main className="page history-page">
      <section className="page-title-row">
        <div>
          <p className="section-kicker">YOUR PROGRESS</p>
          <h1>学習の記録</h1>
          <p>結果は自動保存されています。ここでは伸び方と次の練習を確認できます。</p>
        </div>
        <div className="file-actions">
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importJson(file);
            }}
          />
          <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" size={17} /> 読み込む
          </button>
          <button className="secondary-button" type="button" onClick={exportJson}>
            <Icon name="download" size={17} /> バックアップ
          </button>
        </div>
      </section>

      {message && <div className="import-message" role="status" aria-live="polite"><Icon name="info" size={16} /> {message}</div>}

      <section className="history-stats">
        <div className="stat-card card"><span>今週</span><strong>{weeklySessions}</strong><small>/ {settings.weeklyGoal}回</small></div>
        <div className="stat-card card"><span>理解度</span><strong>{Math.round(averageComprehension * 100)}</strong><small>%</small></div>
        <div className="stat-card card"><span>安定ペース <em>直近の2/2</em></span><strong>{stablePace?.toFixed(1) ?? "—"}</strong><small>語節/分</small></div>
        <div className="stat-card card"><span>次の目標</span><strong>{latest?.recommendedPace ?? settings.targetPace}</strong><small>語節/分</small></div>
      </section>

      <nav className="history-tabs" aria-label="記録の表示切り替え">
        <button type="button" className={view === "overview" ? "is-active" : ""} aria-pressed={view === "overview"} onClick={() => onViewChange("overview")}><Icon name="chart" size={16} /> 概要</button>
        <button type="button" className={view === "sessions" ? "is-active" : ""} aria-pressed={view === "sessions"} onClick={() => onViewChange("sessions")}><Icon name="history" size={16} /> 練習 {sessions.length}</button>
        <button type="button" className={view === "baselines" ? "is-active" : ""} aria-pressed={view === "baselines"} onClick={() => onViewChange("baselines")}><Icon name="target" size={16} /> 無音実測 {baselineMeasurements.length}</button>
      </nav>

      {view === "overview" && (
        <div className="history-overview">
          <section className="card weekly-card">
            <div className="section-heading section-heading--inline">
              <div><p className="section-kicker">THIS WEEK</p><h2>{weeklySessions >= settings.weeklyGoal ? "今週の目標を達成しました" : `あと${settings.weeklyGoal - weeklySessions}回で今週の目標`}</h2></div>
              <strong>{weeklySessions} / {settings.weeklyGoal}</strong>
            </div>
            <div className="weekly-progress" aria-label={`週間目標 ${Math.round(weeklyProgress)}%`}><span style={{ width: `${weeklyProgress}%` }} /></div>
            <button className="primary-button" type="button" onClick={onStart}>{sessions.length ? "今日の練習へ" : "最初の練習を始める"}<Icon name="arrow" size={17} /></button>
          </section>

          <section className="card history-position">
            <div className="section-heading section-heading--inline">
              <div><p className="section-kicker">CURRENT POSITION</p><h2>現在地</h2></div>
              {baselineMeasurements.length > 0 && <div className="legend-inline"><span className="legend-triangle">▲</span> 無音実測 {settings.baselinePace.toFixed(1)}</div>}
            </div>
            <ZoneBar pace={latest?.measuredPace} baseline={baselineMeasurements.length ? settings.baselinePace : undefined} />
            <p className="history-position__note">{positionNote}</p>
          </section>

          {nextReview && (
            <section className="card review-queue-card">
              <span className="review-queue-card__icon"><Icon name="history" size={21} /></span>
              <div>
                <p className="section-kicker">REVIEW READY</p>
                <h2>復習待ち {reviewQueue.length}文章</h2>
                <p>{nextReview.passageTitle} · {nextReview.correctCount}/2 · {formatDate(nextReview.completedAt)}</p>
              </div>
              <button className="primary-button" type="button" onClick={() => onReview(nextReview, true)}>誤答を復習 <Icon name="arrow" size={17} /></button>
            </section>
          )}

          <section className="card pace-trend-card">
            <div className="section-heading section-heading--inline">
              <div><p className="section-kicker">RECENT 8</p><h2>ペースの推移</h2></div>
              <span className="history-count">理解度つきで確認</span>
            </div>
            {!recentSessions.length ? (
              <div className="compact-empty"><Icon name="chart" size={22} /><p>練習すると、ここに直近8回の推移が表示されます。</p></div>
            ) : (
              <div className="pace-trend" aria-label="直近8回の実測ペース">
                {recentSessions.map((session) => (
                  <div className="pace-trend__item" key={session.id}>
                    <strong>{session.measuredPace.toFixed(0)}</strong>
                    <div><span className={session.correctCount === 2 ? "is-pass" : ""} style={{ height: `${Math.max(12, Math.min(100, ((session.measuredPace - 30) / 80) * 100))}%` }} /></div>
                    <small>{session.correctCount}/2</small>
                  </div>
                ))}
              </div>
            )}
          </section>

          {topicProgress.length > 0 && (
            <section className="card weakness-card">
              <div className="section-heading section-heading--inline">
                <div><p className="section-kicker">COMPREHENSION BY TOPIC</p><h2>話題別の理解度</h2></div>
                <span className="history-count">低い順に表示</span>
              </div>
              <div className="weakness-list">
                {topicProgress.map((item) => {
                  const percent = Math.round(item.accuracy * 100);
                  return (
                    <article key={item.topic}>
                      <div className="weakness-list__label"><strong lang="ko">{item.topic}</strong><span>{item.passageTitles.join("・")} · {item.sessionCount}回</span></div>
                      <div className="weakness-list__bar" aria-label={`${item.topic} 理解度 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>
                      <strong className={percent < 100 ? "needs-work" : ""}>{percent}<small>%</small></strong>
                    </article>
                  );
                })}
              </div>
              <p className="weakness-card__note"><Icon name="info" size={14} /> 同じ話題の教材を追加すると、話題単位の傾向がより正確になります。</p>
            </section>
          )}
        </div>
      )}

      {view === "sessions" && (
        <section className="history-list card">
          <div className="section-heading section-heading--inline">
            <div><p className="section-kicker">SESSIONS</p><h2>練習履歴</h2></div>
            <span className="history-count">{sessions.length}件</span>
          </div>
          {!sessions.length ? (
            <div className="empty-state">
              <span><Icon name="chart" size={28} /></span>
              <h3>まだ記録がありません</h3>
              <p>最初の3分を始めると、速度と理解度がここに残ります。</p>
              <button className="primary-button" type="button" onClick={onStart}>トレーニングを選ぶ <Icon name="arrow" size={17} /></button>
            </div>
          ) : (
            <>
              <div className="session-table-wrap">
                <table className="session-table">
                <thead><tr><th>日時 / 文章</th><th>モード</th><th>目標</th><th>実測</th><th>理解</th><th>到達域</th><th>時間</th><th><span className="visually-hidden">操作</span></th></tr></thead>
                <tbody>
                  {reversedSessions.map((session) => {
                    const zone = getPaceZone(session.measuredPace);
                    return (
                      <tr key={session.id}>
                        <td><span>{formatDate(session.completedAt)}</span><strong>{session.passageTitle}</strong></td>
                        <td><span className="mode-chip"><Icon name={session.effectiveMode === "audio" ? "headphones" : "eye"} size={14} />{session.effectiveMode === "audio" ? "音声" : "HL"}</span></td>
                        <td>{session.targetPace}</td>
                        <td><strong>{session.measuredPace.toFixed(1)}</strong></td>
                        <td><span className={session.correctCount === 2 ? "score-pass" : "score-low"}>{session.correctCount}/2</span></td>
                        <td><span className="zone-chip"><i style={{ background: zone.color }} />{zone.label}</span></td>
                        <td>{formatDuration(session.wallTimeMs)}</td>
                        <td><button className="history-review-button" type="button" onClick={() => onReview(session)}>レビュー</button></td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
              <div className="session-card-list">
                {reversedSessions.map((session) => {
                  const zone = getPaceZone(session.measuredPace);
                  return (
                    <article className="session-card" key={`${session.id}-card`}>
                      <div className="session-card__top"><span>{formatDate(session.completedAt)}</span><span className="zone-chip"><i style={{ background: zone.color }} />{zone.shortLabel}</span></div>
                      <h3>{session.passageTitle}</h3>
                      <div className="session-card__metrics">
                        <span>実測 <strong>{session.measuredPace.toFixed(1)}</strong></span>
                        <span>目標 <strong>{session.targetPace}</strong></span>
                        <span>理解 <strong className={session.correctCount === 2 ? "score-pass" : "score-low"}>{session.correctCount}/2</strong></span>
                      </div>
                      <div className="session-card__actions">
                        <button className="secondary-button" type="button" onClick={() => onReview(session)}>全体をレビュー</button>
                        {session.correctCount < 2 && <button className="primary-button" type="button" onClick={() => onReview(session, true)}>誤答だけ</button>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {view === "baselines" && (
        <section className="history-list card">
          <div className="section-heading section-heading--inline">
            <div><p className="section-kicker">SILENT BASELINE</p><h2>無音実測の履歴</h2></div>
            <span className="history-count">ホームから追加できます</span>
          </div>
          {!baselineMeasurements.length ? (
            <div className="compact-empty"><Icon name="target" size={22} /><p>基準値を記録すると、訓練負荷と実力値を分けて追えます。</p></div>
          ) : (
            <div className="baseline-history-list">
              {[...baselineMeasurements].reverse().map((item, index) => (
                <article key={item.id}>
                  <span className="baseline-history-list__marker" />
                  <div><small>{formatMeasurementDate(item.measuredAt)}{index === 0 ? " · 最新" : ""}</small><strong>{item.pace.toFixed(1)} <em>語節/分</em></strong>{item.note && <p>{item.note}</p>}</div>
                  <span className="zone-chip"><i style={{ background: getPaceZone(item.pace).color }} />{getPaceZone(item.pace).label}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="storage-note">
        <Icon name="check" size={17} />
        <p><strong>この端末に自動保存中。</strong>外部サーバーには送信されません。端末を替えるときや大切な節目ではJSONも保存してください。</p>
        <button className="danger-text-button" type="button" onClick={() => setResetDialogOpen(true)}>端末内の記録を削除</button>
      </div>

      {pendingImport && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPendingImport(null);
        }}>
          <section ref={dialogRef} className="app-modal" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" tabIndex={-1}>
            <div className="app-modal__header">
              <div><p className="section-kicker">IMPORT CHECK</p><h2 id="import-dialog-title">このバックアップを読み込みますか</h2></div>
              <button type="button" className="icon-button" aria-label="閉じる" onClick={() => setPendingImport(null)}><Icon name="close" size={18} /></button>
            </div>
            <p className="app-modal__lead">内容を現在の記録へ結合します。同じIDの記録と、含まれている設定は読み込み側の内容で更新されます。</p>
            <dl className="import-summary">
              <div><dt>ファイル</dt><dd>{pendingImport.fileName}</dd></div>
              <div><dt>練習履歴</dt><dd>{pendingImport.bundle.sessions.length}件</dd></div>
              <div><dt>無音実測</dt><dd>{pendingImport.bundle.baselineMeasurements.length}件</dd></div>
              <div><dt>設定</dt><dd>{pendingImport.bundle.settings ? "含む" : "変更なし"}</dd></div>
            </dl>
            <div className="app-modal__actions">
              <button className="secondary-button" type="button" onClick={() => setPendingImport(null)}>キャンセル</button>
              <button className="primary-button" type="button" onClick={confirmImport}>結合して読み込む <Icon name="check" size={16} /></button>
            </div>
          </section>
        </div>
      )}

      {resetDialogOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResetDialogOpen(false);
        }}>
          <section ref={dialogRef} className="app-modal" role="alertdialog" aria-modal="true" aria-labelledby="reset-dialog-title" aria-describedby="reset-dialog-description" tabIndex={-1}>
            <div className="app-modal__header">
              <div><p className="section-kicker">DELETE LOCAL DATA</p><h2 id="reset-dialog-title">端末内の記録を削除しますか</h2></div>
              <button type="button" className="icon-button" aria-label="閉じる" onClick={() => setResetDialogOpen(false)}><Icon name="close" size={18} /></button>
            </div>
            <p className="app-modal__lead" id="reset-dialog-description">練習履歴{sessions.length}件、無音実測{baselineMeasurements.length}件と設定を初期化します。バックアップがなければ元に戻せません。</p>
            <div className="app-modal__actions">
              <button className="secondary-button" type="button" onClick={() => setResetDialogOpen(false)}>キャンセル</button>
              <button className="danger-button" type="button" onClick={() => {
                onReset();
                setResetDialogOpen(false);
                setMessage("端末内の履歴と実測メモを削除し、設定を初期化しました。");
              }}>削除して初期化</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
