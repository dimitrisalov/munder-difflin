'use strict';

// Mobile office panel — the pure half.
//
// A small web page the main process serves ONLY on the machine's Tailscale
// address, so the owner can see and steer the office from a phone without
// exposing anything to the LAN or the internet. This module holds every
// decision that does not need a socket: which address to bind, who may connect,
// the access-token check, the JSON the page reads, and the page itself.
// Plain CommonJS so test/panel-core.test.cjs can require() it directly.

const crypto = require('node:crypto');

/** Tailscale hands out IPv4 addresses from the CGNAT block 100.64.0.0/10. */
function isTailscaleIPv4(ip) {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return false;
  const a = Number(m[1]); const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}

function isLoopback(ip) {
  const a = String(ip || '').replace(/^::ffff:/, '');
  return a === '::1' || a.startsWith('127.');
}

/** Only the tailnet (and this machine) may talk to the panel. */
function peerAllowed(ip) {
  return isTailscaleIPv4(ip) || isLoopback(ip);
}

/**
 * The machine's Tailscale IPv4 from `os.networkInterfaces()`, or null.
 * @param {Record<string, Array<{ address: string, family: string|number, internal: boolean }>>} interfaces
 */
function pickTailscaleIPv4(interfaces) {
  for (const list of Object.values(interfaces || {})) {
    for (const i of list || []) {
      const v4 = i && (i.family === 'IPv4' || i.family === 4);
      if (v4 && !i.internal && isTailscaleIPv4(i.address)) return i.address;
    }
  }
  return null;
}

function newAccessToken(rand = crypto.randomBytes) {
  return rand(24).toString('base64url');
}

function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The value of one cookie from a Cookie header. */
function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const COOKIE = 'md_panel';

/**
 * Is this request authorised? The token may come as `?k=` (the link from
 * Settings, first visit) or as the cookie set after it.
 */
function authorised(url, cookieHeader, token) {
  let k;
  try { k = new URL(url, 'http://panel').searchParams.get('k') || undefined; } catch { k = undefined; }
  return tokenMatches(k, token) || tokenMatches(readCookie(cookieHeader, COOKIE), token);
}

function sessionCookie(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;
}

/** The newest unanswered, undismissed humanQA entry (renderer openQuestion). */
function openQuestion(task) {
  if (!task || !Array.isArray(task.humanQA)) return undefined;
  for (let i = task.humanQA.length - 1; i >= 0; i--) {
    const e = task.humanQA[i];
    if (e && typeof e.q === 'string' && !e.a && !e.dismissedAt) return e;
  }
  return undefined;
}

/**
 * Everything the page shows, as plain JSON. Never includes secrets, paths
 * beyond what agents already show on the board, or anything from config.
 */
function buildState({ registry, tasks, limits, now }) {
  const agents = Object.entries((registry && registry.agents) || {})
    .filter(([, a]) => a && !a.archived && !a.isAssistant)
    .map(([id, a]) => ({
      id,
      name: a.name || id,
      role: a.role || (registry.godId === id ? 'orchestrator' : ''),
      status: a.status || 'idle',
      isGod: registry.godId === id,
      onHold: !!a.onHold
    }))
    .sort((x, y) => (y.isGod ? 1 : 0) - (x.isGod ? 1 : 0) || x.name.localeCompare(y.name));

  const list = Array.isArray(tasks) ? tasks : [];
  const asks = list
    .filter((t) => t && t.status === 'blocked' && openQuestion(t))
    .map((t) => ({ taskId: t.id, title: t.title || t.id, q: openQuestion(t).q, askedAt: openQuestion(t).askedAt || null }));
  const order = { blocked: 0, doing: 1, todo: 2 };
  const open = list
    .filter((t) => t && order[t.status] !== undefined)
    .sort((a, b) => order[a.status] - order[b.status] || (a.priority || 0) - (b.priority || 0))
    .slice(0, 40)
    .map((t) => ({ id: t.id, title: t.title || t.id, status: t.status, assignee: t.assignee || null }));
  // A card with a reviewer is not a result until approved (taskFlow-core.cjs, wave 6).
  const done = list
    .filter((t) => t && t.status === 'done' && !(t.reviewer && !(t.review && t.review.state === 'approved')))
    .slice(-10)
    .reverse()
    .map((t) => ({ id: t.id, title: t.title || t.id, result: String(t.result || '').slice(0, 1500) }));

  return { agents, asks, open, done, limits: limits || null, updatedAt: now };
}

/** Validate a new-task or answer body from the page. */
function readTaskBody(body) {
  const text = body && typeof body.text === 'string' ? body.text.trim() : '';
  return text && text.length <= 8000 ? { text } : null;
}

function readAnswerBody(body) {
  const b = body || {};
  if (typeof b.taskId !== 'string' || !b.taskId || typeof b.q !== 'string' || typeof b.answer !== 'string') return null;
  const answer = b.answer.trim();
  return answer && answer.length <= 4000 ? { taskId: b.taskId, q: b.q, answer } : null;
}

/** The page: one self-contained HTML document, mobile-first, no external loads. */
const PAGE = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="color-scheme" content="light dark">
<title>Офис</title>
<style>
:root{--bg:#f6f4ee;--card:#fffdf7;--ink:#1d1c21;--muted:#6c6a73;--line:#e3dfd3;--accent:#2f6fe4;--warn:#c2410c;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#141318;--card:#1e1d24;--ink:#f1efe8;--muted:#a3a1aa;--line:#2f2e37;--accent:#7aa5ff;--warn:#fb923c;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,system-ui,sans-serif;padding:12px 16px calc(24px + env(safe-area-inset-bottom))}
h1{font-size:20px;margin:4px 0 12px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:20px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:8px}
.row{display:flex;gap:8px;align-items:center;justify-content:space-between}.muted{color:var(--muted);font-size:13px}
.pill{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);white-space:nowrap}
.working{color:var(--ok);border-color:var(--ok)}.blocked{color:var(--warn);border-color:var(--warn)}
textarea,input{width:100%;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px}
button{font:inherit;border:0;border-radius:8px;padding:8px 12px;background:var(--accent);color:#fff;margin-top:8px}
button.alt{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.q{white-space:pre-wrap}.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:4px}.bar>i{display:block;height:100%;background:var(--accent)}
.over>i{background:var(--warn)}#err{color:var(--warn)}details summary{cursor:pointer}
</style></head><body>
<div class="row"><h1>Офис</h1><span class="muted" id="upd"></span></div>
<div id="err"></div>
<div class="card"><textarea id="task" rows="3" placeholder="Новая задача для офиса…"></textarea><button id="send">Отправить</button></div>
<h2>Ждут тебя</h2><div id="asks"></div>
<h2>Агенты</h2><div id="agents"></div>
<h2>Задачи</h2><div id="open"></div>
<h2>Лимиты</h2><div id="limits"></div>
<h2>Готово</h2><div id="done"></div>
<script>
const $=(s)=>document.querySelector(s);const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const md=(s)=>esc(s).replace(/\\*\\*([^*\\n]+)\\*\\*/g,'<b>$1</b>').replace(/\`([^\`\\n]+)\`/g,'<code>$1</code>');
const fmt=(n)=>n>=1e6?(Math.round(n/1e5)/10)+' млн':n>=1e3?Math.round(n/1e3)+' тыс.':String(n|0);
const ST={idle:'свободен',working:'работает',blocked:'ждёт',gone:'нет на месте',todo:'к работе',doing:'в работе',done:'готово'};
const PER={'5h':'за 5 часов',day:'за сутки',week:'за неделю',month:'за 30 дней'};
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
function opts(q){return String(q).split('\\n').map((l)=>/^\\s*(\\d{1,2})[.)]\\s+(.+)$/.exec(l)).filter(Boolean).slice(0,8).map((m)=>m[1]+'. '+m[2].replace(/\\*\\*|\`/g,''));}
function render(s){
 $('#upd').textContent=new Date(s.updatedAt).toLocaleTimeString();
 $('#asks').innerHTML=s.asks.length?s.asks.map((a,i)=>{const o=opts(a.q);return '<div class="card"><div class="muted">'+esc(a.title)+'</div><div class="q">'+md(a.q)+'</div>'+
  (o.length>1?o.map((x)=>'<button class="alt" data-a="'+i+'" data-v="'+esc(x)+'">'+esc(x)+'</button> ').join(''):'')+
  '<textarea rows="2" id="ans'+i+'" placeholder="Свой ответ…"></textarea><button data-a="'+i+'">Ответить</button></div>';}).join(''):'<div class="muted">Вопросов нет.</div>';
 window.__asks=s.asks;
 $('#agents').innerHTML=s.agents.map((a)=>'<div class="card row"><div><b>'+esc(a.name)+'</b><div class="muted">'+esc(a.isGod?'оркестратор':a.role)+'</div></div><span class="pill '+esc(a.status)+'">'+esc(ST[a.status]||a.status)+(a.onHold?' ⏸':'')+'</span></div>').join('')||'<div class="muted">Агентов нет.</div>';
 $('#open').innerHTML=s.open.map((t)=>'<div class="card row"><div>'+esc(t.title)+(t.assignee?'<div class="muted">→ '+esc(t.assignee)+'</div>':'')+'</div><span class="pill '+esc(t.status)+'">'+esc(ST[t.status]||t.status)+'</span></div>').join('')||'<div class="muted">Открытых задач нет.</div>';
 const L=s.limits;$('#limits').innerHTML=L?['5h','day','week','month'].map((p)=>{const used=L.usage?.[p]?.floor?.work||0;const lim=L.config?.office?.[p];const pct=lim?Math.min(100,Math.floor(used/lim*100)):0;
  return '<div class="card"><div class="row"><span>'+PER[p]+'</span><span class="muted">'+fmt(used)+(lim?' из '+fmt(lim):'')+'</span></div>'+(lim?'<div class="bar'+(used>=lim?' over':'')+'"><i style="width:'+pct+'%"></i></div>':'')+'</div>';}).join(''):'';
 $('#done').innerHTML=s.done.map((t)=>'<details class="card"><summary>'+esc(t.title)+'</summary><div class="q muted">'+esc(t.result||'—')+'</div></details>').join('')||'<div class="muted">Пока пусто.</div>';
}
async function load(){try{render(await api('/api/state'));$('#err').textContent='';}catch(e){$('#err').textContent='Нет связи с офисом: '+e.message;}}
document.addEventListener('click',async(e)=>{const b=e.target.closest('button');if(!b)return;
 if(b.id==='send'){const text=$('#task').value.trim();if(!text)return;b.disabled=true;try{await api('/api/task',{text});$('#task').value='';await load();}catch(x){alert(x.message);}b.disabled=false;return;}
 if(b.dataset.a!==undefined){const a=window.__asks[+b.dataset.a];const answer=b.dataset.v||$('#ans'+b.dataset.a).value.trim();if(!a||!answer)return;b.disabled=true;
  try{await api('/api/answer',{taskId:a.taskId,q:a.q,answer});await load();}catch(x){alert(x.message);}b.disabled=false;}});
load();setInterval(load,15000);
</script></body></html>`;

module.exports = {
  isTailscaleIPv4,
  isLoopback,
  peerAllowed,
  pickTailscaleIPv4,
  newAccessToken,
  tokenMatches,
  readCookie,
  authorised,
  sessionCookie,
  openQuestion,
  buildState,
  readTaskBody,
  readAnswerBody,
  PAGE,
  COOKIE
};
