import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "stock-final-v1";

const defaultData = {
  stocks: [],
  alerts: [],
  trades: [],
  unread: 0,
};

const TABS = ["アラート", "売買判断", "銘柄リスト", "履歴"];
const BADGE_COLORS = { red: "#fc8181", yellow: "#ecc94b", white: "#718096" };
const BADGE_LABELS = { red: "🔴 有事", yellow: "🟡 注目", white: "⚪ 参考" };
const TRIGGER_LABELS = ["信頼崩壊", "覇権脅威", "地政学リスク", "金融政策", "需給変化"];

function fmt(n) {
  if (!n && n !== 0) return "―";
  return "¥" + Number(n).toLocaleString();
}

function WinBadge({ trades }) {
  if (!trades?.length) return <span style={{ color: "#4a5568", fontSize: 12 }}>記録なし</span>;
  const wins = trades.filter(t => t.result === "win").length;
  const pct = Math.round((wins / trades.length) * 100);
  const color = pct >= 53 ? "#48bb78" : pct >= 51 ? "#ecc94b" : "#fc8181";
  return <span style={{ fontSize: 12 }}>{wins}勝{trades.length - wins}敗　<strong style={{ color }}>{pct}%</strong></span>;
}

export default function App() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState("");
  const [csvError, setCsvError] = useState("");
  const [mode, setMode] = useState("buy");
  const [evalAmt, setEvalAmt] = useState("");
  const [cashAmt, setCashAmt] = useState("");
  const [judgement, setJudgement] = useState(null);
  const [judging, setJudging] = useState(false);
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [trade, setTrade] = useState({ name: "", code: "", entry: "", exit: "", qty: "", result: "win", note: "" });
  const fileRef = useRef();

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setData(JSON.parse(saved));
    setLoading(false);
  }, []);

  async function save(next) {
    setData(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function handleCsv(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCsvError("");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const lines = ev.target.result.split("\n").filter(l => l.trim());
      const stocks = [];
      for (const line of lines) {
        const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
        if (cols.length >= 2) {
          const code = cols[0].match(/^\d{4}$/) ? cols[0] : cols[1];
          const name = cols[0].match(/^\d{4}$/) ? cols[1] : cols[0];
          if (code && name) stocks.push({ name, code });
        }
      }
      if (stocks.length === 0) { setCsvError("CSVの形式を確認してください"); return; }
      await save({ ...data, stocks });
    };
    reader.readAsText(file, "UTF-8");
  }

  async function runScan() {
    if (!data.stocks.length) { setTab(2); return; }
    setScanning(true);
    setScanPhase("📡 最新ニュースを収集中...");
    const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
    const stockList = data.stocks.map(s => `${s.name}(${s.code})`).join("、");

    const prompt = `あなたは日本株スイングトレード（数日〜2週間）の専門分析AIです。
今日は${today}です。

【監視銘柄リスト】
${stockList}

【指示】
web_searchツールを使い以下を検索してください：
1.「日本株 重要ニュース ${today}」
2.「日経平均 今日 相場 材料」
3. 上記銘柄リストの中で特に話題になっている銘柄のニュース

検索結果をもとに分析し、以下のJSON形式のみで返答してください（説明文・マークダウン・コードブロック記号は一切不要）：

{
  "date": "${today}",
  "is_emergency": true or false,
  "emergency_note": "有事の場合のみ内容（なければnull）",
  "market_summary": "相場全体の概況（2〜3行）",
  "alerts": [
    {
      "level": "red or yellow or white",
      "trigger": "信頼崩壊 or 覇権脅威 or 地政学リスク or 金融政策 or 需給変化",
      "headline": "見出し（20字以内）",
      "summary": "要約（40字以内）",
      "buy": [{"name": "銘柄名", "code": "4桁コード", "reason": "理由（15字以内）"}],
      "sell": [{"name": "銘柄名", "code": "4桁コード", "reason": "理由（15字以内）"}],
      "technical": {
        "signal": "買い or 売り or 様子見",
        "pattern": "パターン名（なければnull）",
        "reason": "テクニカル判断の理由（25字以内）"
      },
      "timeframe": "時間軸（例：3日以内）",
      "stop_loss": "損切りライン（例：取得後−5%）"
    }
  ],
  "one_line": "今日の一言（25字以内）"
}
alertsは重要度順に最大4件。redは有事・強シグナルのみ。監視銘柄を優先すること。`;

    try {
      setScanPhase("🤖 AIが分析中...");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = await res.json();
      const text = json.content.map(b => b.type === "text" ? b.text : "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const newAlert = { ...parsed, id: Date.now(), time: new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) };
      await save({ ...data, alerts: [newAlert, ...data.alerts].slice(0, 15), unread: (data.unread || 0) + (parsed.alerts?.length || 0) });
      setTab(0);
    } catch (e) { console.error(e); }
    setScanPhase("");
    setScanning(false);
  }

  async function runJudgement() {
    setJudging(true);
    setJudgement(null);
    const latest = data.alerts[0];
    const ctx = latest ? `最新相場：${latest.market_summary}` : "相場情報なし";
    const prompt = mode === "buy"
      ? `日本株スイングトレードの買い判断をしてください。
現在の評価額：${evalAmt ? fmt(evalAmt) : "0円（新規）"}
口座残高：${fmt(cashAmt)}
${ctx}
JSON形式のみで返答（説明文不要）：
{"action":"買い推奨 or 見送り推奨","amount_pct":数字,"amount_yen":数字,"stop_loss_pct":数字,"reason":"40字以内","caution":"30字以内"}`
      : `日本株スイングトレードの売り判断をしてください。
現在の評価額：${fmt(evalAmt)}
${ctx}
JSON形式のみで返答（説明文不要）：
{"action":"利確推奨 or 損切り推奨 or 保持推奨","sell_pct":数字,"sell_yen":数字,"reason":"40字以内","caution":"30字以内"}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      const json = await res.json();
      const text = json.content.map(b => b.type === "text" ? b.text : "").join("");
      setJudgement(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch (e) { setJudgement({ error: true }); }
    setJudging(false);
  }

  async function addTrade() {
    if (!trade.name) return;
    const pnl = trade.exit && trade.entry && trade.qty ? (Number(trade.exit) - Number(trade.entry)) * Number(trade.qty) : null;
    await save({ ...data, trades: [{ ...trade, pnl, id: Date.now(), date: new Date().toLocaleDateString("ja-JP") }, ...data.trades] });
    setTrade({ name: "", code: "", entry: "", exit: "", qty: "", result: "win", note: "" });
    setShowTradeForm(false);
  }

  const inp = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, color: "#e6edf3", padding: "9px 11px", fontSize: 14, width: "100%", boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
  const row = { display: "flex", gap: 8 };
  const card = { background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 14, marginBottom: 12 };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0d1117" }}><div style={{ width: 36, height: 36, border: "3px solid #21262d", borderTop: "3px solid #58a6ff", borderRadius: "50%" }} /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", maxWidth: 480, margin: "0 auto", paddingBottom: 48 }}>
      <header style={{ background: "#0d1117", borderBottom: "1px solid #21262d", padding: "12px 16px", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#58a6ff", letterSpacing: 1 }}>株アラート</div>
            <div style={{ marginTop: 1 }}><WinBadge trades={data.trades} /></div>
          </div>
          <button onClick={runScan} disabled={scanning} style={{ background: scanning ? "#21262d" : "linear-gradient(135deg,#1f6feb,#388bfd)", border: "none", borderRadius: 10, color: "#fff", padding: "10px 16px", fontSize: 13, fontWeight: "bold", cursor: scanning ? "not-allowed" : "pointer" }}>
            {scanning ? scanPhase : "📡 今すぐ分析"}
          </button>
        </div>
      </header>

      <div style={{ display: "flex", background: "#161b22", borderBottom: "1px solid #21262d", padding: "4px 12px 0", gap: 2 }}>
        {TABS.map((t, i) => (
          <button key={t} onClick={() => { setTab(i); if (i === 0) save({ ...data, unread: 0 }); }} style={{ flex: 1, background: "transparent", border: "none", borderBottom: tab === i ? "2px solid #58a6ff" : "2px solid transparent", color: tab === i ? "#58a6ff" : "#8b949e", padding: "10px 0", fontSize: 12, fontWeight: "bold", cursor: "pointer", position: "relative" }}>
            {t}
            {i === 0 && data.unread > 0 && <span style={{ position: "absolute", top: 6, right: 4, background: "#fc8181", borderRadius: "50%", width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: "bold" }}>{data.unread > 9 ? "9+" : data.unread}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: 12 }}>
        {tab === 0 && (
          <div>
            {data.stocks.length === 0 && <div style={{ ...card, borderColor: "#ecc94b", textAlign: "center" }}><p style={{ color: "#ecc94b", margin: 0, fontSize: 13 }}>⚠️ まず「銘柄リスト」タブでCSVをアップロードしてください</p></div>}
            {data.alerts.length === 0 && data.stocks.length > 0 && <div style={{ textAlign: "center", color: "#484f58", padding: "60px 20px", fontSize: 14, lineHeight: 2.2 }}><div style={{ fontSize: 44, marginBottom: 8 }}>📡</div><p>「今すぐ分析」を押すと</p><p>AIが最新ニュースを自動収集します</p></div>}
            {data.alerts.map(scan => (
              <div key={scan.id} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "#484f58", marginBottom: 6 }}>{scan.time} 取得</div>
                {scan.is_emergency && <div style={{ background: "rgba(252,129,129,0.15)", border: "1px solid #fc8181", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}><div style={{ color: "#fc8181", fontWeight: "bold" }}>🚨 有事アラート</div><p style={{ margin: "4px 0 0", fontSize: 13, color: "#fca5a5" }}>{scan.emergency_note}</p></div>}
                {scan.market_summary && <div style={{ ...card, padding: "10px 12px", marginBottom: 10 }}><div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4, fontWeight: "bold" }}>📊 相場概況</div><p style={{ margin: 0, fontSize: 13, color: "#adbac7", lineHeight: 1.7 }}>{scan.market_summary}</p></div>}
                {scan.alerts?.map((a, i) => (
                  <div key={i} style={{ borderLeft: `3px solid ${BADGE_COLORS[a.level]}`, background: `${BADGE_COLORS[a.level]}11`, borderRadius: "0 10px 10px 0", padding: "12px 12px", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ color: BADGE_COLORS[a.level], fontWeight: "bold", fontSize: 13 }}>{BADGE_LABELS[a.level]}</span>
                      <span style={{ fontSize: 10, color: "#8b949e", background: "#21262d", borderRadius: 4, padding: "2px 6px" }}>{a.trigger}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: "bold", marginBottom: 4 }}>{a.headline}</div>
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: "#adbac7", lineHeight: 1.6 }}>{a.summary}</p>
                    {a.buy?.length > 0 && <div style={{ marginBottom: 6 }}><div style={{ fontSize: 12, color: "#48bb78", fontWeight: "bold", marginBottom: 3 }}>📈 買い候補</div>{a.buy.map((b, j) => <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingBottom: 2 }}><strong>{b.name}</strong><span style={{ fontSize: 11, color: "#8b949e", background: "#21262d", borderRadius: 4, padding: "1px 5px" }}>{b.code}</span><span style={{ fontSize: 11, color: "#8b949e" }}>{b.reason}</span></div>)}</div>}
                    {a.sell?.length > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 12, color: "#fc8181", fontWeight: "bold", marginBottom: 3 }}>📉 売り候補</div>{a.sell.map((sl, j) => <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingBottom: 2 }}><strong>{sl.name}</strong><span style={{ fontSize: 11, color: "#8b949e", background: "#21262d", borderRadius: 4, padding: "1px 5px" }}>{sl.code}</span><span style={{ fontSize: 11, color: "#8b949e" }}>{sl.reason}</span></div>)}</div>}
                    {a.technical && <div style={{ background: "#0d1117", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}><div style={{ fontSize: 11, color: "#8b949e", marginBottom: 3 }}>📐 テクニカル</div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: "bold", color: a.technical.signal === "買い" ? "#48bb78" : a.technical.signal === "売り" ? "#fc8181" : "#ecc94b", fontSize: 14 }}>{a.technical.signal}</span>{a.technical.pattern && <span style={{ fontSize: 11, color: "#58a6ff", background: "rgba(88,166,255,0.1)", borderRadius: 4, padding: "2px 6px" }}>{a.technical.pattern}</span>}</div><p style={{ margin: "4px 0 0", fontSize: 12, color: "#8b949e" }}>{a.technical.reason}</p></div>}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {a.timeframe && <span style={{ fontSize: 11, color: "#8b949e", background: "#21262d", borderRadius: 4, padding: "2px 7px" }}>⏱ {a.timeframe}</span>}
                      {a.stop_loss && <span style={{ fontSize: 11, color: "#fc8181", background: "rgba(252,129,129,0.1)", borderRadius: 4, padding: "2px 7px" }}>✂️ {a.stop_loss}</span>}
                    </div>
                  </div>
                ))}
                {scan.one_line && <div style={{ fontSize: 13, color: "#8b949e", background: "#161b22", borderRadius: 8, padding: "8px 12px", fontStyle: "italic" }}>💡 {scan.one_line}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === 1 && (
          <div>
            <div style={card}>
              <div style={{ ...row, marginBottom: 14 }}>
                <button onClick={() => { setMode("buy"); setJudgement(null); }} style={{ flex: 1, border: "none", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: "bold", cursor: "pointer", background: mode === "buy" ? "rgba(72,187,120,0.2)" : "#0d1117", color: mode === "buy" ? "#48bb78" : "#8b949e" }}>📈 買う</button>
                <button onClick={() => { setMode("sell"); setJudgement(null); }} style={{ flex: 1, border: "none", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: "bold", cursor: "pointer", background: mode === "sell" ? "rgba(252,129,129,0.2)" : "#0d1117", color: mode === "sell" ? "#fc8181" : "#8b949e" }}>📉 売る</button>
              </div>
              {mode === "buy" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div><label style={{ fontSize: 12, color: "#8b949e", display: "block", marginBottom: 4 }}>現在の評価額（新規なら0）</label><input style={inp} type="number" placeholder="例：120000" value={evalAmt} onChange={e => setEvalAmt(e.target.value)} /></div>
                  <div><label style={{ fontSize: 12, color: "#8b949e", display: "block", marginBottom: 4 }}>口座残高（使える現金）</label><input style={inp} type="number" placeholder="例：200000" value={cashAmt} onChange={e => setCashAmt(e.target.value)} /></div>
                </div>
              ) : (
                <div><label style={{ fontSize: 12, color: "#8b949e", display: "block", marginBottom: 4 }}>現在の評価額</label><input style={inp} type="number" placeholder="例：150000" value={evalAmt} onChange={e => setEvalAmt(e.target.value)} /></div>
              )}
              <button onClick={runJudgement} disabled={judging || !evalAmt || (mode === "buy" && !cashAmt)} style={{ width: "100%", marginTop: 12, background: judging ? "#21262d" : "#1f6feb", border: "none", borderRadius: 8, color: "#fff", padding: "11px 0", fontSize: 14, fontWeight: "bold", cursor: judging ? "not-allowed" : "pointer" }}>
                {judging ? "判断中..." : "AIに判断材料を出してもらう"}
              </button>
            </div>
            {judgement && !judgement.error && (
              <div style={{ ...card, borderColor: mode === "buy" ? "#48bb78" : "#fc8181" }}>
                <div style={{ fontSize: 16, fontWeight: "bold", color: mode === "buy" ? "#48bb78" : "#fc8181", marginBottom: 10 }}>{judgement.action}</div>
                {mode === "buy" ? (<><div style={{ fontSize: 22, fontWeight: 800, color: "#58a6ff", marginBottom: 4 }}>口座残高の {judgement.amount_pct}%</div><div style={{ fontSize: 14, color: "#adbac7", marginBottom: 10 }}>≒ {fmt(judgement.amount_yen)} を投入</div><div style={{ background: "rgba(252,129,129,0.1)", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}><span style={{ fontSize: 12, color: "#fc8181" }}>✂️ 損切りライン：取得後 −{judgement.stop_loss_pct}%</span></div></>) : (<><div style={{ fontSize: 22, fontWeight: 800, color: "#58a6ff", marginBottom: 4 }}>評価額の {judgement.sell_pct}%</div><div style={{ fontSize: 14, color: "#adbac7", marginBottom: 10 }}>≒ {fmt(judgement.sell_yen)} を売却</div></>)}
                <p style={{ fontSize: 13, color: "#adbac7", margin: "0 0 6px" }}>📋 {judgement.reason}</p>
                <p style={{ fontSize: 12, color: "#ecc94b", margin: 0 }}>⚠️ {judgement.caution}</p>
              </div>
            )}
            {judgement?.error && <p style={{ color: "#fc8181", fontSize: 13 }}>判断に失敗しました。再度お試しください。</p>}
            <p style={{ fontSize: 10, color: "#30363d", textAlign: "center" }}>※ AIの提示は参考情報です。最終判断はご自身でお願いします。</p>
          </div>
        )}

        {tab === 2 && (
          <div>
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 10 }}>📂 CSVをアップロード</div>
              <p style={{ fontSize: 12, color: "#8b949e", margin: "0 0 10px", lineHeight: 1.7 }}>コード,銘柄名　または　銘柄名,コード<br />どちらの順でも自動判定します</p>
              <div style={{ background: "#0d1117", borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontFamily: "monospace", fontSize: 12, color: "#8b949e" }}>
                7203,トヨタ自動車<br />6758,ソニーグループ<br />8306,三菱UFJ
              </div>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCsv} />
              <button onClick={() => fileRef.current.click()} style={{ width: "100%", background: "#1f6feb", border: "none", borderRadius: 8, color: "#fff", padding: "11px 0", fontSize: 14, fontWeight: "bold", cursor: "pointer" }}>CSVファイルを選択</button>
              {csvError && <p style={{ color: "#fc8181", fontSize: 12, marginTop: 6 }}>{csvError}</p>}
            </div>
            {data.stocks.length > 0 && (
              <div style={card}>
                <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 10 }}>登録済み銘柄　<span style={{ color: "#58a6ff" }}>{data.stocks.length}件</span></div>
                {data.stocks.map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #21262d", fontSize: 13 }}>
                    <span>{s.name}</span><span style={{ color: "#8b949e", fontFamily: "monospace" }}>{s.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 3 && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: "bold" }}>📋 売買記録</span>
                <button onClick={() => setShowTradeForm(!showTradeForm)} style={{ background: "#21262d", border: "1px solid #30363d", color: "#8b949e", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>{showTradeForm ? "閉じる" : "+ 記録"}</button>
              </div>
              {showTradeForm && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #21262d" }}>
                  <div style={row}><input style={{ ...inp, flex: 2 }} placeholder="銘柄名" value={trade.name} onChange={e => setTrade({ ...trade, name: e.target.value })} /><input style={{ ...inp, flex: 1 }} placeholder="コード" value={trade.code} onChange={e => setTrade({ ...trade, code: e.target.value })} /></div>
                  <div style={row}><input style={{ ...inp, flex: 1 }} placeholder="買値" type="number" value={trade.entry} onChange={e => setTrade({ ...trade, entry: e.target.value })} /><input style={{ ...inp, flex: 1 }} placeholder="売値" type="number" value={trade.exit} onChange={e => setTrade({ ...trade, exit: e.target.value })} /><input style={{ ...inp, flex: 1 }} placeholder="株数" type="number" value={trade.qty} onChange={e => setTrade({ ...trade, qty: e.target.value })} /></div>
                  <div style={row}>
                    <button onClick={() => setTrade({ ...trade, result: "win" })} style={{ flex: 1, border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: "bold", cursor: "pointer", background: trade.result === "win" ? "rgba(72,187,120,0.2)" : "#0d1117", color: trade.result === "win" ? "#48bb78" : "#8b949e" }}>✅ 勝ち</button>
                    <button onClick={() => setTrade({ ...trade, result: "loss" })} style={{ flex: 1, border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: "bold", cursor: "pointer", background: trade.result === "loss" ? "rgba(252,129,129,0.2)" : "#0d1117", color: trade.result === "loss" ? "#fc8181" : "#8b949e" }}>❌ 負け</button>
                  </div>
                  <input style={inp} placeholder="メモ（任意）" value={trade.note} onChange={e => setTrade({ ...trade, note: e.target.value })} />
                  <button onClick={addTrade} style={{ background: "#1f6feb", border: "none", borderRadius: 8, color: "#fff", padding: "10px 0", fontSize: 13, fontWeight: "bold", cursor: "pointer" }}>記録する</button>
                </div>
              )}
              {data.trades.length > 0 && <div style={{ padding: "8px 0 10px", borderBottom: "1px solid #21262d", marginBottom: 8, fontSize: 14 }}>通算成績：<WinBadge trades={data.trades} /></div>}
              {data.trades.length === 0 && <p style={{ fontSize: 12, color: "#484f58" }}>売買のたびに記録すると勝率が自動計算されます</p>}
              {data.trades.map(t => (
                <div key={t.id} style={{ borderLeft: `3px solid ${t.result === "win" ? "#48bb78" : "#fc8181"}`, paddingLeft: 10, paddingTop: 8, paddingBottom: 8, borderBottom: "1px solid #21262d" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}><span><strong>{t.name}</strong> <span style={{ fontSize: 11, color: "#8b949e", background: "#21262d", borderRadius: 4, padding: "1px 5px" }}>{t.code}</span></span><span style={{ color: t.result === "win" ? "#48bb78" : "#fc8181", fontWeight: "bold" }}>{t.result === "win" ? "✅ 勝" : "❌ 負"}</span></div>
                  {t.pnl !== null && <div style={{ color: t.pnl >= 0 ? "#48bb78" : "#fc8181", fontSize: 14, fontWeight: "bold" }}>{t.pnl >= 0 ? "+" : ""}{fmt(t.pnl)}</div>}
                  <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{t.date}　{t.entry && `買${fmt(t.entry)}`}{t.exit && ` → 売${fmt(t.exit)}`}</div>
                  {t.note && <p style={{ fontSize: 11, color: "#8b949e", margin: "3px 0 0" }}>{t.note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
