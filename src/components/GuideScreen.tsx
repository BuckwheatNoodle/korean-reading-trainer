import { Icon } from "./Icon";

export function GuideScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="page guide-page">
      <section className="guide-hero">
        <p className="section-kicker">HOW IT WORKS</p>
        <h1>3分で終わる、<br />流暢性トレーニング。</h1>
        <p>やさしい文章を一定の速度で読み、内容確認で「理解を保てたか」だけを確かめます。</p>
        <button className="primary-button" type="button" onClick={onStart}>トレーニングを選ぶ <Icon name="arrow" size={18} /></button>
      </section>

      <section className="guide-steps">
        <article className="guide-step card"><span>01</span><Icon name="target" size={24} /><h2>ペースを決める</h2><p>最初は無音実測値の少し上から。30〜110語節/分の同じ尺度で調整します。</p></article>
        <article className="guide-step card"><span>02</span><Icon name="headphones" size={24} /><h2>文の流れを追う</h2><p>音声または文単位のハイライトに合わせ、前の文へ戻らず進みます。</p></article>
        <article className="guide-step card"><span>03</span><Icon name="check" size={24} /><h2>2問だけ確認</h2><p>2/2なら次回+2、1/2なら維持、0/2なら−2。理解度が負荷を自動調整します。</p></article>
      </section>

      <section className="guide-principles">
        <div className="guide-principles__copy">
          <p className="section-kicker">IMPORTANT DISTINCTION</p>
          <h2>訓練値と実力値を、<br />混ぜない。</h2>
          <p>音声やハイライトが次へ進む判断を助けるため、ここで速く読めても無音・自力の実力が同じとは限りません。</p>
        </div>
        <div className="value-compare">
          <div><span className="value-compare__bar" /><strong>バーが動く</strong><p>訓練の負荷が上がった</p></div>
          <div><span className="value-compare__triangle">▲</span><strong>破線▲が動く</strong><p>無音・自力速度が上がった</p></div>
        </div>
      </section>

      <section className="guide-routine card">
        <div><p className="section-kicker">RECOMMENDED ROUTINE</p><h2>週4回から始める</h2></div>
        <div className="routine-grid">
          <div><strong>週4</strong><span>本ツール</span><small>1回 3分</small></div>
          <div><strong>2–3週</strong><span>ごと</span><small>無音で再測定</small></div>
          <div><strong>4週</strong><span>後</span><small>効果を判定</small></div>
        </div>
      </section>

      <section className="guide-cautions">
        <h2>始める前に</h2>
        <div><Icon name="info" size={18} /><p><strong>簡単すぎる教材が正解です。</strong>未知語を学ぶ場所ではなく、既知語を文章として速く処理するための訓練です。</p></div>
        <div><Icon name="info" size={18} /><p><strong>Chrome推奨です。</strong>韓国語音声が見つからない場合は、自動でハイライトのみへ切り替わります。</p></div>
        <div><Icon name="info" size={18} /><p><strong>履歴はこの端末に自動保存します。</strong>外部サーバーへは送信しません。端末変更やブラウザデータ削除に備え、節目でJSONを保存してください。</p></div>
        <div><Icon name="info" size={18} /><p><strong>個人情報は入力しないでください。</strong>任意メモには氏名や健康情報などを書かず、学習状態だけを短く残してください。</p></div>
        <div><Icon name="info" size={18} /><p><strong>非公式の自主学習用ツールです。</strong>TOPIKおよび運営機関とは関係がなく、収録教材は公式問題の転載ではありません。</p></div>
      </section>
    </main>
  );
}
