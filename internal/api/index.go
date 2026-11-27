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
:root{
  --bg:#f4f7f5; --panel:#ffffff; --line:#e4ebe7; --ink:#17211c; --muted:#6b7a72;
  --accent:#0f766e; --accent-2:#14b8a6; --accent-soft:#e6f6f2;
  --danger:#dc2626; --ok:#15803d;
  --shadow:0 12px 34px rgba(20,60,45,.08);
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.hide{display:none!important}
.muted{color:var(--muted)}
h2{font-size:21px;margin:0 0 6px;letter-spacing:-.02em}
.hint{color:var(--muted);font-size:13px;margin:0 0 18px}

.boot-splash{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:var(--bg)}
.boot-splash .logo{width:56px;height:56px;border-radius:18px;font-size:24px}

/* ---------- auth ---------- */
.auth{
  min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:28px 18px;
  background:
    radial-gradient(820px 460px at 8% -12%, #d5f2e8 0%, transparent 62%),
    radial-gradient(760px 420px at 100% 112%, #e2ecff 0%, transparent 58%),
    var(--bg);
}
.auth-card{
  width:min(432px,100%);background:rgba(255,255,255,.94);backdrop-filter:blur(12px);
  border:1px solid var(--line);border-radius:22px;padding:32px 30px 26px;
  box-shadow:0 26px 70px rgba(15,80,60,.13);
}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.logo{
  width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#fff;
  background:linear-gradient(135deg,var(--accent),var(--accent-2));font-weight:800;font-size:20px;
  box-shadow:0 10px 22px rgba(15,118,110,.26);
}
.brand-name{font-weight:750;font-size:18px;letter-spacing:-.01em;line-height:1.25}
.brand-sub{font-size:12px;color:var(--muted)}
label{display:block;font-size:12.5px;font-weight:600;color:#3d4a44;margin:14px 0 6px}
input{
  width:100%;background:#f7faf8;border:1px solid #dfe7e2;border-radius:10px;
  padding:11px 13px;font-size:14px;color:var(--ink);outline:none;transition:border-color .15s, box-shadow .15s, background .15s;
}
input:focus{border-color:var(--accent);background:#fff;box-shadow:0 0 0 4px rgba(15,118,110,.10)}
select{
  width:100%;background:#f7faf8;border:1px solid #dfe7e2;border-radius:10px;
  padding:11px 13px;font-size:14px;color:var(--ink);outline:none;
}
.btn{
  border:0;border-radius:10px;padding:10px 16px;font-weight:650;font-size:14px;cursor:pointer;
  transition:filter .15s, transform .15s, box-shadow .15s;
}
.btn:disabled{opacity:.6;cursor:default}
.btn.primary{
  background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;
  box-shadow:0 10px 22px rgba(15,118,110,.22);
}
.btn.primary:hover{filter:brightness(1.05);transform:translateY(-1px)}
.btn.primary.block{width:100%;margin-top:20px;padding:12px}
.btn.ghost{background:#fff;border:1px solid #dbe4df;color:#33413a}
.btn.ghost:hover{background:#f7faf8}
.msg{color:var(--danger);font-size:13px;min-height:20px;margin-top:10px}
.msg.ok{color:var(--ok)}
.msg.inline{display:inline-block;margin:0 0 0 10px}
.auth-foot{font-size:12px;color:#8a978f}
.rule{display:flex;align-items:center;gap:10px;color:#9aa8a0;font-size:12px;margin:18px 0 0}
.rule::before,.rule::after{content:"";height:1px;background:var(--line);flex:1}

/* ---------- app shell ---------- */
.shell{display:flex;min-height:100vh}
.sidebar{
  width:220px;flex:0 0 220px;background:var(--panel);border-right:1px solid var(--line);
  position:sticky;top:0;height:100vh;display:flex;flex-direction:column;
}
.sidebar .brand{padding:20px 18px 14px;margin:0}
.sidebar .logo{width:36px;height:36px;border-radius:11px;font-size:17px;box-shadow:none}
.sidebar .brand-name{font-size:15px}
.menu{display:flex;flex-direction:column;gap:2px;padding:6px 10px;flex:1}
.menu button{
  position:relative;border:0;background:transparent;text-align:left;cursor:pointer;
  padding:10px 14px;border-radius:9px;font-size:14px;font-weight:600;color:#40504a;
  transition:background .15s,color .15s;
}
.menu button:hover{background:#f2f8f5}
.menu button.active{background:var(--accent-soft);color:var(--accent)}
.menu button.active::before{
  content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:3px;background:var(--accent);
}
.sidebar-foot{
  padding:14px 16px;border-top:1px solid var(--line);display:flex;align-items:center;
  justify-content:space-between;gap:8px;font-size:13px;
}
.content{flex:1;min-width:0;padding:26px 28px 64px;max-width:1120px}
.view{display:none}
.view.active{display:block}
.page-head{margin:0 0 18px}
.page-head h1{font-size:23px;margin:0 0 4px;letter-spacing:-.02em}
.page-head p{margin:0;color:var(--muted);font-size:13px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px;box-shadow:var(--shadow)}
.view > .card + .card{margin-top:16px}
.card-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.card-head h2{font-size:16px;margin:0;letter-spacing:0}
.card-head .hint{margin:0;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}
.grid .full{grid-column:1 / -1}
.row-actions{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{color:var(--muted);font-weight:600;text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:9px 6px;border-bottom:1px solid #eef3f0;vertical-align:middle}
tr:last-child td{border-bottom:0}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
.table-wrap table{padding:0 6px}
.status-line{font-size:14px;color:#3d4a44;display:flex;flex-wrap:wrap;gap:8px 18px}
.status-line b{font-weight:650}
.dot{display:inline-block;width:7px;height:7px;border-radius:99px;background:var(--ok);margin-right:6px;vertical-align:1px}
.dot.off{background:#b6c2bb}
.check{display:flex;align-items:center;gap:8px;font-size:13px;color:#3d4a44;margin-top:12px}
.check input{width:auto;margin:0}
.list{margin-top:14px;display:grid;gap:8px}
.avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;background:#e6f6f2;border:1px solid var(--line);flex:none}
.avatar.small{width:30px;height:30px}
.avatar.fallback{display:grid;place-items:center;font-weight:750;color:var(--accent);font-size:15px}
.side-user{display:flex;align-items:center;gap:8px;min-width:0}
.account-card{display:flex;gap:14px;align-items:center}
.account-card .avatar{width:58px;height:58px;font-size:22px}
.account-meta{min-width:0;flex:1}
.account-name{font-weight:700;font-size:15.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.badge{font-size:11px;padding:2px 8px;border-radius:99px;background:var(--accent-soft);color:var(--accent);font-weight:650}
.badge.vip{background:#fff7e6;color:#b45309}
.quota{height:7px;background:#edf3f0;border-radius:99px;overflow:hidden;margin-top:9px}
.quota i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-2));border-radius:99px}
.quota-text{font-size:12.5px;color:var(--muted);margin-top:6px}
.account-list{display:grid;gap:10px;margin-top:14px}
.list-item{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;background:#f8fbf9;border:1px solid var(--line);border-radius:10px;font-size:13.5px}
.qr-box{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:16px;padding:18px;background:#f8fbf9;border:1px dashed #d8e5df;border-radius:14px}
.qr-box img{width:200px;height:200px;background:#fff;border-radius:10px;padding:8px;box-shadow:0 8px 20px rgba(20,60,45,.10)}
.section-note{font-size:12.5px;color:var(--muted);margin:8px 0 0}
.steps{margin:0;padding-left:20px;color:#3d4a44;font-size:14px}
.steps li{margin:6px 0}

.modal{position:fixed;inset:0;z-index:60;background:rgba(15,35,28,.38);backdrop-filter:blur(3px);display:grid;place-items:center;padding:18px}
.modal-card{width:min(420px,100%);background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px 22px;box-shadow:0 30px 80px rgba(10,40,30,.28)}
.modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.modal-head h3{font-size:17px;margin:0}
.modal-close{border:0;background:transparent;font-size:24px;line-height:1;color:#6b7a72;cursor:pointer}

@media (max-width:860px){
  .shell{display:block}
  .sidebar{position:static;height:auto;width:auto;border-right:0;border-bottom:1px solid var(--line)}
  .sidebar .brand{padding:14px 16px 6px;margin:0}
  .menu{flex-direction:row;overflow-x:auto;padding:4px 10px 10px;gap:4px}
  .menu button{white-space:nowrap;padding:8px 12px}
  .menu button.active::before{display:none}
  .sidebar-foot{border-top:0;padding:0 14px 10px;justify-content:flex-end}
  .content{padding:18px 14px 44px;max-width:none}
  .grid{grid-template-columns:1fr}
  .card{padding:16px}
  .auth-card{padding:26px 22px 22px}
}
</style>
</head>
<body>

<div id="bootSplash" class="boot-splash">
  <div class="logo">S</div>
  <div class="brand-name">StreamPulse</div>
</div>

<div id="auth" class="auth hide">
  <div class="auth-card">
    <div class="brand">
      <div class="logo">S</div>
      <div>
        <div class="brand-name">StreamPulse</div>
        <div class="brand-sub">115 网盘 → STRM 媒体库</div>
      </div>
    </div>

    <div id="loginPane">
      <h2>欢迎回来</h2>
      <p class="hint">登录后管理媒体库、同步与播放设置。</p>
      <form id="loginForm">
        <label>用户名</label>
        <input id="loginUser" value="admin" autocomplete="username">
        <label>密码</label>
        <input id="loginPass" type="password" autocomplete="current-password">
        <div class="msg" id="loginMsg"></div>
        <button class="btn primary block" type="submit">登录</button>
      </form>
      <div class="rule">使用 115 账号扫码前，需要先登录控制台</div>
    </div>

    <div id="setupPane" class="hide">
      <h2>创建管理员</h2>
      <p class="hint">首次使用，请设置管理员账号。密码至少 8 位。</p>
      <form id="setupForm">
        <label>用户名</label>
        <input id="setupUser" value="admin" autocomplete="username">
        <label>密码</label>
        <input id="setupPass" type="password" autocomplete="new-password">
        <label>确认密码</label>
        <input id="setupConfirm" type="password" autocomplete="new-password">
        <div class="msg" id="setupMsg"></div>
        <button class="btn primary block" type="submit">创建并登录</button>
      </form>
    </div>
  </div>
  <div class="auth-foot">StreamPulse · 自托管 STRM 引擎</div>
</div>

<div id="app" class="shell hide">
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">S</div>
      <div class="brand-name">StreamPulse</div>
    </div>
    <nav class="menu">
      <button data-view="dashboard" class="active">概览</button>
      <button data-view="accounts">115 账号</button>
      <button data-view="libraries">媒体库</button>
      <button data-view="tasks">任务</button>
      <button data-view="settings">设置</button>
    </nav>
    <div class="sidebar-foot">
      <div class="side-user">
        <img id="sideAvatar" class="avatar small hide" alt="">
        <span id="who" class="muted"></span>
      </div>
      <button class="btn ghost" id="logout">退出</button>
    </div>
  </aside>

  <main class="content">
    <section id="view-dashboard" class="view active">
      <div class="page-head"><h1>概览</h1><p>账号、媒体库与同步状态</p></div>
      <div class="card">
        <div id="status" class="status-line">加载中…</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>当前账号</h2></div>
        <div id="accountCard" class="muted">尚未登录 115</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>快速开始</h2></div>
        <ol class="steps">
          <li>到「设置」填写播放地址（写入 STRM），以及 Emby 地址与 API Key。</li>
          <li>到「115 账号」用 115 App 扫码登录。</li>
          <li>到「媒体库」添加远端目录并点「扫描」。</li>
        </ol>
      </div>
    </section>

    <section id="view-accounts" class="view">
      <div class="page-head"><h1>115 账号</h1><p>扫码登录，Cookie 保存在本地数据库</p></div>
      <div class="card">
        <div class="row-actions" style="margin-top:0">
          <button class="btn primary" id="qrLogin">扫码登录 115</button>
          <button class="btn ghost" id="openLogin">开放平台扫码（需 AppID）</button>
        </div>
        <div id="accList" class="account-list"></div>
      </div>
    </section>

    <section id="view-libraries" class="view">
      <div class="page-head"><h1>媒体库</h1><p>把 115 目录映射成本地 STRM 媒体库</p></div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>远端 CID</th><th>本地目录</th><th>模式</th><th>操作</th></tr></thead>
            <tbody id="libs"></tbody>
          </table>
        </div>
        <div class="grid" style="margin-top:16px">
          <div><label>名称</label><input id="libName" placeholder="电影"></div>
          <div><label>远端 CID（0 = 根）</label><input id="libCid" value="0"></div>
          <div><label>本地目录</label><input id="libDir" placeholder="/media/movies"></div>
          <div><label>播放域名（留空用全局播放地址）</label><input id="libBase" placeholder="http://192.168.1.10:2048"></div>
          <div><label>STRM 格式</label><select id="libFmt"><option value="pick_code">pick_code</option><option value="pick_code_name">pick_code_name</option></select></div>
          <div><label>扫描模式</label><select id="libMode"><option value="fast">快速</option><option value="normal">标准</option></select></div>
        </div>
        <div class="row-actions">
          <button class="btn primary" id="addLib">添加媒体库</button>
          <span id="libMsg" class="msg inline"></span>
        </div>
      </div>
    </section>

    <section id="view-tasks" class="view">
      <div class="page-head"><h1>任务</h1><p>扫描、目录同步与定时任务记录</p></div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>类型</th><th>状态</th><th>信息</th></tr></thead>
            <tbody id="tasks"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="view-settings" class="view">
      <div class="page-head"><h1>设置</h1><p>保存在本地数据库，保存即生效</p></div>
      <div class="card">
        <div class="card-head"><h2>播放与 Emby</h2></div>
        <div class="grid">
          <div><label>播放地址（写入 STRM）</label><input id="publicBase" placeholder="http://192.168.1.10:2048"></div>
          <div><label>Emby 地址</label><input id="embyBase" placeholder="http://192.168.1.10:8096"></div>
          <div><label>Emby API Key</label><input id="embyApiKey" type="password" autocomplete="off"></div>
          <div><label>Emby Webhook Token</label><input id="embyWebhookToken" type="password" autocomplete="off"></div>
          <div class="full check"><input type="checkbox" id="embyDeleteRemote"><label for="embyDeleteRemote" style="margin:0">删除联动同时删网盘（进 115 回收站）</label></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>115 开放平台</h2><span class="hint">只使用扫码 Cookie 时可以不填</span></div>
        <div class="grid">
          <div><label>AppID</label><input id="p115AppId" autocomplete="off"></div>
          <div><label>AppSecret</label><input id="p115AppSecret" type="password" autocomplete="off"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>管理员</h2></div>
        <div class="grid">
          <div><label>用户名</label><input id="adminUser" autocomplete="username"></div>
          <div><label>新密码（留空不改）</label><input id="adminPassword" type="password" autocomplete="new-password"></div>
        </div>
        <div class="row-actions">
          <button class="btn primary" id="saveSettings">保存设置</button>
          <span id="setMsg" class="msg inline"></span>
        </div>
        <p class="section-note">密钥留空表示不修改；修改播放地址后需重新扫描媒体库以更新 STRM。</p>
      </div>
    </section>
  </main>
</div>

<div id="qrModal" class="modal hide">
  <div class="modal-card">
    <div class="modal-head">
      <h3>登录 115</h3>
      <button class="modal-close" id="qrClose" aria-label="关闭">×</button>
    </div>
    <label>登录设备</label>
    <select id="qrDevice">
      <option value="web">网页端（会顶掉浏览器登录）</option>
      <option value="115android">Android App</option>
      <option value="115ios">iOS App</option>
      <option value="tv">电视端</option>
      <option value="alipaymini">支付宝小程序</option>
      <option value="wechatmini">微信小程序</option>
    </select>
    <div class="qr-box" style="margin-top:14px">
      <div id="qrMsg" class="hint" style="margin:0">正在获取二维码…</div>
      <img id="qrImg" alt="二维码">
      <div id="qrError" class="msg" style="min-height:0;text-align:center"></div>
      <p class="section-note" style="text-align:center;margin:0">小程序会话可能读不到账号详情，建议 Android / iOS / 网页端。</p>
    </div>
    <div class="row-actions" style="justify-content:center">
      <button class="btn primary" id="qrRefresh">刷新二维码</button>
    </div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const VIEWS = ['dashboard', 'accounts', 'libraries', 'tasks', 'settings'];
let token = localStorage.getItem('sp_token') || '';

function hideSplash() {
  const el = $('bootSplash');
  if (el) el.classList.add('hide');
}

function showLogin() {
  hideSplash();
  $('auth').classList.remove('hide');
  $('app').classList.add('hide');
  $('loginPane').classList.remove('hide');
  $('setupPane').classList.add('hide');
}

function showSetup() {
  hideSplash();
  $('auth').classList.remove('hide');
  $('app').classList.add('hide');
  $('loginPane').classList.add('hide');
  $('setupPane').classList.remove('hide');
}

function showApp() {
  hideSplash();
  $('auth').classList.add('hide');
  $('app').classList.remove('hide');
}

function currentView() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  return VIEWS.indexOf(h) >= 0 ? h : 'dashboard';
}

function showView(name) {
  if (VIEWS.indexOf(name) < 0) name = 'dashboard';
  VIEWS.forEach((v) => {
    const el = $('view-' + v);
    if (el) el.classList.toggle('active', v === name);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.menu button'), (b) => {
    b.classList.toggle('active', b.getAttribute('data-view') === name);
  });
  history.replaceState(null, '', '#/' + name);
  if (name === 'settings') loadSettings();
  refreshAll();
}

function enterApp() {
  showApp();
  showView(currentView());
  loadSettings();
}

async function publicJSON(path, opts) {
  const res = await fetch(path, opts || {});
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}

async function api(path, opts) {
  const res = await fetch(path, {
    ...(opts || {}),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...((opts && opts.headers) || {})
    }
  });
  if (res.status === 401) {
    token = '';
    localStorage.removeItem('sp_token');
    showLogin();
    throw new Error('登录已过期，请重新登录');
  }
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
}

function parseProfile(a) {
  try { return JSON.parse((a && a.profile) || '{}'); } catch (e) { return {}; }
}

function renderAccountCard(a) {
  if (!a) return '<span class="muted">尚未登录 115</span>';
  const p = parseProfile(a);
  const name = p.name || a.nickname || a.name || '115 用户';
  const av = p.face
    ? '<img class="avatar" src="' + esc(p.face) + '" alt="">'
    : '<div class="avatar fallback">' + esc(name.slice(0, 1).toUpperCase()) + '</div>';
  const badges = ((p.privilege || p.vip) ? '<span class="badge vip">VIP' + (p.vip ? ' ' + p.vip : '') + '</span>' : '') +
    (a.device ? '<span class="badge">' + esc(a.device) + '</span>' : '');
  const expire = p.expire ? '到期 ' + new Date(p.expire * 1000).toLocaleDateString() : '';
  const quotaText = p.total ? fmtBytes(p.used) + ' / ' + fmtBytes(p.total) : '';
  const pct = p.total ? Math.min(100, Math.round(p.used / p.total * 100)) : 0;
  const hasDetail = !!(p.name || p.total || p.expire || p.vip);
  const sub = hasDetail
    ? ([quotaText, expire].filter(Boolean).join(' · ') || '已登录')
    : ('已登录' + (a.uid ? ' · UID ' + a.uid : '') + ' · 详情不可用（建议用 Android / iOS 重新登录）');
  return '<div class="account-card">' + av +
    '<div class="account-meta"><div class="account-name">' + esc(name) + badges + '</div>' +
    '<div class="quota-text">' + esc(sub) + '</div>' +
    (p.total ? '<div class="quota"><i style="width:' + pct + '%"></i></div>' : '') +
    '</div></div>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function boot() {
  try {
    const s = await publicJSON('/api/setup/status');
    if (!s.initialized) { showSetup(); return; }
  } catch (e) {}
  hideSplash();
  if (token) { enterApp(); } else { showLogin(); }
}

$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('setupMsg');
  msg.className = 'msg';
  msg.textContent = '';
  const username = $('setupUser').value.trim() || 'admin';
  const password = $('setupPass').value;
  const confirm = $('setupConfirm').value;
  if (password.length < 8) { msg.textContent = '密码至少 8 位'; return; }
  if (password !== confirm) { msg.textContent = '两次输入的密码不一致'; return; }
  try {
    const d = await publicJSON('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password, confirm: confirm })
    });
    token = d.token;
    localStorage.setItem('sp_token', token);
    $('setupPass').value = '';
    $('setupConfirm').value = '';
    enterApp();
  } catch (err) {
    msg.textContent = err.message;
  }
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('loginMsg');
  msg.className = 'msg';
  msg.textContent = '';
  try {
    const d = await publicJSON('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('loginUser').value.trim(), password: $('loginPass').value })
    });
    token = d.token;
    localStorage.setItem('sp_token', token);
    $('loginPass').value = '';
    enterApp();
  } catch (err) {
    if (err.message.indexOf('创建管理员') >= 0) { showSetup(); return; }
    msg.textContent = err.message;
  }
});

$('logout').onclick = async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  token = '';
  localStorage.removeItem('sp_token');
  showLogin();
};

Array.prototype.forEach.call(document.querySelectorAll('.menu button'), (b) => {
  b.addEventListener('click', () => showView(b.getAttribute('data-view')));
});
window.addEventListener('hashchange', () => showView(currentView()));

async function refreshAll() {
  try {
    const s = await api('/api/status');
    $('status').innerHTML =
      '<span><span class="dot ' + (s.emby ? '' : 'off') + '"></span>账号 <b>' + s.accounts + '</b> 个</span>' +
      '<span>媒体库 <b>' + s.libraries + '</b> 个</span>' +
      '<span>播放模式 <b>' + esc(s.playMode) + '</b></span>' +
      '<span>Emby ' + (s.emby ? '<b>已配置</b>' : '未配置') + '</span>';

    const accs = (await api('/api/accounts')) || [];
    const main = accs[0];
    $('accountCard').innerHTML = renderAccountCard(main);
    $('accList').innerHTML = main ? renderAccountCard(main) : '<div class="muted" style="font-size:13px">还没有账号，先扫码登录 115。</div>';
    const p = parseProfile(main);
    if (p.face) {
      $('sideAvatar').src = p.face;
      $('sideAvatar').classList.remove('hide');
    } else {
      $('sideAvatar').classList.add('hide');
    }

    const libs = (await api('/api/libraries')) || [];
    $('libs').innerHTML = libs.length
      ? libs.map((l) => '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.remoteCid) + '</td><td>' + esc(l.localDir) + '</td><td>' + esc(l.scanMode) + '</td><td><button class="btn ghost" onclick="scanLib(' + l.id + ')">扫描</button></td></tr>').join('')
      : '<tr><td colspan="5" class="muted">还没有媒体库</td></tr>';

    const tasks = (await api('/api/tasks')) || [];
    $('tasks').innerHTML = tasks.length
      ? tasks.map((t) => '<tr><td>' + t.id + '</td><td>' + esc(t.kind) + '</td><td>' + esc(t.status) + '</td><td>' + esc(t.message) + '</td></tr>').join('')
      : '<tr><td colspan="4" class="muted">暂无任务</td></tr>';
  } catch (e) {
    console.error(e);
  }
}

async function loadSettings() {
  try {
    const s = await api('/api/settings');
    $('publicBase').value = s.publicBase || '';
    $('embyBase').value = s.embyBase || '';
    $('embyApiKey').placeholder = s.embyApiKeySet ? '已设置（留空不修改）' : 'API Key';
    $('embyWebhookToken').placeholder = s.embyWebhookTokenSet ? '已设置（留空不修改）' : 'Webhook Token';
    $('embyDeleteRemote').checked = !!s.embyDeleteRemote;
    $('p115AppId').value = s.p115AppId || '';
    $('p115AppSecret').placeholder = s.p115AppSecretSet ? '已设置（留空不修改）' : 'App Secret';
    $('adminUser').value = s.adminUser || 'admin';
    $('who').textContent = s.adminUser || '';
  } catch (e) {}
}

$('saveSettings').onclick = async () => {
  const msg = $('setMsg');
  msg.className = 'msg inline';
  msg.textContent = '保存中…';
  try {
    if ($('adminPassword').value && $('adminPassword').value.length < 8) {
      throw new Error('新密码至少 8 位');
    }
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        publicBase: $('publicBase').value,
        embyBase: $('embyBase').value,
        embyApiKey: $('embyApiKey').value,
        embyWebhookToken: $('embyWebhookToken').value,
        embyDeleteRemote: $('embyDeleteRemote').checked,
        p115AppId: $('p115AppId').value,
        p115AppSecret: $('p115AppSecret').value,
        adminUser: $('adminUser').value,
        newPassword: $('adminPassword').value
      })
    });
    $('embyApiKey').value = '';
    $('embyWebhookToken').value = '';
    $('p115AppSecret').value = '';
    $('adminPassword').value = '';
    msg.className = 'msg inline ok';
    msg.textContent = '已保存';
    loadSettings();
    refreshAll();
  } catch (e) {
    msg.className = 'msg inline';
    msg.textContent = e.message;
  }
};

$('addLib').onclick = async () => {
  const msg = $('libMsg');
  msg.className = 'msg inline';
  msg.textContent = '';
  try {
    await api('/api/libraries', {
      method: 'POST',
      body: JSON.stringify({
        name: $('libName').value,
        remoteCid: $('libCid').value,
        localDir: $('libDir').value,
        baseUrl: $('libBase').value,
        strmFormat: $('libFmt').value,
        scanMode: $('libMode').value
      })
    });
    $('libName').value = '';
    $('libDir').value = '';
    refreshAll();
  } catch (e) {
    msg.textContent = e.message;
  }
};

window.scanLib = async (id) => {
  try {
    await api('/api/libraries/' + id + '/scan', { method: 'POST' });
    refreshAll();
  } catch (e) { alert(e.message); }
};

let qrTimer = null;
let qrBusy = false;

function closeQrModal() {
  if (qrTimer) { clearInterval(qrTimer); qrTimer = null; }
  $('qrModal').classList.add('hide');
  $('qrImg').removeAttribute('src');
  $('qrError').textContent = '';
  $('qrMsg').textContent = '正在获取二维码…';
}

function pollQr(url) {
  if (qrTimer) { clearInterval(qrTimer); }
  qrBusy = false;
  qrTimer = setInterval(async () => {
    if (qrBusy) return;
    qrBusy = true;
    try {
      const st = await api(url);
      if (st.status === 2) {
        closeQrModal();
        refreshAll();
      } else if (st.status === 1) {
        $('qrMsg').textContent = '已扫码，请在手机上确认';
      } else if (st.status === -1) {
        if ($('qrModal').classList.contains('hide')) return;
        clearInterval(qrTimer); qrTimer = null;
        $('qrMsg').textContent = '扫码会话已结束';
        $('qrError').textContent = '请点击「刷新二维码」重新获取';
      }
    } catch (e) {
      if ($('qrModal').classList.contains('hide')) return;
      if (e.message.indexOf('404') >= 0 || e.message.indexOf('会话') >= 0) {
        closeQrModal();
        refreshAll();
        return;
      }
      $('qrError').textContent = e.message;
    } finally {
      qrBusy = false;
    }
  }, 2000);
}

async function startQr() {
  $('qrModal').classList.remove('hide');
  $('qrError').textContent = '';
  $('qrMsg').textContent = '正在获取二维码…';
  try {
    const q = await api('/api/accounts/qrcode', { method: 'POST', body: JSON.stringify({ device: $('qrDevice').value }) });
    $('qrImg').src = '/api/accounts/qrcode/' + encodeURIComponent(q.uid) + '/image';
    $('qrMsg').textContent = '请用 115 App 扫码';
    pollQr('/api/accounts/qrcode/' + encodeURIComponent(q.uid));
  } catch (e) {
    $('qrMsg').textContent = '获取二维码失败';
    $('qrError').textContent = e.message;
  }
}

async function startOpenQr() {
  $('qrModal').classList.remove('hide');
  $('qrError').textContent = '';
  $('qrMsg').textContent = '正在获取授权二维码…';
  try {
    const q = await api('/api/accounts/open/start', { method: 'POST' });
    $('qrImg').src = '/api/qr?text=' + encodeURIComponent(q.content || '');
    $('qrMsg').textContent = '请用 115 App 扫码授权';
    pollQr('/api/accounts/open/' + encodeURIComponent(q.uid));
  } catch (e) {
    $('qrMsg').textContent = '获取二维码失败';
    $('qrError').textContent = e.message;
  }
}

$('qrLogin').onclick = startQr;
$('openLogin').onclick = startOpenQr;
$('qrRefresh').onclick = startQr;
$('qrDevice').addEventListener('change', () => {
  if (!$('qrModal').classList.contains('hide')) startQr();
});
$('qrClose').onclick = closeQrModal;
$('qrModal').addEventListener('click', (e) => { if (e.target === $('qrModal')) closeQrModal(); });

boot();
setInterval(() => { if (!$('app').classList.contains('hide')) refreshAll(); }, 5000);
</script>
</body>
</html>`
