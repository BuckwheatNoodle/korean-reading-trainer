import type { Screen } from "../types";
import { Icon } from "./Icon";

interface HeaderProps {
  screen: Screen;
  sessionCount: number;
  onNavigate: (screen: Screen) => void;
  immersive?: boolean;
}

export function Header({ screen, sessionCount, onNavigate, immersive = false }: HeaderProps) {
  const isTraining = ["home", "reading", "quiz", "result"].includes(screen);
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <button className="brand" type="button" onClick={() => !immersive && onNavigate("home")} aria-label={immersive ? "読解中" : "ホームへ"} disabled={immersive}>
          <span className="brand__mark"><Icon name="book" size={20} /></span>
          <span className="brand__name">읽기 <strong>Pace</strong></span>
          <span className="brand__tag">TOPIK II</span>
        </button>
        {!immersive && <nav className="main-nav" aria-label="メインナビゲーション">
          <button
            type="button"
            aria-label="トレーニング"
            className={isTraining ? "is-active" : ""}
            onClick={() => onNavigate("home")}
          >
            <Icon name="play" size={17} />
            <span>トレーニング</span>
          </button>
          <button
            type="button"
            aria-label="記録"
            className={screen === "history" ? "is-active" : ""}
            onClick={() => onNavigate("history")}
          >
            <Icon name="history" size={17} />
            <span>記録</span>
            {sessionCount > 0 && <em>{sessionCount}</em>}
          </button>
          <button
            type="button"
            aria-label="使い方"
            className={screen === "guide" ? "is-active" : ""}
            onClick={() => onNavigate("guide")}
          >
            <Icon name="info" size={17} />
            <span>使い方</span>
          </button>
        </nav>}
        {immersive && <div className="focus-mode-label"><span /> 集中モード</div>}
      </div>
    </header>
  );
}
