import { PACE_ZONES } from "../lib/training";
import { Icon } from "./Icon";

export function GuideScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="page guide-page" tabIndex={-1}>
      <section className="guide-hero">
        <p className="section-kicker">HOW IT WORKS</p>
        <h1>1回3〜5分の、<br />流暢性トレーニング。</h1>
        <p>やさしい文章を一定の速度で読み、内容確認で「理解を保てたか」だけを確かめます。</p>
        <button className="primary-button" type="button" onClick={onStart}>トレーニングを選ぶ <Icon name="arrow" size={18} /></button>
      </section>

      <section className="guide-steps">
        <article className="guide-step card"><span>01</span><Icon name="target" size={24} /><h2>ペースを決める</h2><p>最初は無音実測値の少し上から。30〜110語節/分の同じ尺度で調整します。</p></article>
        <article className="guide-step card"><span>02</span><Icon name="headphones" size={24} /><h2>文の流れを追う</h2><p>音声または文単位のハイライトに合わせ、前の文へ戻らず進みます。</p></article>
        <article className="guide-step card"><span>03</span><Icon name="check" size={24} /><h2>2問だけ確認</h2><p>1問18秒（実用域では26秒）を見ながら回答。2/2を2回続けたら次回+2、0/2なら−2です。</p></article>
      </section>

      <section className="guide-principles">
        <div className="guide-principles__copy">
          <p className="section-kicker">IMPORTANT DISTINCTION</p>
          <h2>訓練値と実力値を、<br />混ぜない。</h2>
          <p>音声やハイライトが次へ進む判断を助けるため、ここで速く読めても無音・自力の実力が同じとは限りません。実力はホームの「実測する」で測ります。音も色の助けもなく1本読み、内容確認に2問とも正解したときだけ、その速度を▲として記録します。</p>
        </div>
        <div className="value-compare">
          <div><span className="value-compare__bar" /><strong>バーが動く</strong><p>訓練の負荷が上がった</p></div>
          <div><span className="value-compare__triangle" aria-hidden="true">▲</span><strong>▲が動く</strong><p>無音・自力速度が上がった</p></div>
        </div>
      </section>

      <section className="card timing-card timing-card--wide">
        <div className="section-heading"><p className="section-kicker">READING THE ZONES</p><h2>到達域の読み方</h2></div>
        <p className="app-modal__lead">
          TOPIK II の<span lang="ko">읽기</span>は70分で50問です。速く読めるほど、時間内に到達できる問題数が増えます。
          各域に書かれた点数は「そこまで到達でき、到達した問題を全問正解できた場合」の上限です。実際の得点はこれより下になります。
        </p>
        <dl>
          {PACE_ZONES.map((zone) => (
            <div key={zone.id}>
              <dt>
                <span className="zone-chip"><i style={{ background: zone.color }} />{zone.label}</span>
              </dt>
              <dd>
                {zone.min}{Number.isFinite(zone.max) ? `–${zone.max}` : "以上"} 語節/分 · {zone.description}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="guide-routine card">
        <div><p className="section-kicker">RECOMMENDED ROUTINE</p><h2>週4回から始める</h2></div>
        <div className="routine-grid">
          <div><strong>週4</strong><span>本ツール</span><small>1回 3〜5分</small></div>
          <div><strong>2–3週</strong><span>ごと</span><small>無音で再測定</small></div>
          <div><strong>4週</strong><span>後</span><small>効果を判定</small></div>
        </div>
        <p className="weakness-card__note">
          <Icon name="info" size={14} /> 慣れてきたら週5〜7回、あるいは1回で2文章に増やすと伸びが速くなります。目標回数はホームの「今週」カードで変更できます。
        </p>
      </section>

      <section className="guide-cautions">
        <h2>始める前に</h2>
        <div><Icon name="info" size={18} /><p><strong>簡単すぎる教材が正解です。</strong>未知語を学ぶ場所ではなく、既知語を文章として速く処理するための訓練です。</p></div>
        <div><Icon name="info" size={18} /><p><strong>Chrome推奨です。</strong>韓国語音声が見つからない場合は、自動でハイライトのみへ切り替わります。</p></div>
        <div><Icon name="info" size={18} /><p><strong>履歴はこの端末に自動保存します。</strong>外部サーバーへは送信しません。端末変更やブラウザデータ削除に備え、節目で記録画面から「バックアップを保存」してください。</p></div>
        <div><Icon name="info" size={18} /><p><strong>個人情報は入力しないでください。</strong>任意メモには氏名や健康情報などを書かず、学習状態だけを短く残してください。</p></div>
        <div><Icon name="info" size={18} /><p><strong>非公式の自主学習用ツールです。</strong>TOPIKおよび運営機関とは関係がなく、収録教材は公式問題の転載ではありません。</p></div>
      </section>
    </main>
  );
}
