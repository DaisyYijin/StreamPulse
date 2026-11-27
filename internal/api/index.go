package api

import (
	"net/http"
	"net/url"

	qrcode "github.com/skip2/go-qrcode"
)

func (a *App) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(indexHTML))
}

func (a *App) handleQRImage(w http.ResponseWriter, r *http.Request) {
	text := r.URL.Query().Get("text")
	if text == "" {
		http.Error(w, "text required", http.StatusBadRequest)
		return
	}
	png, err := qrcode.Encode(text, qrcode.Medium, 320)
	if err != nil {
		http.Error(w, "encode failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(png)
}

func (a *App) handleQRByUID(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	a.qrMu.Lock()
	qr := a.qr[uid]
	a.qrMu.Unlock()
	if qr == nil {
		http.NotFound(w, r)
		return
	}
	text := qr.Content
	png, err := qrcode.Encode(text, qrcode.Medium, 320)
	if err != nil {
		http.Error(w, "encode failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(png)
}

var _ = url.QueryEscape

const indexHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreamPulse</title>
<style>
:root{--bg:#0f172a;--panel:#1e293b;--line:#334155;--ink:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--ok:#22c55e;--bad:#ef4444}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:1px solid var(--line);background:#111827}
h1{font-size:17px;margin:0;letter-spacing:.02em}
main{max-width:1080px;margin:0 auto;padding:22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
h2{font-size:14px;margin:0 0 12px;color:var(--muted);font-weight:600;letter-spacing:.06em;text-transform:uppercase}
button{background:var(--accent);color:#04222f;border:0;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
button:disabled{opacity:.5;cursor:default}
input,select{background:#0b1220;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px 10px;width:100%}
.row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
label{display:block;font-size:12px;color:var(--muted);margin:8px 0 4px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);font-size:13px}
th{color:var(--muted);font-weight:600}
.muted{color:var(--muted)}
.ok{color:var(--ok)}.bad{color:var(--bad)}
#login{max-width:360px;margin:10vh auto}
#qrBox{display:none;margin-top:12px;text-align:center}
#qrBox img{width:220px;height:220px;background:#fff;padding:8px;border-radius:8px}
.hide{display:none!important}
</style>
</head>
<body>
<header>
  <h1>StreamPulse <span class="muted" style="font-size:12px">P0</span></h1>
  <div>
    <span id="who" class="muted"></span>
    <button class="ghost" id="logout">退出</button>
  </div>
</header>

<main>
  <div id="login" class="card">
    <h2>登录</h2>
    <label>用户名</label><input id="u" value="admin" autocomplete="username">
    <label>密码</label><input id="p" type="password" autocomplete="current-password">
    <div style="margin-top:14px"><button id="doLogin">登录</button> <span id="loginMsg" class="bad"></span></div>
  </div>

  <div id="app" class="hide">
    <div class="card">
      <h2>概览</h2>
      <div id="status" class="muted">加载中…</div>
    </div>

    <div class="card">
      <h2>115 账号</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="qrLogin">扫码登录（Cookie）</button>
        <button id="openLogin" class="ghost">开放平台授权</button>
      </div>
      <div id="qrBox"><div class="muted" id="qrMsg">请用 115 App 扫码</div><img id="qrImg" alt="二维码"></div>
      <div id="accList" style="margin-top:12px"></div>
    </div>

    <div class="card">
      <h2>媒体库</h2>
      <table><thead><tr><th>名称</th><th>远端 CID</th><th>本地目录</th><th>模式</th><th>操作</th></tr></thead>
      <tbody id="libs"></tbody></table>
      <div style="margin-top:12px">
        <div class="row">
          <div><label>名称</label><input id="libName" placeholder="电影"></div>
          <div><label>远端 CID（0 = 根）</label><input id="libCid" value="0"></div>
          <div><label>本地目录</label><input id="libDir" placeholder="/media/movies"></div>
          <div><label>播放域名</label><input id="libBase" placeholder="http://IP:6086"></div>
          <div><label>STRM 格式</label><select id="libFmt"><option value="pick_code">pick_code</option><option value="pick_code_name">pick_code_name</option></select></div>
          <div><label>扫描模式</label><select id="libMode"><option value="fast">快速</option><option value="normal">标准</option></select></div>
        </div>
        <div style="margin-top:12px"><button id="addLib">添加媒体库</button> <span id="libMsg" class="bad"></span></div>
      </div>
    </div>

    <div class="card">
      <h2>任务</h2>
      <table><thead><tr><th>#</th><th>类型</th><th>状态</th><th>信息</th></tr></thead><tbody id="tasks"></tbody></table>
    </div>
  </div>
</main>

<script>
const $ = id => document.getElementById(id);
let token = localStorage.getItem('sp_token') || '';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) }
  });
  if (res.status === 401) { showLogin(); throw new Error('未登录'); }
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}

function showLogin() { $('login').classList.remove('hide'); $('app').classList.add('hide'); }
function showApp() { $('login').classList.add('hide'); $('app').classList.remove('hide'); }

$('doLogin').onclick = async () => {
  $('loginMsg').textContent = '';
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    token = d.token; localStorage.setItem('sp_token', token); showApp(); refreshAll();
  } catch (e) { $('loginMsg').textContent = e.message; }
};
$('logout').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch (e) {} token = ''; localStorage.removeItem('sp_token'); showLogin(); };

async function refreshAll() {
  try {
    const s = await api('/api/status');
    $('status').innerHTML = '账号 ' + s.accounts + ' 个 · 媒体库 ' + s.libraries + ' 个 · 播放模式 ' + s.playMode + ' · Emby ' + (s.emby ? '<span class="ok">已配置</span>' : '<span class="muted">未配置</span>');
    const accs = await api('/api/accounts');
    $('accList').innerHTML = accs.map(a => '<div>' + esc(a.name) + ' · ' + esc(a.authType) + ' · ' + esc(a.nickname || '') + '</div>').join('') || '<span class="muted">还没有账号</span>';
    const libs = await api('/api/libraries');
    $('libs').innerHTML = libs.map(l => '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.remoteCid) + '</td><td>' + esc(l.localDir) + '</td><td>' + esc(l.scanMode) + '</td><td><button class="ghost" onclick="scanLib(' + l.id + ')">扫描</button></td></tr>').join('') || '<tr><td colspan="5" class="muted">还没有媒体库</td></tr>';
    const tasks = await api('/api/tasks');
    $('tasks').innerHTML = tasks.map(t => '<tr><td>' + t.id + '</td><td>' + esc(t.kind) + '</td><td>' + esc(t.status) + '</td><td>' + esc(t.message) + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">暂无任务</td></tr>';
  } catch (e) { console.error(e); }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

$('addLib').onclick = async () => {
  $('libMsg').textContent = '';
  try {
    await api('/api/libraries', { method: 'POST', body: JSON.stringify({
      name: $('libName').value, remoteCid: $('libCid').value, localDir: $('libDir').value,
      baseUrl: $('libBase').value, strmFormat: $('libFmt').value, scanMode: $('libMode').value
    })});
    $('libName').value = ''; $('libDir').value = ''; refreshAll();
  } catch (e) { $('libMsg').textContent = e.message; }
};

window.scanLib = async id => { try { await api('/api/libraries/' + id + '/scan', { method: 'POST' }); refreshAll(); } catch (e) { alert(e.message); } };

$('qrLogin').onclick = async () => {
  try {
    const q = await api('/api/accounts/qrcode', { method: 'POST' });
    $('qrBox').style.display = 'block';
    $('qrImg').src = '/api/accounts/qrcode/' + encodeURIComponent(q.uid) + '/image';
    $('qrMsg').textContent = '请用 115 App 扫码';
    const timer = setInterval(async () => {
      try {
        const st = await api('/api/accounts/qrcode/' + encodeURIComponent(q.uid));
        if (st.status === 2) { clearInterval(timer); $('qrBox').style.display = 'none'; refreshAll(); }
        else if (st.status === 1) $('qrMsg').textContent = '已扫码，请在手机上确认';
        else if (st.status === -1) { clearInterval(timer); $('qrMsg').textContent = '二维码已过期，请重试'; }
      } catch (e) {}
    }, 2000);
  } catch (e) { alert(e.message); }
};

$('openLogin').onclick = async () => {
  try {
    const q = await api('/api/accounts/open/start', { method: 'POST' });
    $('qrBox').style.display = 'block';
    $('qrImg').src = '/api/qr?text=' + encodeURIComponent(q.content || '');
    $('qrMsg').textContent = '请用 115 App 扫码授权';
    const timer = setInterval(async () => {
      try {
        const st = await api('/api/accounts/open/' + encodeURIComponent(q.uid));
        if (st.status === 2) { clearInterval(timer); $('qrBox').style.display = 'none'; refreshAll(); }
      } catch (e) {}
    }, 2000);
  } catch (e) { alert(e.message); }
};

if (token) { showApp(); refreshAll(); } else { showLogin(); }
setInterval(() => { if (!$('app').classList.contains('hide')) refreshAll(); }, 5000);
</script>
</body>
</html>`
