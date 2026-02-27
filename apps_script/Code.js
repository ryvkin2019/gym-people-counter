const SHEET_NAME = "Logs";
const SCRIPT_EXEC_URL = "https://script.google.com/macros/s/AKfycby-d3j_5msz9NjzXXQIcm6m3DhbDXhKqJc_d6clNSZ2MBFVBWjpOdr9rO2eun72lo33bA/exec";

function doGet(e) {
  // 1) LOG EVENT from ESP32
  if (e?.parameter?.timestamp && e?.parameter?.direction && e?.parameter?.people) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    const tsRaw = e.parameter.timestamp;
    const tsStr = decodeURIComponent(tsRaw).replace("T", " "); // "2026-02-21 12:02:08"
    const dir = String(e.parameter.direction).toUpperCase();
    const ppl = Number(e.parameter.people);

    // safe parse Date
    const d = new Date(tsStr.replace(" ", "T"));
    sheet.appendRow([d, dir, ppl]);

    return json_({ status: "ok", ts: tsStr, dir, ppl });
  }

  // 2) API
  if (e?.parameter?.api == "1") {
    return json_(buildStats_());
  }

  // 3) manifest
  if (e?.parameter?.manifest == "1") {
    const manifest = {
      name: "Gym Counter",
      short_name: "Gym",
      start_url: SCRIPT_EXEC_URL,
      display: "standalone",
      background_color: "#0b1020",
      theme_color: "#0b1020",
      icons: [
        {
          src: "https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png",
          sizes: "48x48",
          type: "image/png"
        }
      ]
    };
    return ContentService.createTextOutput(JSON.stringify(manifest))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 4) UI
  return HtmlService.createHtmlOutput(buildHtml_())
    .setTitle("Gym Counter")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildStats_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  const lastRow = sh.getLastRow();

  const empty = {
    now: 0,
    lastTs: null,
    todayIn: 0,
    todayOut: 0,
    byHour: Array.from({ length: 24 }, (_, h) => ({ h, in: 0, out: 0 })),
    byDay: []
  };
  if (lastRow < 2) return empty;

  const startRow = Math.max(2, lastRow - 4999);
  const values = sh.getRange(startRow, 1, lastRow - startRow + 1, 3).getValues();

  // last people + last timestamp
  let now = 0;
  let lastTs = null;

  for (let i = values.length - 1; i >= 0; i--) {
    const ts = values[i][0];
    const ppl = values[i][2];

    if (!lastTs && ts) {
      if (ts instanceof Date) lastTs = ts;
      else {
        const d = new Date(ts.toString().replace(" ", "T"));
        if (!isNaN(d.getTime())) lastTs = d;
      }
    }

    if (typeof ppl === "number") { now = ppl; break; }
    if (ppl && !isNaN(Number(ppl))) { now = Number(ppl); break; }
  }

  const tz = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

  const byHour = Array.from({ length: 24 }, (_, h) => ({ h, in: 0, out: 0 }));
  let todayIn = 0, todayOut = 0;

  const dayMap = {};
  const daysToShow = 14;

  values.forEach(row => {
    const ts = row[0];
    const dir = (row[1] || "").toString().toUpperCase();
    if (!ts || (dir !== "IN" && dir !== "OUT")) return;

    const d = (ts instanceof Date) ? ts : new Date(ts.toString().replace(" ", "T"));
    if (isNaN(d.getTime())) return;

    const ds = Utilities.formatDate(d, tz, "yyyy-MM-dd");
    const hour = Number(Utilities.formatDate(d, tz, "H"));

    if (ds === todayStr) {
      if (dir === "IN") { todayIn++; byHour[hour].in++; }
      else { todayOut++; byHour[hour].out++; }
    }

    if (!dayMap[ds]) dayMap[ds] = { in: 0, out: 0 };
    if (dir === "IN") dayMap[ds].in++;
    else dayMap[ds].out++;
  });

  const dates = Object.keys(dayMap).sort();
  const lastDates = dates.slice(Math.max(0, dates.length - daysToShow));
  const byDay = lastDates.map(ds => ({ d: ds, in: dayMap[ds].in, out: dayMap[ds].out }));

  const lastTsStr = lastTs
    ? Utilities.formatDate(lastTs, tz, "yyyy-MM-dd HH:mm:ss")
    : null;

  return { now, lastTs: lastTsStr, todayIn, todayOut, byHour, byDay };
}

function buildHtml_() {
  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Gym Counter</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="theme-color" content="#0b1020"/>
<link rel="manifest" href="?manifest=1">

<style>
  :root{
    --bg:#0b1020;
    --card: rgba(255,255,255,.06);
    --card2: rgba(255,255,255,.04);
    --border: rgba(255,255,255,.10);
    --text:#eef3ff;
    --muted:#9aa7bf;
    --grid: rgba(154,167,191,.18);
    --in:#4fc3f7;
    --out:#ffb74d;
    --ok:#39d98a;
    --bad:#ff5c7a;
    --shadow: 0 16px 44px rgba(0,0,0,.38);
    --radius: 20px;
  }
  *{ box-sizing:border-box; }
  body{
    margin:0;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    color:var(--text);
    background:
      radial-gradient(1100px 520px at 15% -10%, rgba(79,195,247,.20), transparent 55%),
      radial-gradient(900px 520px at 90% 0%, rgba(255,183,77,.18), transparent 55%),
      radial-gradient(700px 500px at 50% 120%, rgba(57,217,138,.10), transparent 55%),
      var(--bg);
  }
  .wrap{ max-width: 1180px; margin: 0 auto; padding: 18px; }
  .topbar{
    display:flex; align-items:center; justify-content:space-between;
    gap:12px; margin-bottom:14px;
  }
  .brand{ display:flex; align-items:center; gap:10px; font-weight:800; letter-spacing:.2px; }
  .logo{
    width:38px; height:38px; border-radius:14px;
    background: linear-gradient(135deg, rgba(79,195,247,.28), rgba(255,183,77,.22));
    border:1px solid var(--border);
    box-shadow: 0 10px 30px rgba(0,0,0,.25);
    display:grid; place-items:center;
  }
  .pill{
    font-size:12px; color:var(--muted);
    padding:6px 10px; border-radius:999px;
    border:1px solid var(--border);
    background: rgba(255,255,255,.04);
    margin-top:2px;
    display:inline-block;
  }
  .actions{ display:flex; align-items:center; gap:10px; }
  .btn{
    padding:10px 12px;
    border-radius:14px;
    border:1px solid var(--border);
    background: rgba(255,255,255,.05);
    color:var(--text);
    cursor:pointer;
    transition: .15s transform ease, .15s background ease;
    user-select:none;
  }
  .btn:hover{ background: rgba(255,255,255,.09); }
  .btn:active{ transform: scale(.98); }
  .status{
    display:flex; align-items:center; gap:8px;
    font-size:12px; color:var(--muted);
    padding:8px 10px; border-radius:999px;
    border:1px solid var(--border);
    background: rgba(0,0,0,.16);
  }
  .dot{ width:10px; height:10px; border-radius:50%; background: rgba(255,255,255,.25); }
  .dot.ok{ background: var(--ok); }
  .dot.bad{ background: var(--bad); }
  .grid{
    display:grid;
    grid-template-columns: 1.25fr .75fr;
    gap:14px;
  }
  .card{
    border-radius: var(--radius);
    border:1px solid var(--border);
    background: linear-gradient(180deg, var(--card), var(--card2));
    box-shadow: var(--shadow);
    padding:16px;
    overflow:hidden;
  }
  .kpiRow{ display:flex; gap:12px; flex-wrap:wrap; }
  .kpi{
    flex:1; min-width: 240px;
    border-radius: 18px;
    border:1px solid rgba(255,255,255,.10);
    background: rgba(0,0,0,.14);
    padding:14px;
  }
  .label{ color:var(--muted); font-size:12px; }
  .big{
    font-size: 54px; font-weight: 900; line-height: 1;
    margin-top: 8px;
    letter-spacing:.5px;
  }
  .sub{ margin-top:10px; color:var(--muted); font-size:12px; }
  .split{ display:flex; gap:18px; margin-top:10px; align-items:flex-end; }
  .num{ font-size: 42px; font-weight: 900; line-height:1; }
  .num.in{ color: var(--in); }
  .num.out{ color: var(--out); }
  .sectionTitle{
    display:flex; align-items:baseline; justify-content:space-between;
    gap:10px; margin: 14px 0 10px;
  }
  .sectionTitle h3{ margin:0; font-size:14px; font-weight:800; letter-spacing:.2px; }
  .hint{ color:var(--muted); font-size:12px; }
  .scrollX{
    overflow-x:auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 6px;
  }
  .scrollX::-webkit-scrollbar{ height:8px; }
  .scrollX::-webkit-scrollbar-thumb{
    background: rgba(255,255,255,.12);
    border-radius: 999px;
  }
  .chartBox{
    border-radius: 18px;
    border:1px solid rgba(255,255,255,.10);
    background: rgba(0,0,0,.18);
    padding:10px;
  }
  canvas{
    display:block;
    width:100%;
    height: 300px;
  }
  #cHour{
    width: 980px;
    height: 300px;
  }
  .legend{
    display:flex; gap:14px; align-items:center;
    margin-top:10px;
    color:var(--muted); font-size:12px;
  }
  .sw{ width:10px; height:10px; border-radius:3px; display:inline-block; }
  .sw.in{ background: var(--in); }
  .sw.out{ background: var(--out); }
  .footer{
    margin-top: 12px;
    color: var(--muted);
    font-size:12px;
  }
  @media (max-width: 920px){
    .grid{ grid-template-columns: 1fr; }
  }
  @media (max-width: 520px){
    .wrap{ padding: 14px; }
    .big{ font-size: 46px; }
    .num{ font-size: 38px; }
    canvas{ height: 260px; }
    #cHour{ height: 260px; }
  }
</style>
</head>

<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand">
      <div class="logo">🏋️</div>
      <div>
        <div>Gym Counter</div>
        <div class="pill">Web + Mobile • PWA</div>
      </div>
    </div>

    <div class="actions">
      <div class="status" id="status">
        <span class="dot" id="dot"></span>
        <span id="statusText">—</span>
      </div>
      <button class="btn" id="refreshBtn">Refresh</button>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="kpiRow">
        <div class="kpi">
          <div class="label">People now</div>
          <div class="big" id="now">—</div>
          <div class="sub" id="last">Last: —</div>
        </div>

        <div class="kpi">
          <div class="label">Today</div>
          <div class="split">
            <div>
              <div class="label">IN</div>
              <div class="num in" id="todayIn">—</div>
            </div>
            <div>
              <div class="label">OUT</div>
              <div class="num out" id="todayOut">—</div>
            </div>
          </div>
          <div class="sub">Auto refresh every 10s</div>
        </div>
      </div>

      <div class="sectionTitle">
        <h3>Today by hour</h3>
        <div class="hint">00:00 → 23:00</div>
      </div>

      <div class="chartBox">
        <div class="scrollX">
          <canvas id="cHour"></canvas>
        </div>
      </div>

      <div class="legend">
        <span><span class="sw in"></span> IN</span>
        <span><span class="sw out"></span> OUT</span>
      </div>
    </div>

    <div class="card">
      <div class="sectionTitle">
        <h3>Last 14 days</h3>
        <div class="hint">Daily IN/OUT</div>
      </div>

      <div class="chartBox">
        <canvas id="cDay"></canvas>
      </div>

      <div class="legend">
        <span><span class="sw in"></span> IN</span>
        <span><span class="sw out"></span> OUT</span>
      </div>

      <div class="footer">
        📱 На телефоне: меню браузера → “Add to Home Screen”.
      </div>
    </div>
  </div>
</div>

<script>
function setStatus(ok, text){
  const dot = document.getElementById('dot');
  const st = document.getElementById('statusText');
  dot.className = "dot " + (ok ? "ok" : "bad");
  st.textContent = text;
}

function pad2(n){ return String(n).padStart(2,'0'); }
const HOUR_LABELS = Array.from({length:24}, (_,h)=> pad2(h)+":00");

// ✅ FIX: always use real exec URL (not preview/userCodeAppPanel)
const API_BASE = "${SCRIPT_EXEC_URL}";
function apiUrl(){
  return API_BASE + "?api=1&t=" + Date.now();
}

async function fetchData(){
  setStatus(true, "Loading...");
  const r = await fetch(apiUrl(), { cache:"no-store", redirect:"follow" });
  const txt = await r.text();
  if (txt.trim().startsWith("<")) throw new Error("HTML вместо JSON (не тот URL или доступ)");
  return JSON.parse(txt);
}

function setupCanvasHiDPI(canvas){
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight || 260;
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width  = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return { ctx, w: cssW, h: cssH };
}

function drawBars(canvas, labels, a, b){
  const { ctx, w, h } = setupCanvasHiDPI(canvas);
  ctx.clearRect(0,0,w,h);

  const padL=44, padR=12, padT=12, padB=34;
  const gw=w-padL-padR, gh=h-padT-padB;

  const max = Math.max(1, ...a, ...b);
  const n = labels.length;

  const gap = Math.max(3, Math.floor(gw/n*0.12));
  const barW = (gw - gap*(n-1)) / n;

  // grid
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid');
  ctx.lineWidth = 1;

  ctx.fillStyle = "rgba(154,167,191,0.85)";
  ctx.font = "12px ui-sans-serif, system-ui";

  for(let i=0;i<=4;i++){
    const y = padT + gh - (gh*i/4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL+gw, y);
    ctx.stroke();
    const val = Math.round(max*i/4);
    ctx.fillText(String(val), 8, y+4);
  }

  // baseline
  ctx.strokeStyle = "rgba(154,167,191,0.25)";
  ctx.beginPath();
  ctx.moveTo(padL, padT+gh);
  ctx.lineTo(padL+gw, padT+gh);
  ctx.stroke();

  // bars
  for(let i=0;i<n;i++){
    const x = padL + i*(barW+gap);
    const ha = (a[i]/max)*gh;
    const hb = (b[i]/max)*gh;

    // IN
    ctx.fillStyle = "rgba(79,195,247,0.95)";
    ctx.fillRect(x, padT+gh-ha, (barW*0.5)-1, ha);

    // OUT
    ctx.fillStyle = "rgba(255,183,77,0.95)";
    ctx.fillRect(x+(barW*0.5), padT+gh-hb, (barW*0.5)-1, hb);

    // labels
    const step = (n === 24) ? 2 : Math.ceil(n/8);
    if(i % step === 0){
      ctx.fillStyle = "rgba(154,167,191,0.9)";
      ctx.fillText(labels[i], x-2, padT+gh+22);
    }
  }
}

async function refresh(){
  try{
    const j = await fetchData();

    document.getElementById('now').textContent = j.now ?? "—";
    document.getElementById('todayIn').textContent = j.todayIn ?? "—";
    document.getElementById('todayOut').textContent = j.todayOut ?? "—";
    document.getElementById('last').textContent = "Last: " + (j.lastTs || "—");

    const map = new Map((j.byHour || []).map(x => [Number(x.h), x]));
    const inH  = Array.from({length:24}, (_,h)=> (map.get(h)?.in  ?? 0));
    const outH = Array.from({length:24}, (_,h)=> (map.get(h)?.out ?? 0));
    drawBars(document.getElementById('cHour'), HOUR_LABELS, inH, outH);

    const labelsD = (j.byDay || []).map(x => (x.d || "").slice(5)); // MM-DD
    const inD = (j.byDay || []).map(x => x.in || 0);
    const outD = (j.byDay || []).map(x => x.out || 0);
    drawBars(document.getElementById('cDay'), labelsD, inD, outD);

    setStatus(true, "Updated");
  }catch(e){
    console.error(e);
    setStatus(false, "Error: " + e.message);
  }
}

document.getElementById('refreshBtn').addEventListener('click', refresh);
refresh();
setInterval(refresh, 10000);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refresh, 250);
});
</script>

</body>
</html>
`;
}