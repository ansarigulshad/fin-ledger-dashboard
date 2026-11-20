/* Family Ledger — multi-account Zerodha Kite dashboard (vanilla JS) */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const state = {
  config: {}, overview: null, selected: localStorage.getItem("fl.sel") || "all",
  section: "holdings", sort: { key: "current", dir: -1 }, q: "",
  loading: false, auto: localStorage.getItem("fl.auto") !== "0", expanded: new Set(), timer: null,
  watch: null, watchSort: { key: "dayPct", dir: -1 }, sugg: [], suggIdx: -1, indices: null, caps: null, capFilter: null, accFilter: null, privacy: localStorage.getItem("fl.privacy") === "1", hist: {}, histOverview: null, histView: "capital",
};

/* ------------------------------------------------------------ formatting */
const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrRaw = (n, d = 0) => (n < 0 ? "−" : "") + "₹" + (d ? nf2 : nf0).format(Math.abs(n || 0));
const sinrRaw = (n, d = 0) => (n > 0 ? "+" : n < 0 ? "−" : "") + "₹" + (d ? nf2 : nf0).format(Math.abs(n || 0));
const amt = (s) => `<span class="amt">${s}</span>`;
const inr = (n, d = 0) => amt(inrRaw(n, d));
const inrTip = (n, d = 0) => "<span class='amt'>" + inrRaw(n, d) + "</span>";   // for use inside data-tip="..." attributes
const sinrTip = (n, d = 0) => "<span class='amt'>" + sinrRaw(n, d) + "</span>";
const sinr = (n, d = 0) => amt(sinrRaw(n, d));
const pct = (n, s = true) => (s && n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n || 0).toFixed(2) + "%";
const num = (n, d = 2) => (d ? nf2 : nf0).format(n || 0);
const cls = (n) => n > 0.004 ? "up" : n < -0.004 ? "down" : "flat";
const arrow = (n) => n > 0.004 ? "▲" : n < -0.004 ? "▼" : "•";
const short = (n) => { const a = Math.abs(n); return amt(a >= 1e7 ? (n/1e7).toFixed(2) + " Cr" : a >= 1e5 ? (n/1e5).toFixed(2) + " L" : nf0.format(n)); };
const timeAgo = (ts) => { const s = Math.max(0, (Date.now()/1000 - ts)|0); return s < 5 ? "just now" : s < 60 ? s + "s ago" : s < 3600 ? (s/60|0) + "m ago" : (s/3600|0) + "h ago"; };
const initials = (name) => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const colorVar = (c) => `var(--s${c || 1})`;

const ICON = {
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M15 7l3 3M18 4l2 2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-6 4 4 5-8"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.6 2 12 2 12s3.5 7 10 7c1.6 0 3-.3 4.3-.9"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
};

/* ------------------------------------------------------------ data shaping */
const hQty = (h) => (h.quantity || 0) + (h.t1_quantity || 0) + (h.collateral_quantity || 0);

function summarize(snap) {
  const s = { invested: 0, current: 0, pnl: 0, dayPnl: 0, prevClose: 0, cash: 0, holdings: 0, positions: 0, posPnl: 0, mfInv: 0, mfCur: 0, orders: 0, openOrders: 0 };
  if (!snap || snap.error) return s;
  for (const h of snap.holdings || []) {
    const q = hQty(h); if (!q) continue;
    s.holdings++;
    s.invested += q * h.average_price; s.current += q * h.last_price;
    s.dayPnl += q * (h.last_price - h.close_price); s.prevClose += q * h.close_price;
  }
  s.pnl = s.current - s.invested;
  for (const p of snap.positions?.net || []) { s.positions++; s.posPnl += p.pnl || 0; }
  for (const m of snap.mf || []) { s.mfInv += (m.quantity || 0) * (m.average_price || 0); s.mfCur += (m.quantity || 0) * (m.last_price || 0); }
  const eq = snap.margins?.equity || {};
  s.cash = eq.available?.live_balance ?? eq.net ?? eq.available?.cash ?? 0;
  s.orders = (snap.orders || []).length;
  s.openOrders = (snap.orders || []).filter(o => /OPEN|TRIGGER PENDING|PENDING/.test(o.status)).length;
  s.pnlPct = s.invested ? s.pnl / s.invested * 100 : 0;
  s.dayPct = s.prevClose ? s.dayPnl / s.prevClose * 100 : 0;
  return s;
}

const accounts = () => state.overview?.accounts || [];
const liveAccounts = () => accounts().filter(a => a.snapshot && !a.snapshot.error);
const selectedAccounts = () => state.selected === "all" ? accounts() : accounts().filter(a => a.id === state.selected);
const accById = (id) => accounts().find(a => a.id === id);

function totals(list) {
  const t = summarize(null);
  for (const a of list) { const s = summarize(a.snapshot); for (const k in t) t[k] += s[k]; }
  t.pnlPct = t.invested ? t.pnl / t.invested * 100 : 0;
  t.dayPct = t.prevClose ? t.dayPnl / t.prevClose * 100 : 0;
  return t;
}

/* rows for holdings table: single account => raw holdings; all => grouped by symbol */
function holdingRows(list) {
  const groups = new Map();
  for (const a of list) {
    if (!a.snapshot || a.snapshot.error) continue;
    for (const h of a.snapshot.holdings || []) {
      const q = hQty(h); if (!q) continue;
      const key = h.tradingsymbol;
      const g = groups.get(key) || { symbol: h.tradingsymbol, exchange: h.exchange, token: h.instrument_token, isin: h.isin, qty: 0, invested: 0, current: 0, ltp: h.last_price, close: h.close_price, t1: 0, parts: [] };
      g.qty += q; g.invested += q * h.average_price; g.current += q * h.last_price; g.t1 += h.t1_quantity || 0;
      g.ltp = h.last_price; g.close = h.close_price;
      g.parts.push({ acc: a, qty: q, avg: h.average_price, invested: q * h.average_price, current: q * h.last_price, pnl: q * (h.last_price - h.average_price), day: q * (h.last_price - h.close_price), t1: h.t1_quantity || 0 });
      groups.set(key, g);
    }
  }
  return [...groups.values()].map(g => ({
    ...g, avg: g.invested / g.qty, pnl: g.current - g.invested, pnlPct: g.invested ? (g.current - g.invested) / g.invested * 100 : 0,
    day: g.qty * (g.ltp - g.close), dayPct: g.close ? (g.ltp - g.close) / g.close * 100 : 0,
  }));
}

/* ------------------------------------------------------------ rendering: rail */
function renderRail() {
  const accs = accounts();
  const all = totals(accs);
  const live = liveAccounts().length;
  const html = [];
  const collapsed = document.documentElement.dataset.rail === "collapsed";
  html.push(collapsed
    ? `<div class="brand brand-mini"><button class="rail-toggle" data-act="rail" title="Expand sidebar  ( [ )">${ICON.chevR}</button></div>`
    : `<div class="brand"><h1>Family <em>Ledger</em></h1><button class="rail-toggle" data-act="rail" title="Collapse sidebar  ( [ )">${ICON.chevL}</button></div>`);
  html.push(`<button class="acct ${state.selected === "all" ? "active" : ""}" data-sel="all" title="All accounts · ${live ? (state.privacy ? "hidden" : inrRaw(all.current) + " · " + sinrRaw(all.dayPnl) + " today") : "no accounts live"}  (0)">
    <span class="avatar all">Σ</span>
    <span><div class="name">All accounts</div><div class="sub">${live} of ${accs.length} live</div></span>
    <span class="val"><div class="v num">${live ? inr(all.current) : "—"}</div><div class="d num ${cls(all.dayPnl)}">${live ? arrow(all.dayPnl) + " " + sinr(all.dayPnl) : ""}</div></span></button>`);
  html.push(`<div class="rail-label">Accounts</div>`);
  accs.forEach((a, i) => {
    const s = summarize(a.snapshot);
    const ok = a.snapshot && !a.snapshot.error;
    html.push(`<button class="acct ${state.selected === a.id ? "active" : ""}" data-sel="${a.id}" title="${esc(a.name)} · ${ok ? (state.privacy ? "hidden" : inrRaw(s.current) + " · " + sinrRaw(s.dayPnl) + " today") : "needs login"}  (${i + 1})">
      <span class="avatar" style="--c:${colorVar(a.color)}">${esc(initials(a.name))}</span>
      <span><div class="name">${esc(a.name)}</div><div class="sub">${esc(a.user_id)}</div></span>
      ${ok ? `<span class="val"><div class="v num">${inr(s.current)}</div><div class="d num ${cls(s.dayPnl)}">${arrow(s.dayPnl)} ${sinr(s.dayPnl)}</div></span>`
           : `<span class="lock">${ICON.lock}${a.logged_in ? "error" : "login"}</span>`}
    </button>`);
  });
  const needLoginCount = accs.filter(a => !a.snapshot || a.snapshot.error === "not_logged_in" || a.snapshot.error === "session_expired").length;
  html.push(`<div class="rail-foot"><div class="menu">
    <button class="rail-btn menu-btn" data-act="menu" title="Settings & actions">${ICON.gear} <span class="lbl">Settings</span>${needLoginCount ? `<span class="badge" title="${needLoginCount} account(s) need login">${needLoginCount}</span>` : ""}</button>
    <div class="menu-pop">
      ${state.config.demo ? "" : `<button class="rail-btn" data-act="add">${ICON.plus} Add account</button>`}
      <button class="rail-btn" data-act="loginall">${ICON.key} Login all ${needLoginCount ? `<span class="badge">${needLoginCount}</span>` : ""}<span class="kbd">L</span></button>
      <button class="rail-btn" data-act="refresh">${ICON.refresh} Refresh <span class="kbd">R</span></button>
      <button class="rail-btn" data-act="auto">${state.auto ? "◉" : "○"}&nbsp; Auto-refresh ${state.auto ? "on" : "off"}</button>
      <button class="rail-btn" data-act="theme">${document.documentElement.dataset.theme === "light" ? ICON.moon : ICON.sun} ${document.documentElement.dataset.theme === "light" ? "Dark" : "Light"} theme</button>
      <button class="rail-btn" data-act="rail">${collapsed ? ICON.chevR : ICON.chevL} ${collapsed ? "Expand" : "Collapse"} sidebar <span class="kbd">[</span></button>
      <div class="menu-sep"></div>
      <button class="rail-btn" data-act="stop" title="Stop the local server">${ICON.power} Stop server</button>
    </div></div></div>`);
  $("#rail").innerHTML = html.join("");
}

/* ------------------------------------------------------------ rendering: main */
function renderMain() {
  const main = $("#main");
  const accs = accounts();
  if (!state.overview) { main.innerHTML = `<div class="empty"><div class="skel" style="width:200px;margin:80px auto"></div></div>`; return; }
  if (!accs.length) { main.innerHTML = onboardHTML(); return; }
  if (state.selected !== "all" && !accById(state.selected)) state.selected = "all";
  const list = selectedAccounts();
  const isAll = state.selected === "all";
  const acc = isAll ? null : list[0];
  const t = totals(list);
  const live = list.filter(a => a.snapshot && !a.snapshot.error);
  const needLogin = list.filter(a => !a.snapshot || a.snapshot.error === "not_logged_in" || a.snapshot.error === "session_expired");
  const errored = list.filter(a => a.snapshot?.error && !needLogin.includes(a));

  const parts = [];
  // top bar
  const fetched = Math.max(0, ...live.map(a => a.snapshot.fetched_at || 0));
  parts.push(`<div class="topbar"><div>
      <h2>${acc ? `<span class="dot" style="--c:${colorVar(acc.color)}"></span>${esc(acc.name)}` : "All accounts"}</h2>
      <div class="meta">
        ${acc ? `<span class="num">${esc(acc.user_id)}</span>${acc.snapshot?.profile?.user_name ? `<span>${esc(acc.snapshot.profile.user_name)}</span>` : ""}` : `<span>${live.length} of ${list.length} accounts live</span>`}
        ${fetched ? `<span class="live"><i></i>updated ${timeAgo(fetched)}</span>` : ""}
      </div></div>
    <div class="actions">
      ${acc ? (acc.browser_profile && !state.config.demo
          ? `<button class="btn ghost" data-act="openkite" data-id="${acc.id}" title="Opens kite.zerodha.com in ${esc(acc.name)}’s browser profile">${ICON.ext} Open Kite</button>`
          : `<a class="btn ghost" href="https://kite.zerodha.com/" target="_blank" rel="noopener" title="Open kite.zerodha.com in a new tab">${ICON.ext} Open Kite</a>`) : ""}
      ${acc && !state.config.demo ? `<button class="btn ghost" data-act="edit" data-id="${acc.id}">${ICON.edit} Edit</button>` : ""}
      ${acc && acc.logged_in && !state.config.demo ? `<button class="btn ghost" data-act="logout" data-id="${acc.id}">${ICON.out} Logout</button>` : ""}
      ${needLogin.length ? `<button class="btn primary" data-act="login" data-ids="${needLogin.map(a => a.id).join(",")}">${ICON.key} Login ${isAll ? `(${needLogin.length})` : ""}</button>` : ""}
      <button class="btn ghost ${state.privacy ? "on" : ""}" data-act="privacy" title="${state.privacy ? "Show amounts" : "Hide amounts (for public places)"}  (H)">${state.privacy ? ICON.eyeOff : ICON.eye} ${state.privacy ? "Hidden" : "Hide"}</button>
      <button class="btn" data-act="refresh" ${state.loading ? "disabled" : ""}><span class="${state.loading ? "spin" : ""}" style="display:inline-flex">${ICON.refresh}</span> Refresh</button>
    </div></div>`);

  // banners
  for (const a of needLogin) parts.push(`<div class="banner"><div class="ic">${ICON.lock}</div><div><b>${esc(a.name)} needs a login</b><span>${a.snapshot?.error === "session_expired" ? "Kite session expired (they reset every morning)." : "No active Kite session for this account yet."}</span></div><button class="btn primary" data-act="login" data-ids="${a.id}">Login</button></div>`);
  for (const a of errored) parts.push(`<div class="banner warn"><div class="ic">${ICON.warn}</div><div><b>${esc(a.name)}: couldn’t fetch data</b><span>${esc(a.snapshot.message || a.snapshot.error)}</span></div><button class="btn" data-act="refresh">Retry</button></div>`);

  if (live.length) parts.push(statsHTML(t, live.length));
  // tabs always show: Watchlist and Indices work without any Kite login
  parts.push(tabsHTML(t));
  parts.push(sectionHTML(list, live, t, isAll));
  main.innerHTML = parts.join("");
  const si = $("#q"); if (si) { si.value = state.q; }
  if (state.section === "screener") mountScreener();
}

function statsHTML(t, n) {
  const tile = (i, k, v, s, hero = false) => `<div class="tile ${hero ? "hero" : ""}" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="stats">
    ${tile(0, "Current value", inr(t.current), `<span class="muted">${t.holdings} holdings${n > 1 ? ` · ${n} accounts` : ""}</span>${t.mfCur ? `<span class="muted">+ ${inr(t.mfCur)} in MF</span>` : ""}`, true)}
    ${tile(1, "Invested", inr(t.invested), `<span class="muted">cost basis</span>`)}
    ${tile(2, "Overall P&amp;L", `<span class="${cls(t.pnl)}">${sinr(t.pnl)}</span>`, `<span class="pill ${cls(t.pnl)}">${arrow(t.pnl)} ${pct(t.pnlPct)}</span>`)}
    ${tile(3, "Today", `<span class="${cls(t.dayPnl)}">${sinr(t.dayPnl)}</span>`, `<span class="pill ${cls(t.dayPnl)}">${arrow(t.dayPnl)} ${pct(t.dayPct)}</span>${t.posPnl ? `<span class="muted">positions ${sinr(t.posPnl)}</span>` : ""}`)}
    ${tile(4, "Available cash", inr(t.cash), `<span class="muted">${t.openOrders ? `${t.openOrders} open order${t.openOrders > 1 ? "s" : ""}` : "equity segment"}</span>`)}
  </div>`;
}

function tabsHTML(t) {
  const tabs = [["holdings", "Holdings", t.holdings], ["positions", "Positions", t.positions], ["orders", "Orders", t.orders], ["mf", "Mutual funds", null], ["funds", "Funds", null], ["watch", "Watchlist", state.watch?.items.length || null], ["indices", "Indices", null], ["screener", "Screener", null], ["history", "History", null]];
  return `<div class="tabs">${tabs.map(([k, l, n]) => `<button class="tab ${state.section === k ? "active" : ""}" data-sec="${k}">${l}${n ? `<span class="n">${n}</span>` : ""}</button>`).join("")}</div>`;
}

function sectionHTML(list, live, t, isAll) {
  switch (state.section) {
    case "holdings": return holdingsHTML(live, t, isAll);
    case "positions": return positionsHTML(live, isAll);
    case "orders": return ordersHTML(live, isAll);
    case "mf": return mfHTML(live, isAll);
    case "funds": return fundsHTML(live, isAll);
    case "watch": return watchHTML(list, isAll);
    case "indices": return indicesHTML();
    case "screener": return screenerHTML();
    case "history": return historyHTML(list, isAll);
  }
  return "";
}

/* ---- holdings */
const COLS = [["symbol", "Instrument"], ["qty", "Qty"], ["avg", "Avg"], ["ltp", "LTP"], ["invested", "Invested"], ["current", "Current"], ["pnl", "P&L"], ["day", "Day"]];
function sortRows(rows) {
  const { key, dir } = state.sort;
  return rows.sort((a, b) => key === "symbol" ? dir * a.symbol.localeCompare(b.symbol) : dir * ((a[key] || 0) - (b[key] || 0)));
}
function holdingsHTML(live, t, isAll) {
  const baseRows = holdingRows(live);
  let rows = baseRows;
  const q = state.q.trim().toUpperCase();
  if (q) rows = rows.filter(r => r.symbol.includes(q) || r.parts.some(p => p.acc.name.toUpperCase().includes(q)));
  if (state.capFilter) rows = rows.filter(r => capOf(r) === state.capFilter);
  if (state.accFilter) rows = rows.filter(r => r.parts.some(p => p.acc.id === state.accFilter));
  const capLabel = state.capFilter ? (state.capFilter === "ETF" ? "ETF / index" : state.capFilter === "Other" ? "Beyond top 750" : state.capFilter + " cap") : null;
  const accLabel = state.accFilter ? accById(state.accFilter)?.name : null;
  const filterChips = [capLabel && `<button class="fchip" data-clear="cap">${esc(capLabel)} ✕</button>`, accLabel && `<button class="fchip" data-clear="acc">${esc(accLabel)} ✕</button>`].filter(Boolean).join("");
  sortRows(rows);
  const ft = rows.reduce((s, r) => ({ invested: s.invested + r.invested, current: s.current + r.current, pnl: s.pnl + r.pnl, day: s.day + r.day }), { invested: 0, current: 0, pnl: 0, day: 0 });
  const th = COLS.map(([k, l]) => `<th class="sortable ${state.sort.key === k ? "sorted" : ""}" data-sort="${k}">${l} <span class="arr">${state.sort.key === k ? (state.sort.dir < 0 ? "↓" : "↑") : ""}</span></th>`).join("");
  const body = rows.map(r => {
    const open = state.expanded.has(r.symbol);
    const main = `<tr class="${isAll ? "exp" : ""}" data-sym="${esc(r.symbol)}">
      <td><div class="sym">${esc(r.symbol)} <span class="ex">${esc(r.exchange)}</span>${state.caps ? `<span class="ex cap-${capOf(r)}" title="Market-cap bucket (NSE index lists)">${capOf(r) === "Other" ? "750+" : capOf(r)}</span>` : ""}<button class="star ${isWatched(r.symbol) ? "on" : ""}" data-watch="${esc(r.symbol)}" title="${isWatched(r.symbol) ? "Remove from" : "Add to"} watchlist">${isWatched(r.symbol) ? "★" : "☆"}</button><button class="star" data-chart="${esc(r.exchange)}/${esc(r.symbol)}" title="Chart">${ICON.chart}</button>${r.t1 ? `<span class="t1" title="T1 (unsettled) quantity">T1·${r.t1}</span>` : ""}
        ${isAll ? `<span class="holders">${r.parts.map(p => `<i style="--c:${colorVar(p.acc.color)}" title="${esc(p.acc.name)}: ${p.qty}">${esc(initials(p.acc.name)[0])}</i>`).join("")}</span>` : ""}</div>
        <div class="bar-mini" style="width:96px"><i style="width:${Math.min(100, r.current / t.current * 100)}%"></i></div></td>
      <td class="num"><span class="amt">${num(r.qty, 0)}</span></td>
      <td class="num">${num(r.avg)}</td>
      <td class="num cell2">${num(r.ltp)}<small class="${cls(r.dayPct)}">${pct(r.dayPct)}</small></td>
      <td class="num">${inr(r.invested)}</td>
      <td class="num cell2">${inr(r.current)}<small>${(r.current / t.current * 100).toFixed(1)}% wt</small></td>
      <td class="num cell2 ${cls(r.pnl)}">${sinr(r.pnl)}<small>${pct(r.pnlPct)}</small></td>
      <td class="num cell2 ${cls(r.day)}">${sinr(r.day)}<small>${arrow(r.day)} ${pct(r.dayPct)}</small></td></tr>`;
    const subs = open ? r.parts.map(p => `<tr class="sub"><td><span class="sym"><span class="holders"><i style="--c:${colorVar(p.acc.color)}">${esc(initials(p.acc.name)[0])}</i></span>${esc(p.acc.name)}</span></td>
      <td class="num"><span class="amt">${num(p.qty, 0)}</span></td><td class="num">${num(p.avg)}</td><td class="num">${num(r.ltp)}</td><td class="num">${inr(p.invested)}</td><td class="num">${inr(p.current)}</td>
      <td class="num ${cls(p.pnl)}">${sinr(p.pnl)}</td><td class="num ${cls(p.day)}">${sinr(p.day)}</td></tr>`).join("") : "";
    return main + subs;
  }).join("");
  const table = `<div class="card" style="--i:1"><div class="card-h"><h3>Holdings <span class="muted">${rows.length}${rows.length !== baseRows.length ? ` of ${baseRows.length}` : ""}</span> ${filterChips}</h3>
      <label class="search">${ICON.search}<input id="q" placeholder="Filter symbol${isAll ? " or person" : ""}…  ( / )" value="${esc(state.q)}"></label></div>
    <div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="8" class="empty">No holdings${q ? " match “" + esc(state.q) + "”" : ""}.</td></tr>`}</tbody>
    <tfoot><tr><td>${rows.length !== baseRows.length ? "Filtered total" : "Total"}</td><td></td><td></td><td></td><td class="num">${inr(ft.invested)}</td><td class="num">${inr(ft.current)}</td><td class="num ${cls(ft.pnl)}">${sinr(ft.pnl)}</td><td class="num ${cls(ft.day)}">${sinr(ft.day)}</td></tr></tfoot></table></div></div>`;

  const side = isAll ? [accountDonutHTML(live), capDonutHTML(baseRows, t), topHoldingsHTML(rows, t)] : [holdingDonutHTML(baseRows, t), capDonutHTML(baseRows, t), moversHTML(rows)];
  return `<div class="grid">${table}<div class="side" style="display:flex;flex-direction:column;gap:16px">${side.join("")}</div></div>`;
}

/* ---- charts */
function donutSVG(items, centerV, centerK) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const R = 62, r = 44, cx = 75, cy = 75; let a0 = -Math.PI / 2;
  const paths = items.map((it, idx) => {
    const a1 = a0 + it.value / total * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    const d = items.length === 1 ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - .01} ${cy - R} L ${cx - .01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`
      : `M ${x0} ${y0} A ${R} ${R} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${big} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${it.color}" stroke="var(--surface)" stroke-width="2" data-i="${idx}"/>`;
  }).join("");
  return `<svg class="donut" viewBox="0 0 150 150">${paths}<text class="center" x="75" y="73" text-anchor="middle">${centerV.replace(/<span class="amt">(.*?)<\/span>/, '<tspan class="amt">$1</tspan>')}</text><text class="center-k" x="75" y="88" text-anchor="middle">${centerK}</text></svg>`;
}
function donutCard(title, items, centerV, centerK, note, kind = "", active = null) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const legend = items.map((it, i) => `<div class="row ${active != null && it.key === active ? "sel" : ""}" data-i="${i}" style="--c:${it.color}" title="Click to filter the table"><i></i><span class="l">${esc(it.label)}</span><span class="p">${(it.value / total * 100).toFixed(1)}%</span></div>`).join("");
  return `<div class="card chart" style="--i:2" data-kind="${kind}" data-items='${esc(JSON.stringify(items.map(i => ({ l: i.label, v: i.value, k: i.key ?? i.label }))))}'><div class="card-h"><h3>${title}</h3>${note ? `<span class="muted">${note}</span>` : ""}</div>
    <div class="donut-wrap">${donutSVG(items, centerV, centerK)}<div class="legend">${legend}</div></div></div>`;
}
function accountDonutHTML(live) {
  const items = live.map(a => ({ label: a.name, key: a.id, value: summarize(a.snapshot).current, color: colorVar(a.color) })).filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  return donutCard("By account", items, short(items.reduce((s, i) => s + i.value, 0)), "TOTAL", "share of family value", "acc", state.accFilter);
}
function holdingDonutHTML(rows, t) {
  const sorted = [...rows].sort((a, b) => b.current - a.current);
  const top = sorted.slice(0, 7).map((r, i) => ({ label: r.symbol, key: r.symbol, value: r.current, color: colorVar(i + 1) }));
  const rest = sorted.slice(7).reduce((s, r) => s + r.current, 0);
  if (rest > 0) top.push({ label: `Other (${sorted.length - 7})`, key: "", value: rest, color: "var(--ink-3)" });
  return donutCard("Allocation", top, short(t.current), "VALUE", `${rows.length} holdings`, "sym");
}
function topHoldingsHTML(rows, t) {
  const top = [...rows].sort((a, b) => b.current - a.current).slice(0, 10);
  const max = top[0]?.current || 1;
  const bars = top.map(r => `<div class="hbar"><span class="l">${esc(r.symbol)}</span><div class="track" style="width:${r.current / max * 100}%">
      ${r.parts.sort((a, b) => b.current - a.current).map(p => `<i style="--c:${colorVar(p.acc.color)};flex:${p.current}" data-tip="<b>${esc(p.acc.name)} · ${esc(r.symbol)}</b><span class='num'>${inrTip(p.current)} · <span class='amt'>${p.qty}</span> qty</span>"></i>`).join("")}
    </div><span class="v num">${inr(r.current)}</span></div>`).join("");
  return `<div class="card" style="--i:3"><div class="card-h"><h3>Top holdings</h3><span class="muted">stacked by account</span></div><div class="hbars">${bars || `<div class="empty">No holdings</div>`}</div></div>`;
}
function moversHTML(rows) {
  const by = [...rows].filter(r => r.day).sort((a, b) => b.dayPct - a.dayPct);
  const up = by.slice(0, 4), down = by.slice(-4).reverse().filter(r => !up.includes(r));
  const row = (r) => `<div class="mover"><span class="s">${esc(r.symbol)}<small>${num(r.ltp)}</small></span><span class="num ${cls(r.day)}">${arrow(r.day)} ${pct(r.dayPct)} <span class="muted">${sinr(r.day)}</span></span></div>`;
  return `<div class="card" style="--i:3"><div class="card-h"><h3>Today’s movers</h3></div><div class="movers">${[...up, ...down].map(row).join("") || `<div class="empty">Market data not moving yet</div>`}</div></div>`;
}

/* ---- positions / orders / mf / funds */
const accCell = (a) => `<td><span class="sym"><span class="holders"><i style="--c:${colorVar(a.color)}">${esc(initials(a.name)[0])}</i></span>${esc(a.name)}</span></td>`;
function positionsHTML(live, isAll) {
  const rows = [];
  for (const a of live) for (const p of a.snapshot.positions?.net || []) rows.push({ a, p });
  rows.sort((x, y) => Math.abs(y.p.pnl) - Math.abs(x.p.pnl));
  const body = rows.map(({ a, p }) => `<tr>${isAll ? accCell(a) : ""}<td><span class="sym">${esc(p.tradingsymbol)} <span class="ex">${esc(p.exchange)}</span></span></td>
    <td><span class="chip">${esc(p.product)}</span></td><td class="num ${p.quantity < 0 ? "down" : ""}">${p.quantity}</td><td class="num">${num(p.average_price)}</td><td class="num">${num(p.last_price)}</td>
    <td class="num ${cls(p.pnl)}">${sinr(p.pnl, 2)}</td></tr>`).join("");
  const tot = rows.reduce((s, r) => s + (r.p.pnl || 0), 0);
  return `<div class="card" style="--i:1"><div class="card-h"><h3>Positions <span class="muted">${rows.length}</span></h3><span class="pill ${cls(tot)}">${arrow(tot)} ${sinr(tot, 2)}</span></div>
    <div class="tbl-wrap"><table><thead><tr>${isAll ? "<th>Account</th>" : ""}<th>Instrument</th><th>Product</th><th>Qty</th><th>Avg</th><th>LTP</th><th>P&amp;L</th></tr></thead>
    <tbody>${body || `<tr><td colspan="7" class="empty"><b>No open positions</b></td></tr>`}</tbody></table></div></div>`;
}
function ordersHTML(live, isAll) {
  const rows = [];
  for (const a of live) for (const o of a.snapshot.orders || []) rows.push({ a, o });
  rows.sort((x, y) => String(y.o.order_timestamp).localeCompare(String(x.o.order_timestamp)));
  const sc = (s) => s === "COMPLETE" ? "ok" : /REJECT|CANCEL/.test(s) ? "bad" : "open";
  const body = rows.map(({ a, o }) => `<tr>${isAll ? accCell(a) : ""}<td class="num muted">${esc(String(o.order_timestamp || "").slice(11, 19))}</td>
    <td><span class="sym">${esc(o.tradingsymbol)} <span class="ex">${esc(o.exchange)}</span></span></td>
    <td><span class="chip ${o.transaction_type === "BUY" ? "buy" : "sell"}">${esc(o.transaction_type)}</span></td>
    <td class="num">${o.filled_quantity || 0}/${o.quantity}</td><td class="num">${num(o.average_price || o.price || 0)}</td>
    <td><span class="chip">${esc(o.product)} · ${esc(o.order_type)}</span></td>
    <td><span class="chip ${sc(o.status)}" title="${esc(o.status_message || "")}">${esc(o.status)}</span></td></tr>`).join("");
  return `<div class="card" style="--i:1"><div class="card-h"><h3>Today’s orders <span class="muted">${rows.length}</span></h3></div>
    <div class="tbl-wrap"><table><thead><tr>${isAll ? "<th>Account</th>" : ""}<th>Time</th><th>Instrument</th><th>Side</th><th>Filled</th><th>Price</th><th>Type</th><th>Status</th></tr></thead>
    <tbody>${body || `<tr><td colspan="8" class="empty"><b>No orders today</b></td></tr>`}</tbody></table></div></div>`;
}
function mfHTML(live, isAll) {
  const rows = [];
  for (const a of live) for (const m of a.snapshot.mf || []) rows.push({ a, m, cur: (m.quantity || 0) * (m.last_price || 0), inv: (m.quantity || 0) * (m.average_price || 0) });
  rows.sort((x, y) => y.cur - x.cur);
  const body = rows.map(({ a, m, cur, inv }) => `<tr>${isAll ? accCell(a) : ""}<td>${esc(m.fund || m.tradingsymbol)}</td><td class="num">${num(m.quantity, 3)}</td><td class="num">${num(m.average_price)}</td><td class="num">${num(m.last_price)}</td>
    <td class="num">${inr(inv)}</td><td class="num">${inr(cur)}</td><td class="num cell2 ${cls(cur - inv)}">${sinr(cur - inv)}<small>${pct(inv ? (cur - inv) / inv * 100 : 0)}</small></td></tr>`).join("");
  const ti = rows.reduce((s, r) => s + r.inv, 0), tc = rows.reduce((s, r) => s + r.cur, 0);
  return `<div class="card" style="--i:1"><div class="card-h"><h3>Mutual funds <span class="muted">${rows.length}</span></h3>${rows.length ? `<span class="pill ${cls(tc - ti)}">${arrow(tc - ti)} ${sinr(tc - ti)}</span>` : ""}</div>
    <div class="tbl-wrap"><table><thead><tr>${isAll ? "<th>Account</th>" : ""}<th>Fund</th><th>Units</th><th>Avg NAV</th><th>NAV</th><th>Invested</th><th>Current</th><th>P&amp;L</th></tr></thead>
    <tbody>${body || `<tr><td colspan="8" class="empty"><b>No mutual fund holdings</b>Coin holdings show up here.</td></tr>`}</tbody></table></div></div>`;
}
function fundsHTML(live, isAll) {
  const cards = live.map(a => {
    const eq = a.snapshot.margins?.equity || {}, av = eq.available || {}, ut = eq.utilised || {};
    const kv = [["Available", av.live_balance ?? eq.net], ["Opening balance", av.opening_balance], ["Used margin", ut.debits], ["Collateral", av.collateral], ["Payin today", av.intraday_payin], ["Net", eq.net]]
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `<div><div class="k">${k}</div><div class="v num">${inr(v, 2)}</div></div>`).join("");
    return `<div class="card" style="--i:1"><div class="card-h"><h3>${isAll ? esc(a.name) + " · " : ""}Equity funds</h3><span class="muted num">${esc(a.user_id)}</span></div><div class="kv">${kv || `<div class="empty">No margin data</div>`}</div></div>`;
  });
  return `<div style="display:grid;gap:16px">${cards.join("")}</div>`;
}

/* ---- watchlist (shared across the family, stored locally) */
const isWatched = (sym) => !!state.watch?.items.some(i => i.symbol === sym);
async function loadWatch() {
  try { state.watch = await api("/api/watchlist"); } catch (e) { toast("Watchlist: " + e.message, true); }
  if (state.section === "watch") renderMain(); else renderTabsCount();
}
function renderTabsCount() { const el = $('[data-sec="watch"]'); if (el && state.watch) el.innerHTML = `Watchlist${state.watch.items.length ? `<span class="n">${state.watch.items.length}</span>` : ""}`; }
async function watchMutate(method, url, body) {
  try { state.watch = await api(url, { method, body: body ? JSON.stringify(body) : undefined }); renderMain(); }
  catch (e) { toast(e.message, true); }
}
function watchHTML(list, isAll) {
  const w = state.watch;
  if (!w) return `<div class="card"><div class="empty"><div class="skel" style="width:160px;margin:0 auto"></div></div></div>`;
  const selIds = new Set(list.map(a => a.id));
  let rows = w.items.map(i => {
    const ltp = i.last_price, close = i.close_price || ltp;
    const dayPct = ltp && close ? (ltp - close) / close * 100 : 0;
    const mine = i.holders.filter(h => selIds.has(h.id));
    return { ...i, ltp, dayPct, day: ltp && close ? ltp - close : 0, held: mine.reduce((s, h) => s + h.qty, 0), heldAll: i.holders.reduce((s, h) => s + h.qty, 0), name: i.name || "" };
  });
  const q = state.q.trim().toUpperCase();
  if (q) rows = rows.filter(r => r.symbol.includes(q) || r.name.toUpperCase().includes(q) || (r.note || "").toUpperCase().includes(q));
  const { key, dir } = state.watchSort;
  rows.sort((a, b) => key === "symbol" ? dir * a.symbol.localeCompare(b.symbol) : dir * ((a[key] || 0) - (b[key] || 0)));
  const cols = [["symbol", "Instrument"], ["ltp", "LTP"], ["dayPct", "Day"], ["heldAll", "Held by"], ["note", "Note"]];
  const th = cols.map(([k, l]) => `<th class="${k === "note" ? "" : "sortable"} ${key === k ? "sorted" : ""}" ${k === "note" ? "" : `data-wsort="${k}"`}>${l} ${k !== "note" ? `<span class="arr">${key === k ? (dir < 0 ? "↓" : "↑") : ""}</span>` : ""}</th>`).join("") + "<th></th>";
  const body = rows.map(r => `<tr>
      <td><div class="sym">${esc(r.symbol)} <span class="ex">${esc(r.exchange)}</span><button class="star on" style="opacity:1" data-chart="${esc(r.exchange)}/${esc(r.symbol)}" data-name="${esc(r.name)}" title="Chart">${ICON.chart}</button>${r.source === "yahoo" ? `<span class="ex" title="Price from Yahoo Finance (nobody holds this)">Y</span>` : ""}</div><div class="muted" style="font-size:11px;margin-top:2px">${esc(r.name)}</div></td>
      <td class="num">${r.ltp != null ? num(r.ltp) : "<span class='muted'>—</span>"}</td>
      <td class="num cell2 ${cls(r.day)}">${r.ltp != null ? `${arrow(r.day)} ${pct(r.dayPct)}<small>${sinr(r.day, 2)}</small>` : "<span class='muted'>no quote</span>"}</td>
      <td>${r.holders.length ? `<span class="holders">${r.holders.map(h => `<i style="--c:${colorVar(h.color)}" data-tip="<b>${esc(h.name)}</b><span class='num'><span class='amt'>${h.qty}</span> qty · avg ${num(h.avg)} · ${sinrTip(h.pnl)}</span>">${esc(initials(h.name)[0])}</i>`).join("")}</span> <span class="muted num" style="font-size:11px">${num(r.heldAll, 0)}${!isAll && r.held !== r.heldAll ? ` · ${num(r.held, 0)} here` : ""}</span>` : `<span class="muted">nobody yet</span>`}</td>
      <td class="note-cell"><input class="note" value="${esc(r.note || "")}" placeholder="add a note…" data-note="${esc(r.exchange)}/${esc(r.symbol)}"></td>
      <td style="white-space:nowrap"><a class="btn ghost" style="padding:4px 8px" target="_blank" rel="noopener" href="${screenerLink(r.symbol)}" title="Open on Screener.in">${ICON.ext}</a><button class="btn ghost" style="padding:4px 8px" data-unwatch="${esc(r.exchange)}/${esc(r.symbol)}" title="Remove">✕</button></td></tr>`).join("");
  const sugg = state.sugg.map((s, i) => `<div class="sg ${i === state.suggIdx ? "on" : ""}" data-sg="${i}"><b>${esc(s.symbol)}</b><span>${esc(s.name)}</span>${isWatched(s.symbol) ? `<em>added</em>` : ""}</div>`).join("");
  const src = rows.some(r => r.source === "yahoo") ? "prices: Kite for held stocks, Yahoo Finance otherwise" : "prices from Kite";
  return `<div class="card" style="--i:1"><div class="card-h"><h3>Watchlist <span class="muted">${w.items.length}</span></h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="muted">${src}</span>
        <div class="addwrap"><label class="search">${ICON.plus}<input id="addsym" placeholder="Add symbol or company…" autocomplete="off" style="width:220px"></label>${sugg ? `<div class="sugg">${sugg}</div>` : ""}</div>
        <label class="search">${ICON.search}<input id="q" placeholder="Filter…" value="${esc(state.q)}"></label></div></div>
    <div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="6" class="empty"><b>Nothing on the watchlist yet</b>Type a symbol above, or click ☆ next to any holding.</td></tr>`}</tbody></table></div></div>`;
}

/* ---- chart overlay (TradingView free widget) */
const TV_INDEX = { "NIFTY 50": "NSE:NIFTY", "NIFTY BANK": "NSE:BANKNIFTY", "NIFTY FIN SERVICE": "NSE:CNXFINANCE", "NIFTY MIDCAP 100": "NSE:CNXMIDCAP", "NIFTY NEXT 50": "NSE:NIFTYJR", "SENSEX": "BSE:SENSEX", "INDIA VIX": "NSE:INDIAVIX" };
/* TradingView's free widget may not show NSE data (it pops a "only available on TradingView" notice), so default to BSE where the same symbol exists. */
const tvSymbol = (symbol, pref) => TV_INDEX[symbol] || `${pref}:${symbol.replace(/[^A-Za-z0-9]/g, "_")}`;
const kiteChartUrl = (exchange, symbol, token) => token ? `https://kite.zerodha.com/markets/ext/chart/web/tvc/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/${token}` : null;
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function mountTV(tv) {
  const box = $(".tradingview-widget-container"); if (!box) return;
  box.innerHTML = `<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>`;
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"; s.async = true;
  s.textContent = JSON.stringify({ autosize: true, symbol: tv, interval: "D", timezone: "Asia/Kolkata", theme, style: "1", locale: "en",
    allow_symbol_change: true, withdateranges: true, hide_side_toolbar: false, details: false, calendar: false,
    studies: ["STD;SMA", "STD;RSI"], support_host: "https://www.tradingview.com" });
  box.appendChild(s);
}
async function openChart(exchange, symbol, name = "", opts = {}) {
  if (opts.tv) TV_INDEX[symbol] = opts.tv;
  const row = opts.row || state.watch?.items.find(i => i.symbol === symbol) || null;
  const h = holdingRows(liveAccounts()).find(r => r.symbol === symbol);
  const ltp = h ? h.ltp : row?.last_price, close = h ? h.close : row?.close_price;
  const holders = h ? h.parts.map(p => ({ name: p.acc.name, color: p.acc.color, qty: p.qty })) : (row?.holders || []);
  const token = h?.token || row?.instrument_token || null;
  let pref = TV_INDEX[symbol] ? TV_INDEX[symbol].split(":")[0] : (localStorage.getItem("fl.tvex") || "BSE");
  if (!name) name = row?.name || "";
  const tvLink = "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(tvSymbol(symbol, "NSE"));
  modal(`<div class="chart-head">
      <div><h3 style="margin:0">${esc(symbol)} <span class="ex" style="font-family:var(--mono);font-size:11px;color:var(--ink-3);border:1px solid var(--line-2);border-radius:4px;padding:0 5px;vertical-align:middle">${esc(exchange)}</span></h3>
        <div class="sub" style="margin:4px 0 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span id="chart-name">${esc(name)}</span>
          ${ltp != null ? `<span class="num" style="color:var(--ink)">${num(ltp)}</span><span class="num ${cls(ltp - close)}">${arrow(ltp - close)} ${pct(close ? (ltp - close) / close * 100 : 0)}</span>` : ""}
          ${holders.length ? `<span class="holders">${holders.map(x => `<i style="--c:${colorVar(x.color)}" title="${esc(x.name)}: ${x.qty}">${esc(initials(x.name)[0])}</i>`).join("")}</span>` : ""}</div></div>
      <div class="actions">
        ${TV_INDEX[symbol] ? "" : `<div class="tabs" style="margin:0"><button class="tab ${pref === "BSE" ? "active" : ""}" data-tvex="BSE" title="BSE data shows without the TradingView notice">BSE</button><button class="tab ${pref === "NSE" ? "active" : ""}" data-tvex="NSE" title="NSE data (TradingView shows a notice first)">NSE</button></div>`}
        <button class="btn ghost" data-watch="${esc(symbol)}">${isWatched(symbol) ? "★ Watching" : "☆ Watch"}</button>
        ${opts.tv || TV_INDEX[symbol] ? "" : `<a class="btn ghost" target="_blank" rel="noopener" href="${screenerLink(symbol)}" title="Fundamentals, financials, ratios">${ICON.ext} Screener.in</a>`}
        <a class="btn ghost" target="_blank" rel="noopener" href="${tvLink}">${ICON.ext} TradingView</a>
        <a class="btn ghost" id="kite-link" target="_blank" rel="noopener" href="${kiteChartUrl(exchange, symbol, token) || "#"}" ${token ? "" : 'style="opacity:.5" title="Looking up instrument…"'}>${ICON.ext} Kite</a>
        <button class="btn ghost" data-cancel title="Close (Esc)">✕</button></div></div>
    <div class="chart-body"><div class="tradingview-widget-container" style="height:100%;width:100%"></div>
      <div class="chart-fallback muted">Loading TradingView chart… if nothing appears, you may be offline or the widget is blocked. <a target="_blank" rel="noopener" href="${tvLink}">Open it on tradingview.com</a> instead.</div></div>`);
  $(".modal").classList.add("wide");
  mountTV(tvSymbol(symbol, pref));
  $(".modal").addEventListener("click", e => {
    const b = e.target.closest("[data-tvex]"); if (!b) return;
    pref = b.dataset.tvex; localStorage.setItem("fl.tvex", pref);
    $$(".modal [data-tvex]").forEach(x => x.classList.toggle("active", x === b));
    mountTV(tvSymbol(symbol, pref));
  });
  setTimeout(() => { const f = $(".chart-fallback"); if (f && $(".tradingview-widget-container iframe")) f.remove(); }, 2500);
  if (!token || !name) {
    const info = await api("/api/instruments/lookup?symbol=" + encodeURIComponent(symbol)).catch(() => ({}));
    const k = $("#kite-link"), n = $("#chart-name");
    if (info?.instrument_token && k) { k.href = kiteChartUrl(exchange, symbol, info.instrument_token); k.style.opacity = ""; k.title = ""; }
    else if (k && !token) { k.title = "Not in Zerodha's NSE instrument list"; }
    if (info?.name && n && !name) n.textContent = info.name;
  }
}

/* ---- indices (Yahoo Finance, no login) */
async function loadIndices(force = false) {
  try { state.indices = await api("/api/indices" + (force ? "?force=1" : "")); } catch (e) { toast("Indices: " + e.message, true); }
  if (state.section === "indices") renderMain();
}
function sparkSVG(vals, up) {
  if (!vals || vals.length < 2) return "";
  const w = 120, h = 34, min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / span * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function indicesHTML() {
  const d = state.indices;
  if (!d) { loadIndices(); return `<div class="card"><div class="empty"><div class="skel" style="width:160px;margin:0 auto"></div></div></div>`; }
  const groups = {};
  for (const r of d.items) (groups[r.group] = groups[r.group] || []).push(r);
  const card = (r) => {
    const ok = r.last != null && r.close;
    const ch = ok ? r.last - r.close : 0, pc = ok ? ch / r.close * 100 : 0;
    const row = { symbol: r.name, name: r.name, last_price: r.last, close_price: r.close, instrument_token: r.instrument_token, holders: [] };
    return `<div class="idx ${ok ? cls(ch) : ""}" data-idx="${esc(r.name)}">
      <div class="idx-top"><span class="idx-name">${esc(r.name)}</span><button class="star on" style="opacity:1" title="Chart" data-idxchart="${esc(r.name)}">${ICON.chart}</button></div>
      <div class="idx-val num">${ok ? num(r.last) : "<span class='muted'>—</span>"}</div>
      <div class="idx-ch num ${cls(ch)}">${ok ? `${arrow(ch)} ${pct(pc)} <span class="muted">${(ch > 0 ? "+" : "") + num(ch)}</span>` : "<span class='muted'>no data</span>"}</div>
      ${sparkSVG(r.spark, ch >= 0)}
      ${r.low != null && r.high != null ? `<div class="idx-range muted num">${num(r.low)} – ${num(r.high)}</div>` : ""}
    </div>`;
  };
  const ts = Math.max(0, ...d.items.map(r => r.ts || 0));
  return Object.entries(groups).map(([g, rows], i) => `<div class="card" style="--i:${i + 1}"><div class="card-h"><h3>${esc(g)} <span class="muted">${rows.length}</span></h3>${i === 0 ? `<span class="muted"><a href="https://marketlens.nseindia.com/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">NSE MarketLens ↗</a> · Yahoo Finance · ${ts ? "as of " + new Date(ts * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""} <button class="btn ghost" style="padding:2px 8px" data-act="idxrefresh">${ICON.refresh}</button></span>` : ""}</div>
    <div class="idx-grid">${rows.map(card).join("")}</div></div>`).join("");
}

/* ---- market-cap allocation (NSE index lists: large = NIFTY 100, mid = MIDCAP 150, small = SMALLCAP 250, micro = MICROCAP 250) */
const CAP_ORDER = ["Large", "Mid", "Small", "Micro", "ETF", "Other"];
const CAP_COLOR = { Large: "#1c5cab", Mid: "#2a78d6", Small: "#5598e7", Micro: "#9ec5f4", ETF: "var(--s4)", Other: "var(--ink-3)" };
function capOf(r) {
  const m = state.caps || {};
  const hit = m[r.symbol] || (r.isin && m[r.isin]);
  if (hit) return hit.cap;
  if (/BEES$|ETF|^LIQUID|GOLD|SILVER|NIFTY|SENSEX|^MON100|^MAFANG|^HNGSNGBEES/.test(r.symbol)) return "ETF";
  return "Other";
}
function capDonutHTML(rows, t) {
  if (!state.caps) return `<div class="card" style="--i:4"><div class="card-h"><h3>By market cap</h3></div><div class="empty"><div class="skel" style="width:120px;margin:0 auto"></div></div></div>`;
  const sums = {};
  for (const r of rows) { const c = capOf(r); sums[c] = (sums[c] || 0) + r.current; }
  const items = CAP_ORDER.filter(c => sums[c]).map(c => ({ label: c === "ETF" ? "ETF / index" : c === "Other" ? "Beyond top 750" : c + " cap", key: c, value: sums[c], color: CAP_COLOR[c] }));
  const n = rows.filter(r => !["ETF", "Other"].includes(capOf(r))).length;
  return donutCard("By market cap", items, items.length ? (items[0].value / (t.current || 1) * 100).toFixed(0) + "%" : "—", items[0] ? items[0].label.toUpperCase() : "", `${n} of ${rows.length} in NSE top 750`, "cap", state.capFilter);
}
async function loadCaps() { try { state.caps = await api("/api/caps"); } catch (e) { state.caps = {}; } if (state.section === "holdings") renderMain(); }

/* ---- screener (TradingView free widget, India market) */
const TOOL_LINKS = [
  ["NSE MarketLens", "https://marketlens.nseindia.com/", "NSE's own market analytics: index movers, breadth, sector heatmaps"],
  ["Screener.in", "https://www.screener.in/screens/", "Fundamentals, 10-year financials, custom query screens"],
  ["Chartink", "https://chartink.com/screeners", "Technical scans and community screeners"],
  ["Trendlyne", "https://trendlyne.com/stock-screeners/", "Scores, forecasts, superstar portfolios"],
  ["Tickertape", "https://www.tickertape.in/screener", "Simple filters with peer comparison"],
  ["NSE India", "https://www.nseindia.com/market-data/live-equity-market", "Official live market data and reports"],
];
function screenerHTML() {
  const links = TOOL_LINKS.map(([n, u, d]) => `<a class="tool" href="${u}" target="_blank" rel="noopener"><span class="tool-n">${esc(n)} ${ICON.ext}</span><span class="tool-d">${esc(d)}</span></a>`).join("");
  return `<div class="card" style="--i:0;margin-bottom:16px"><div class="card-h"><h3>Screening tools</h3><span class="muted">open in a new tab</span></div><div class="tools">${links}</div></div>
    <div class="card" style="--i:1"><div class="card-h"><h3>Stock screener</h3><span class="muted">TradingView · India · filters, presets and sorting in the toolbar</span></div>
    <div class="screener-body"><div id="tv-screener" class="tradingview-widget-container" style="height:100%;width:100%"></div></div></div>`;
}
function mountScreener() {
  const box = $("#tv-screener"); if (!box || box.querySelector("iframe, script")) return;
  box.innerHTML = `<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>`;
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-screener.js"; s.async = true;
  s.textContent = JSON.stringify({ width: "100%", height: "100%", defaultColumn: "overview", defaultScreen: "most_capitalized", market: "india",
    showToolbar: true, colorTheme: document.documentElement.dataset.theme === "light" ? "light" : "dark", locale: "en", isTransparent: true });
  box.appendChild(s);
}
const screenerLink = (symbol) => `https://www.screener.in/company/${encodeURIComponent(symbol)}/`;

/* ---- history: imported ledger + tradebook (Zerodha Console CSVs) */
const pct1 = (n) => (n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + "%");
async function loadHistory(accId) {
  if (accId === "all") {
    try { state.histOverview = await api("/api/history/overview"); } catch (e) { toast("History: " + e.message, true); }
  } else {
    const [status, ledger, trades] = await Promise.all([api(`/api/history/${accId}/status`), api(`/api/history/${accId}/ledger`), api(`/api/history/${accId}/trades`)]).catch(e => { toast("History: " + e.message, true); return [null, null, null]; });
    state.hist[accId] = { status, ledger, trades, at: Date.now() };
  }
  if (state.section === "history") renderMain();
}
/* small SVG bar chart: data = [{label, v}] ; two-series variant when v2 given */
function barsSVG(data, opts = {}) {
  const w = opts.w || 640, h = opts.h || 160, padL = 8, padB = 22, n = data.length; if (!n) return "";
  const max = Math.max(1, ...data.map(d => Math.max(Math.abs(d.v || 0), Math.abs(d.v2 || 0))));
  const hasNeg = data.some(d => (d.v || 0) < 0 || (d.v2 || 0) < 0);
  const zero = hasNeg ? (h - padB) / 2 : h - padB;
  const scale = (hasNeg ? (h - padB) / 2 : h - padB) / max;
  const bw = Math.max(2, (w - padL) / n - 2);
  const bars = data.map((d, i) => {
    const x = padL + i * ((w - padL) / n);
    const mk = (v, color, off) => { if (!v) return ""; const bh = Math.abs(v) * scale; const y = v >= 0 ? zero - bh : zero; return `<rect x="${(x + off).toFixed(1)}" y="${y.toFixed(1)}" width="${(opts.v2 ? bw / 2 - 1 : bw).toFixed(1)}" height="${Math.max(1, bh).toFixed(1)}" rx="2" fill="${color}" data-tip="<b>${esc(d.label)}</b><span class='num'>${opts.fmt ? opts.fmt(v) : inrTip(v)}</span>"/>`; };
    return mk(d.v, d.color || (d.v >= 0 ? (opts.c1 || "var(--s1)") : "var(--down)"), 0) + (opts.v2 ? mk(d.v2, opts.c2 || "var(--s2)", bw / 2) : "");
  }).join("");
  const step = Math.ceil(n / 8);
  const labels = data.map((d, i) => i % step ? "" : `<text x="${(padL + i * ((w - padL) / n)).toFixed(1)}" y="${h - 6}" font-size="10" fill="var(--ink-3)">${esc(d.label)}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="bars" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${zero}" y2="${zero}" stroke="var(--line-2)"/>${bars}${labels}</svg>`;
}
function lineSVG(points, opts = {}) {
  const w = opts.w || 640, h = opts.h || 140, n = points.length; if (n < 2) return "";
  const vals = points.map(p => p.v), min = Math.min(0, ...vals), max = Math.max(1, ...vals), span = max - min || 1;
  const X = i => (i / (n - 1) * (w - 4) + 2), Y = v => (h - 18 - (v - min) / span * (h - 26));
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const zeroY = Y(0);
  const dots = points.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="6" fill="transparent" data-tip="<b>${esc(p.label)}</b><span class='num'>${opts.fmt ? opts.fmt(p.v) : inrTip(p.v)}</span>"/>`).join("");
  const step = Math.ceil(n / 8);
  const labels = points.map((p, i) => i % step ? "" : `<text x="${X(i).toFixed(1)}" y="${h - 4}" font-size="10" fill="var(--ink-3)">${esc(p.label)}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="bars" preserveAspectRatio="none">${min < 0 ? `<line x1="0" x2="${w}" y1="${zeroY}" y2="${zeroY}" stroke="var(--line-2)"/>` : ""}<path d="${d}" fill="none" stroke="${opts.color || "var(--accent)"}" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
const fyShort = (fy) => fy.replace("FY", "");
const monShort = (m) => { const [y, mm] = m.split("-"); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mm - 1] + " " + y.slice(2); };

function historyHTML(list, isAll) {
  const importBtn = `<button class="btn primary" data-act="import">${ICON.plus} Import statement</button>`;
  if (isAll) {
    const d = state.histOverview;
    if (!d) { loadHistory("all"); return `<div class="card"><div class="empty"><div class="skel" style="width:160px;margin:0 auto"></div></div></div>`; }
    const withLedger = d.accounts.filter(a => a.ledger);
    if (!withLedger.length) return historyEmptyHTML(importBtn);
    const tot = withLedger.reduce((s, a) => ({ dep: s.dep + a.ledger.deposits, wd: s.wd + a.ledger.withdrawals, net: s.net + a.ledger.net_invested, cur: s.cur + (a.ledger.current_value || 0), fno: s.fno + (a.ledger.fno_total || 0), ch: s.ch + (a.ledger.charges_total || 0), live: s.live + (a.ledger.current_value != null ? 1 : 0) }), { dep: 0, wd: 0, net: 0, cur: 0, fno: 0, ch: 0, live: 0 });
    const gain = tot.live === withLedger.length ? tot.cur - tot.net : null;
    const rows = d.accounts.map(a => `<tr data-sel="${a.id}" style="cursor:pointer"><td><span class="sym"><span class="holders"><i style="--c:${colorVar(a.color)}">${esc(initials(a.name)[0])}</i></span>${esc(a.name)}</span></td>
      ${a.ledger ? `<td class="num muted">${a.ledger.from.slice(0, 7)} → ${a.ledger.to.slice(0, 7)}</td><td class="num">${inr(a.ledger.deposits)}</td><td class="num">${inr(a.ledger.withdrawals)}</td><td class="num">${inr(a.ledger.net_invested)}</td>
        <td class="num">${a.ledger.current_value != null ? inr(a.ledger.current_value) : "<span class='muted'>login</span>"}</td>
        <td class="num ${cls(a.ledger.absolute_gain || 0)}">${a.ledger.absolute_gain != null ? sinr(a.ledger.absolute_gain) : "—"}</td>
        <td class="num ${cls(a.ledger.xirr || 0)}">${pct1(a.ledger.xirr)}</td><td class="num ${cls(a.ledger.fno_total)}">${sinr(a.ledger.fno_total)}</td><td class="num down">${inr(a.ledger.charges_total)}</td>`
        : `<td colspan="9" class="muted">No ledger imported yet</td>`}</tr>`).join("");
    const tile = (k, v, s, i) => `<div class="tile" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
    return `<div class="stats" style="grid-template-columns:repeat(5,1fr)">
        ${tile("Deposited from bank", inr(tot.dep), `<span class="muted">${withLedger.length} account${withLedger.length > 1 ? "s" : ""} with ledger</span>`, 0)}
        ${tile("Withdrawn", inr(tot.wd), `<span class="muted">back to bank</span>`, 1)}
        ${tile("Net capital in", inr(tot.net), `<span class="muted">deposits − withdrawals</span>`, 2)}
        ${tile("Gain on capital", gain == null ? "—" : `<span class="${cls(gain)}">${sinr(gain)}</span>`, gain == null ? `<span class="muted">log in all accounts to compute</span>` : `<span class="pill ${cls(gain)}">${arrow(gain)} ${pct(tot.net ? gain / tot.net * 100 : 0)} absolute</span>`, 3)}
        ${tile("F&O net · charges", `<span class="${cls(tot.fno)}">${sinr(tot.fno)}</span>`, `<span class="muted">charges ${inr(tot.ch)} across family</span>`, 4)}
      </div>
      <div class="card" style="--i:1"><div class="card-h"><h3>Capital by account</h3>${importBtn}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Account</th><th>Ledger span</th><th>Deposited</th><th>Withdrawn</th><th>Net in</th><th>Value now</th><th>Gain</th><th>XIRR</th><th>F&amp;O net</th><th>Charges</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="hint" style="padding:0 16px 14px">XIRR is the annualised return on your own money: every deposit counts as money out, every withdrawal as money back, and today’s account value as the final inflow. Click a row for the full picture of that account.</div></div>`;
  }
  const acc = list[0];
  const h = state.hist[acc.id];
  if (!h) { loadHistory(acc.id); return `<div class="card"><div class="empty"><div class="skel" style="width:160px;margin:0 auto"></div></div></div>`; }
  const L = h.ledger, T = h.trades, S = h.status;
  if ((!L || L.empty) && (!T || T.empty)) return historyEmptyHTML(importBtn, acc);
  const sub = [["capital", "Capital & returns"], ["fno", "F&O"], ["charges", "Charges"], ["trades", "Trades"], ["data", "Data"]];
  const tabs = `<div class="tabs" style="margin-bottom:14px">${sub.map(([k, l]) => `<button class="tab ${state.histView === k ? "active" : ""}" data-hview="${k}">${l}</button>`).join("")}</div>`;
  let body = "";
  if (state.histView === "capital") body = capitalHTML(L, acc);
  else if (state.histView === "fno") body = fnoHTML(L);
  else if (state.histView === "charges") body = chargesHTML(L);
  else if (state.histView === "trades") body = tradesHTML(T);
  else body = dataHTML(S, acc, importBtn);
  return tabs + body;
}
function historyEmptyHTML(importBtn, acc) {
  return `<div class="card"><div class="empty" style="padding:50px 20px"><b>No statements imported${acc ? " for " + esc(acc.name) : ""}</b>
    Download the <b>Ledger</b> (Funds → Statement) and the <b>Tradebook</b> from console.zerodha.com as CSV and import them here.<br>First time: the full history. After that: just the current financial year (1 April → today), as often as you like.<div style="margin-top:16px">${importBtn}</div></div></div>`;
}
function capitalHTML(L, acc) {
  if (!L || L.empty) return `<div class="card"><div class="empty">No ledger imported for ${esc(acc.name)} yet. Open <b>Data</b> to import.</div></div>`;
  const tile = (k, v, s, i, hero) => `<div class="tile ${hero ? "hero" : ""}" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
  const cum = []; let run = 0;
  for (const m of L.monthly) { run += m.in - m.out; cum.push({ label: monShort(m.month), v: run }); }
  const yrs = L.yearly.map(y => ({ label: fyShort(y.fy), v: y.in, v2: y.out }));
  return `<div class="stats">
      ${tile("Net capital in", inr(L.net_invested), `<span class="muted">${inr(L.deposits)} in · ${inr(L.withdrawals)} out · since ${L.from.slice(0, 7)}</span>`, 0, true)}
      ${tile("Value today", L.current_value != null ? inr(L.current_value) : "—", L.current_value != null ? `<span class="muted">holdings + cash + MF</span>` : `<span class="muted">log in to compute</span>`, 1)}
      ${tile("Gain on capital", L.absolute_gain != null ? `<span class="${cls(L.absolute_gain)}">${sinr(L.absolute_gain)}</span>` : "—", L.absolute_gain != null ? `<span class="pill ${cls(L.absolute_gain)}">${arrow(L.absolute_gain)} ${pct(L.net_invested ? L.absolute_gain / L.net_invested * 100 : 0)} absolute</span>` : "", 2)}
      ${tile("XIRR", L.xirr != null ? `<span class="${cls(L.xirr)}">${pct1(L.xirr)}</span>` : "—", `<span class="muted">per year, on dated cash flows${L.simple_cagr != null ? ` · simple CAGR ${pct1(L.simple_cagr)}` : ""}</span>`, 3)}
      ${tile("Time invested", L.years != null ? L.years + " yrs" : "—", `<span class="muted">${L.rows.toLocaleString("en-IN")} ledger rows · ${L.negative_months} month${L.negative_months === 1 ? "" : "s"} with negative balance</span>`, 4)}
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card" style="--i:1"><div class="card-h"><h3>Net capital over time</h3><span class="muted">cumulative deposits − withdrawals</span></div><div style="padding:0 12px 12px">${lineSVG(cum)}</div></div>
      <div class="card" style="--i:2"><div class="card-h"><h3>Deposits vs withdrawals by FY</h3><span class="muted"><span class="holders"><i style="--c:var(--s1)"></i></span> in &nbsp; <span class="holders"><i style="--c:var(--s2)"></i></span> out</span></div><div style="padding:0 12px 12px">${barsSVG(yrs, { v2: true, h: 170 })}</div></div>
    </div>
    <div class="card" style="--i:3;margin-top:16px"><div class="card-h"><h3>Year by year</h3></div><div class="tbl-wrap"><table><thead><tr><th>FY</th><th>Deposited</th><th>Withdrawn</th><th>Net in</th><th>Equity bought</th><th>Equity sold</th><th>F&amp;O net</th><th>Charges</th></tr></thead>
      <tbody>${L.yearly.map(y => `<tr><td>${esc(y.fy)}</td><td class="num">${inr(y.in)}</td><td class="num">${inr(y.out)}</td><td class="num ${cls(y.in - y.out)}">${sinr(y.in - y.out)}</td><td class="num">${inr(y.equity_buy)}</td><td class="num">${inr(y.equity_sell)}</td><td class="num ${cls(y.fno)}">${sinr(y.fno)}</td><td class="num down">${inr(y.charges)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function fnoHTML(L) {
  if (!L || L.empty || !Object.keys(L.fno).length) return `<div class="card"><div class="empty"><b>No derivatives activity in the ledger</b></div></div>`;
  const segs = Object.entries(L.fno);
  const colors = ["var(--s1)", "var(--s2)", "var(--s3)"];
  return `<div class="stats" style="grid-template-columns:repeat(${Math.min(4, segs.length + 1)},1fr)">
      <div class="tile hero" style="--i:0"><div class="k">All derivatives, net</div><div class="v num ${cls(L.fno_total)}">${sinr(L.fno_total)}</div><div class="s"><span class="muted">realised P&amp;L from daily net obligations, before charges</span></div></div>
      ${segs.map(([s, v], i) => `<div class="tile" style="--i:${i + 1}"><div class="k">${esc(s)}</div><div class="v num ${cls(v.total)}">${sinr(v.total)}</div><div class="s"><span class="muted">${v.days.win} up · ${v.days.loss} down days · ${v.monthly[0]?.month ? monShort(v.monthly[0].month) + " → " + monShort(v.monthly[v.monthly.length - 1].month) : ""}</span></div></div>`).join("")}
    </div>
    ${segs.map(([s, v], i) => { let run = 0; const cum = v.monthly.map(m => ({ label: monShort(m.month), v: (run += m.pnl) })); return `<div class="card" style="--i:${i + 1};margin-bottom:16px"><div class="card-h"><h3>${esc(s)}</h3><span class="muted">monthly P&amp;L and cumulative</span></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;padding:0 12px 12px;gap:12px"><div>${barsSVG(v.monthly.map(m => ({ label: monShort(m.month), v: m.pnl })), { h: 150, c1: "var(--up)" })}</div><div>${lineSVG(cum, { h: 150, color: colors[i % 3] })}</div></div></div>`; }).join("")}`;
}
function chargesHTML(L) {
  if (!L || L.empty) return "";
  const names = { dp: "DP charges (per sale)", amc: "Demat AMC", gateway: "Payment gateway", interest: "Delayed payment interest", pledge: "Pledge charges", penalty: "Penalties & shortfall", tax: "STT / stamp / SEBI (ledger-level)", brokerage: "Brokerage adjustments", other: "Other charges" };
  const items = Object.entries(L.charges).filter(([, v]) => v > 0).map(([k, v], i) => ({ label: names[k] || k, key: k, value: v, color: colorVar(i + 1) }));
  const byFy = L.yearly.map(y => ({ label: fyShort(y.fy), v: y.charges }));
  return `<div class="grid" style="grid-template-columns:1fr 1fr">
      ${donutCard("Charges by type", items, short(L.charges_total), "TOTAL", "from the ledger only")}
      <div class="card" style="--i:2"><div class="card-h"><h3>Charges by FY</h3></div><div style="padding:0 12px 12px">${barsSVG(byFy, { h: 200, c1: "var(--s4)" })}</div></div></div>
    <div class="hint" style="margin-top:12px">Brokerage, STT and exchange fees on each trade are netted inside the equity settlement rows, so they are not itemised here. The contract notes / P&amp;L report from Console carry those.</div>`;
}
function tradesHTML(T) {
  if (!T || T.empty) return `<div class="card"><div class="empty"><b>No tradebook imported</b>Import the Tradebook CSV from Console under <b>Data</b> to see realised P&amp;L per stock, win rate and holding periods.</div></div>`;
  const tile = (k, v, s, i, hero) => `<div class="tile ${hero ? "hero" : ""}" style="--i:${i}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
  const q = state.q.trim().toUpperCase();
  const syms = T.by_symbol.filter(s => !q || s.symbol.includes(q));
  return `<div class="stats">
      ${tile("Realised P&L (FIFO)", `<span class="${cls(T.realised_total)}">${sinr(T.realised_total)}</span>`, `<span class="muted">${T.sell_count} sells matched against buys</span>`, 0, true)}
      ${tile("Trades", T.trades.toLocaleString("en-IN"), `<span class="muted">${T.symbols} symbols · ${T.from.slice(0, 7)} → ${T.to.slice(0, 7)}</span>`, 1)}
      ${tile("Win rate", T.win_rate != null ? T.win_rate + "%" : "—", `<span class="muted">sells closed at a profit</span>`, 2)}
      ${tile("Avg holding", T.avg_hold_days != null ? T.avg_hold_days + " d" : "—", `<span class="muted">buy to sell, FIFO lots</span>`, 3)}
      ${tile("Best · worst", `<span class="up">${esc(T.best[0]?.symbol || "—")}</span>`, `<span class="muted">${T.best[0] ? sinr(T.best[0].realised) : ""} · <span class="down">${esc(T.worst[0]?.symbol || "")}</span> ${T.worst[0] ? sinr(T.worst[0].realised) : ""}</span>`, 4)}
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card" style="--i:1"><div class="card-h"><h3>Realised P&amp;L by FY</h3></div><div style="padding:0 12px 12px">${barsSVG(T.yearly.map(y => ({ label: fyShort(y.fy), v: y.realised })), { h: 170, c1: "var(--up)" })}</div></div>
      <div class="card" style="--i:2"><div class="card-h"><h3>Trades per month</h3></div><div style="padding:0 12px 12px">${barsSVG(T.monthly.map(m => ({ label: monShort(m.month), v: m.trades })), { h: 170, c1: "var(--s7)", fmt: v => v + " trades" })}</div></div>
    </div>
    <div class="card" style="--i:3;margin-top:16px"><div class="card-h"><h3>By stock <span class="muted">${syms.length}</span></h3><label class="search">${ICON.search}<input id="q" placeholder="Filter symbol…" value="${esc(state.q)}"></label></div>
      <div class="tbl-wrap"><table><thead><tr><th>Symbol</th><th>Trades</th><th>Bought</th><th>Sold</th><th>Realised</th><th>Still held (FIFO)</th><th>First</th><th>Last</th><th></th></tr></thead>
      <tbody>${syms.slice(0, 200).map(s => `<tr><td><span class="sym">${esc(s.symbol)}</span></td><td class="num">${s.trades}</td><td class="num">${inr(s.buys)}</td><td class="num">${inr(s.sells)}</td><td class="num ${cls(s.realised)}">${sinr(s.realised)}</td><td class="num">${s.open_qty ? `<span class="amt">${num(s.open_qty, 0)}</span> · ${inr(s.open_cost)}` : "<span class='muted'>—</span>"}</td><td class="num muted">${s.first}</td><td class="num muted">${s.last}</td><td><button class="star on" style="opacity:1" data-chart="NSE/${esc(s.symbol)}" title="Chart">${ICON.chart}</button></td></tr>`).join("")}</tbody></table></div></div>`;
}
function dataHTML(S, acc, importBtn) {
  const block = (kind, label) => { const d = S[kind]; return `<div class="card" style="--i:1"><div class="card-h"><h3>${label}</h3><span class="muted">${d.rows ? `${d.rows.toLocaleString("en-IN")} rows · ${d.from} → ${d.to}` : "nothing imported"}</span></div>
      ${d.fys.length ? `<div class="tbl-wrap"><table><thead><tr><th>Financial year</th><th>Rows</th><th>Status</th></tr></thead><tbody>${d.fys.map(f => `<tr><td>${esc(f.fy)}</td><td class="num">${f.rows.toLocaleString("en-IN")}</td><td>${f.archived ? `<span class="chip ok">archived · protected</span>` : `<span class="chip open">current · refreshed on import</span>`}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${d.last_import ? `<div class="hint" style="padding:10px 16px 14px">Last import ${esc(d.last_import.at.replace("T", " "))} · ${esc(d.last_import.file || "")} · ${d.last_import.added} added, ${d.last_import.removed} replaced${d.last_import.skipped_archived ? `, ${d.last_import.skipped_archived} skipped (archived FY)` : ""}</div>` : ""}</div>`; };
  return `<div class="banner"><div class="ic">${ICON.plus}</div><div><b>Import a statement for ${esc(acc.name)}</b><span>Console → Funds → Statement → Ledger (CSV), and Console → Reports → Tradebook (CSV). Upload the current FY any time; ended FYs are archived and never overwritten.</span></div>${importBtn}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr">${block("ledger", "Ledger")}${block("trades", "Tradebook")}</div>`;
}

/* import dialog: pick account, drop CSVs, preview, confirm */
function importDialog(defaultAcc) {
  const accs = accounts();
  if (!accs.length) return toast("Add an account first", true);
  let files = [];
  const render = (msg) => {
    modal(`<h3>Import statements</h3><div class="sub">Zerodha Console CSVs: Ledger and Tradebook. The file is read in your browser and stored only in this app’s data folder.</div>
      ${msg ? `<div class="err" style="${msg.ok ? "background:var(--up-soft);color:var(--up)" : ""}">${esc(msg.text)}</div>` : ""}
      <div class="field"><label>Account</label><select name="acc" class="sel" id="imp-acc">${accs.map(a => `<option value="${a.id}" ${a.id === defaultAcc ? "selected" : ""}>${esc(a.name)} · ${esc(a.user_id)}</option>`).join("")}</select></div>
      <div class="drop" id="drop">${ICON.plus}<div>Drop CSV files here or <label class="link">browse<input type="file" id="imp-file" accept=".csv,text/csv" multiple hidden></label></div><div class="hint">Ledger and tradebook can be dropped together. Filenames like ledger-AB1234.csv are matched to the account automatically.</div></div>
      <div id="imp-list">${files.map((f, i) => `<div class="imp-row"><div><b>${esc(f.name)}</b> <span class="chip">${f.kind || "?"}</span> ${f.preview ? `<span class="muted">${f.preview.rows.toLocaleString("en-IN")} rows · ${f.preview.from} → ${f.preview.to}</span>` : ""}
          ${f.preview ? `<div class="hint">${f.preview.fys_new.length ? `Will refresh ${f.preview.fys_new.map(esc).join(", ")} (${f.preview.replaces} stored rows in this range replaced).` : ""} ${f.preview.fys_archived.length ? `<span class="down">Skips archived ${f.preview.fys_archived.map(esc).join(", ")}</span> unless you tick “also replace archived years”.` : ""} ${f.preview.client_hint && !accs.find(a => a.id === $("#imp-acc")?.value)?.user_id.includes(f.preview.client_hint) ? `<span class="down">File looks like it belongs to ${esc(f.preview.client_hint)}.</span>` : ""}</div>` : ""}${f.error ? `<div class="hint down">${esc(f.error)}</div>` : ""}</div>
          <button class="btn ghost" data-rm="${i}">✕</button></div>`).join("")}</div>
      <label class="hint" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="imp-force"> Also replace archived (ended) financial years with this file’s rows</label>
      <div class="row"><button type="button" class="btn ghost" data-cancel>Close</button><button type="button" class="btn primary" id="imp-go" ${files.some(f => f.preview) ? "" : "disabled"}>Import ${files.filter(f => f.preview).length || ""} file${files.filter(f => f.preview).length === 1 ? "" : "s"}</button></div>`);
    const drop = $("#drop");
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
    $("#imp-file").addEventListener("change", e => addFiles(e.target.files));
    $("#imp-acc").addEventListener("change", () => previewAll());
    $("#imp-list").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) { files.splice(+b.dataset.rm, 1); render(); } });
    $("#imp-go").addEventListener("click", doImport);
  };
  const accId = () => $("#imp-acc").value;
  async function addFiles(list) {
    for (const f of list) { const text = await f.text(); files.push({ name: f.name, text, kind: null, preview: null, error: null }); }
    // auto-pick the account from the filename (ledger-AB1234.csv)
    const m = files.map(f => f.name.match(/\b([A-Z]{2}\d{4})\b/)).find(Boolean);
    if (m) { const a = accs.find(a => a.user_id === m[1]); if (a) $("#imp-acc").value = a.id; }
    await previewAll();
  }
  async function previewAll() {
    for (const f of files) {
      try { const p = await api(`/api/history/${accId()}/preview`, { method: "POST", body: JSON.stringify({ text: f.text, filename: f.name }) }); f.kind = p.kind; f.preview = p; f.error = null; }
      catch (e) { f.kind = null; f.preview = null; f.error = e.message; }
    }
    render();
  }
  async function doImport() {
    const force = $("#imp-force").checked, id = accId(); const results = [];
    for (const f of files.filter(f => f.preview)) {
      try { const r = await api(`/api/history/${id}/import`, { method: "POST", body: JSON.stringify({ text: f.text, filename: f.name, kind: f.kind, replace_archived: force }) }); results.push(`${f.name}: ${r.added} added, ${r.removed} replaced${r.skipped_archived ? `, ${r.skipped_archived} skipped` : ""}`); }
      catch (e) { results.push(`${f.name}: ${e.message}`); }
    }
    files = []; delete state.hist[id]; state.histOverview = null;
    render({ ok: true, text: results.join(" · ") });
    if (state.section === "history") renderMain();
  }
  render();
}

function onboardHTML() {
  return `<div class="onboard"><h2>Every account, <em style="color:var(--accent);font-style:italic">one ledger.</em></h2>
    <p>Add each family member once. Every morning you log them all in from here, one popup each, and see holdings, P&amp;L, positions, orders and funds for everyone in a single place.</p>
    <ol><li>Each person creates a free <b>Personal</b> app at <code>developers.kite.trade</code> (one minute, one time).</li>
      <li>Click <b>Add account</b> and paste that app’s API key and secret.</li>
      <li>No app yet? You can still add the account and paste an <code>enctoken</code> from a logged-in Kite tab.</li></ol>
    <div><button class="btn primary" data-act="add">${ICON.plus} Add first account</button></div></div>`;
}

/* ------------------------------------------------------------ modals */
const modalRoot = $("#modal-root");
function closeModal() { modalRoot.innerHTML = ""; }
function modal(html) { modalRoot.innerHTML = `<div class="scrim" data-close><div class="modal">${html}</div></div>`; }
modalRoot.addEventListener("click", e => { if (e.target.hasAttribute("data-close") || e.target.closest("[data-cancel]")) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && modalRoot.firstChild) closeModal(); });

/* login queue: Kite Connect popup when an API key is saved, otherwise enctoken / TOTP */
function waitForPopup(win) {
  return new Promise(resolve => {
    const onMsg = (e) => { if (e.data?.type === "kc-login") { cleanup(); resolve(e.data); } };
    const poll = setInterval(() => { if (win && win.closed) { cleanup(); resolve({ ok: false, closed: true }); } }, 600);
    const cleanup = () => { window.removeEventListener("message", onMsg); clearInterval(poll); };
    window.addEventListener("message", onMsg);
  });
}
async function loginFlow(ids) {
  const queue = ids.map(id => ({ id, acc: accById(id), status: "wait" }));
  const queueHTML = (cur) => queue.length > 1 ? `<div class="queue">${queue.map(q => `<span class="${q.status === "done" ? "done" : q.status === "fail" ? "fail" : q === cur ? "cur" : ""}">${q.status === "done" ? "✓" : q.status === "fail" ? "✕" : q === cur ? "→" : "·"} ${esc(q.acc.name)}</span>`).join("")}</div>` : "";
  const head = (cur, sub) => `<h3>Login · ${esc(cur.acc.name)}</h3><div class="sub num">${esc(cur.acc.user_id)}${sub ? " · " + sub : ""}</div>${queueHTML(cur)}`;

  const askKC = (cur, err) => new Promise(resolve => {
    modal(`${head(cur, "Kite Connect")}${err ? `<div class="err">${esc(err)}</div>` : ""}
      <p class="hint" style="color:var(--ink-2);font-size:13px;margin:0 0 14px">A small Kite window opens. Sign in as <b>${esc(cur.acc.user_id)}</b> (password, TOTP and any CAPTCHA happen there, never here). It closes itself when done.</p>
      <div class="row"><button type="button" class="btn ghost left" data-skip>Skip</button><button type="button" class="btn ghost" data-cancel>Cancel</button><button type="button" class="btn primary" data-open>${ICON.key} Open Kite login</button></div>
      <div class="alt">Or <button type="button" data-enc>paste an enctoken</button> instead.</div>`);
    $("[data-skip]").onclick = () => resolve({ skip: true });
    $("[data-enc]").onclick = () => resolve({ manual: true });
    $("[data-open]").onclick = async () => {
      if (cur.acc.browser_profile) {
        // server opens the login in that person's own browser profile; we poll until the session appears
        try { await api(`/api/accounts/${cur.id}/kc_launch`, { method: "POST" }); } catch (e) { return resolve({ error: e.message }); }
        const pname = (state.profiles || []).find(p => p.id === cur.acc.browser_profile);
        modal(`${head(cur, "Kite Connect")}<p class="hint" style="color:var(--ink-2);font-size:13px">Opened the Kite login in <b>${esc(pname ? pname.browser + " · " + pname.name : cur.acc.browser_profile)}</b>. Finish signing in there, then come back; this closes by itself.</p><div class="skel" style="height:8px"></div><div class="row"><button type="button" class="btn ghost left" data-skip>Skip</button><button type="button" class="btn ghost" data-cancel>Cancel</button></div>`);
        $("[data-skip]").onclick = () => { stop = true; resolve({ skip: true }); };
        let stop = false;
        for (let i = 0; i < 90 && !stop && modalRoot.firstChild; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const accs = await api("/api/accounts").catch(() => []);
          if (accs.find(a => a.id === cur.id)?.logged_in) return resolve({ ok: true });
        }
        if (!stop) resolve({ error: modalRoot.firstChild ? "Timed out waiting for the login (3 minutes)." : "cancelled" });
        return;
      }
      // Kite reuses whatever session the browser already holds (the previous family member), so sign that out first,
      // then load this account's Connect login page in the same popup.
      const w = window.open("https://kite.zerodha.com/logout", "kite-login", "width=540,height=760,menubar=no,toolbar=no");
      if (!w) return resolve({ error: "Popup blocked — allow popups for this site and try again." });
      setTimeout(() => { try { w.location.href = `/api/accounts/${cur.id}/kc_login`; } catch (e) {} }, 1500);
      modal(`${head(cur, "Kite Connect")}<p class="hint" style="color:var(--ink-2);font-size:13px">Waiting for the Kite window… Kite shows the <i>last</i> user ID it saw. If it is not <b class="num" style="color:var(--ink)">${esc(cur.acc.user_id)}</b>, click <b>Change user</b> in the Kite window and enter this ID. <button type="button" class="btn ghost" style="padding:2px 8px" onclick="navigator.clipboard.writeText('${esc(cur.acc.user_id)}');this.textContent='Copied'">Copy ID</button></p><div class="skel" style="height:8px"></div><div class="row"><button type="button" class="btn ghost" data-cancel>Cancel</button></div>`);
      waitForPopup(w).then(r => resolve(r.ok ? { ok: true } : { error: r.closed ? "Kite window was closed before login finished." : (r.message || "Login failed") }));
    };
  });

  const askManual = (cur, err) => new Promise(resolve => {
    const canTotp = cur.acc.has_password;
    modal(`${head(cur)}${err ? `<div class="err">${esc(err)}</div>` : ""}
      <form id="ef"><div class="field"><label>enctoken <small>from a logged-in Kite tab</small></label><input name="enc" autofocus autocomplete="off" placeholder="paste here" class="num">
        <div class="hint">Log in to kite.zerodha.com as ${esc(cur.acc.user_id)} → DevTools (⌥⌘I) → Application → Cookies → kite.zerodha.com → copy the <b>enctoken</b> value.</div></div>
      <div class="row"><button type="button" class="btn ghost left" data-skip>Skip</button><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Use token</button></div></form>
      <div class="alt">${cur.acc.has_api ? `<button type="button" data-kc>Use Kite Connect login</button>` : ""}${cur.acc.has_api && canTotp ? " · " : ""}${canTotp ? `<button type="button" data-totp>Login with password + TOTP</button>` : ""}</div>`);
    $("#ef").addEventListener("submit", e => { e.preventDefault(); resolve({ enctoken: e.target.enc.value.trim() }); });
    $("[data-skip]").onclick = () => resolve({ skip: true });
    $("[data-kc]") && ($("[data-kc]").onclick = () => resolve({ kc: true }));
    $("[data-totp]") && ($("[data-totp]").onclick = () => {
      modal(`${head(cur, "password + TOTP")}<div class="err" style="background:var(--accent-soft);color:var(--accent)">Kite often blocks scripted password logins with a CAPTCHA. If this fails, use Kite Connect or an enctoken.</div>
        <form id="lf"><div class="field"><label>Authenticator code</label><input class="otp" name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="••••••" autofocus ${cur.acc.has_totp_secret ? "" : "required"}></div>
        <div class="row"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Login</button></div></form>`);
      const f = $("#lf"); f.totp.addEventListener("input", () => { if (f.totp.value.length === 6) f.requestSubmit(); });
      f.addEventListener("submit", e => { e.preventDefault(); resolve({ totp: f.totp.value }); });
    });
  });

  for (const item of queue) {
    let err = null, mode = item.acc.has_api ? "kc" : "manual";
    while (true) {
      if (!modalRoot.firstChild && err === null && mode === "x") break;
      const ans = mode === "kc" ? await askKC(item, err) : await askManual(item, err);
      if (ans.skip) { item.status = "fail"; break; }
      if (ans.manual) { mode = "manual"; err = null; continue; }
      if (ans.kc) { mode = "kc"; err = null; continue; }
      if (ans.error) { err = ans.error; continue; }
      if (ans.ok) { item.status = "done"; break; }
      modal(`${head(item)}<div class="sub">Signing in…</div><div class="skel" style="height:8px"></div>`);
      const body = ans.enctoken ? { enctoken: ans.enctoken } : { totp: ans.totp };
      const r = await api(`/api/accounts/${item.id}/login`, { method: "POST", body: JSON.stringify(body) }).catch(e => e);
      if (!(r instanceof Error)) { item.status = "done"; break; }
      err = r.message;
    }
    if (!modalRoot.firstChild) break; // user hit cancel / escape
  }
  closeModal();
  const ok = queue.filter(q => q.status === "done").length;
  if (ok) toast(`Logged in ${ok} account${ok > 1 ? "s" : ""}`);
  await load(true);
}

function accountForm(acc) {
  const a = acc || { name: "", user_id: "", color: ((accounts().length) % 8) + 1 };
  const redirect = state.config.redirect_url || location.origin + "/api/kc/callback";
  modal(`<h3>${acc ? "Edit account" : "Add account"}</h3><div class="sub">Stored locally in data/accounts.json (mode 600). Nothing leaves this Mac except calls to Zerodha.</div>
    <form id="af">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>Display name</label><input name="name" value="${esc(a.name)}" placeholder="e.g. Papa" required autofocus></div>
        <div class="field"><label>Kite user ID</label><input name="user_id" value="${esc(a.user_id)}" placeholder="AB1234" required style="text-transform:uppercase" class="num"></div>
      </div>
      <div class="field"><label>Colour</label><div class="swatches">${[1,2,3,4,5,6,7,8].map(c => `<button type="button" data-c="${c}" class="${c === a.color ? "on" : ""}" style="--c:${colorVar(c)}"></button>`).join("")}</div></div>

      <div class="rail-label" style="padding:10px 0 6px">Kite Connect <span style="color:var(--up)">· recommended</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>API key</label><input name="api_key" value="${esc(a.api_key || "")}" autocomplete="off" class="num"></div>
        <div class="field"><label>API secret ${acc?.has_api ? "<small>saved</small>" : ""}</label><input name="api_secret" type="password" autocomplete="new-password" class="num" placeholder="${acc?.has_api ? "leave blank to keep" : ""}"></div>
      </div>
      <div class="field"><label>Open Kite login in <small>browser profile · optional</small></label>
        <select name="browser_profile" class="sel"><option value="">This window (popup)</option>${(state.profiles || []).map(p => `<option value="${esc(p.id)}" ${a.browser_profile === p.id ? "selected" : ""}>${esc(p.browser)} · ${esc(p.name)}</option>`).join("")}</select>
        <div class="hint">Give each person their own browser profile and Kite will remember the right user ID for them. Create profiles from the browser’s profile menu, then pick it here.</div></div>
      <div class="hint" style="margin:-4px 0 12px">Free: this person signs in at <b>developers.kite.trade</b> → <i>Create new app</i> → type <b>Personal</b>, Zerodha client ID <b>${esc(a.user_id || "their ID")}</b>, redirect URL <b class="num" style="user-select:all">${esc(redirect)}</b>. Copy the API key and secret here. Login is then a popup, no password stored.</div>

      <details><summary style="cursor:pointer;color:var(--ink-3);font-size:12.5px">Fallback: password + TOTP (often blocked by Kite's CAPTCHA)</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div class="field"><label>Password ${acc?.has_password ? "<small>saved</small>" : ""}</label><input name="password" type="password" autocomplete="new-password"></div>
          <div class="field"><label>TOTP secret ${acc?.has_totp_secret ? "<small>saved</small>" : ""}</label><input name="totp_secret" autocomplete="off" placeholder="Base32 key" class="num"></div>
        </div></details>
      <div class="row">${acc ? `<button type="button" class="btn ghost danger left" data-del>Remove</button>` : ""}<button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">${acc ? "Save" : "Add account"}</button></div>
    </form>`);
  let color = a.color;
  $(".swatches").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; color = +b.dataset.c; $(".swatches .on")?.classList.remove("on"); b.classList.add("on"); });
  const f = $("#af");
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    try {
      await api("/api/accounts", { method: "POST", body: JSON.stringify({ ...fd, id: acc?.id, color }) });
      closeModal(); toast(acc ? "Account saved" : "Account added"); await load(true);
    } catch (err) { f.insertAdjacentHTML("afterbegin", `<div class="err">${esc(err.message)}</div>`); }
  });
  $("[data-del]")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed) { await api(`/api/accounts/${acc.id}`, { method: "DELETE" }); closeModal(); state.selected = "all"; toast("Account removed"); await load(true); return; }
    b.dataset.armed = "1"; b.textContent = "Click again to confirm removal";
  });
}

/* ------------------------------------------------------------ api / load */
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const d = body.detail; throw new Error(typeof d === "object" ? d.message : d || r.statusText); }
  return body;
}
async function load(force = false) {
  state.loading = true; renderMain();
  try { state.overview = await api("/api/overview" + (force ? "?force=1" : "")); }
  catch (e) { toast("Could not reach the local server: " + e.message, true); }
  state.loading = false; render();
  loadWatch();
  if (state.section === "indices") loadIndices();
}
function applyPrivacy() { document.documentElement.classList.toggle("priv", state.privacy); }
function render() { renderRail(); if (!(state.section === "screener" && $("#tv-screener iframe"))) renderMain(); history.replaceState(null, "", `#a=${encodeURIComponent(state.selected)}&s=${state.section}`); }

let toastT;
function toast(msg, bad = false) { const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }

/* ------------------------------------------------------------ events */
document.addEventListener("click", async e => {
  if (!e.target.closest(".menu")) document.querySelectorAll(".menu.open").forEach(m => m.classList.remove("open"));
  const sel = e.target.closest("[data-sel]");
  if (sel) { state.selected = sel.dataset.sel; localStorage.setItem("fl.sel", state.selected); state.q = ""; state.capFilter = null; state.accFilter = null; render(); return; }
  const tab = e.target.closest("[data-sec]");
  if (tab) { state.section = tab.dataset.sec; render(); return; }
  const th = e.target.closest("th[data-sort]");
  if (th) { const k = th.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "symbol" ? 1 : -1) }; renderMain(); return; }
  const row = e.target.closest("tr.exp");
  if (row && !e.target.closest("button, a")) { const s = row.dataset.sym; state.expanded.has(s) ? state.expanded.delete(s) : state.expanded.add(s); renderMain(); return; }
  const seg = e.target.closest(".chart [data-i]");
  if (seg) {
    const chart = seg.closest(".chart"), items = JSON.parse(chart.dataset.items), it = items[+seg.dataset.i], kind = chart.dataset.kind;
    if (kind === "cap") state.capFilter = state.capFilter === it.k ? null : it.k;
    else if (kind === "acc") state.accFilter = state.accFilter === it.k ? null : it.k;
    else if (kind === "sym" && it.k) state.q = state.q.toUpperCase() === it.k ? "" : it.k;
    else return;
    renderMain(); return;
  }
  const clr = e.target.closest("[data-clear]");
  if (clr) { if (clr.dataset.clear === "cap") state.capFilter = null; else state.accFilter = null; renderMain(); return; }
  const hv = e.target.closest("[data-hview]");
  if (hv) { state.histView = hv.dataset.hview; state.q = ""; renderMain(); return; }
  const ic = e.target.closest("[data-idxchart]");
  if (ic) { e.stopPropagation(); const r = state.indices.items.find(x => x.name === ic.dataset.idxchart); return openChart("NSE", r.name, r.name, { tv: r.tv, row: { symbol: r.name, name: r.name, last_price: r.last, close_price: r.close, instrument_token: r.instrument_token, holders: [] } }); }
  if (e.target.closest('[data-act="idxrefresh"]')) { state.indices = null; renderMain(); loadIndices(true); return; }
  const ch = e.target.closest("[data-chart]");
  if (ch) { e.stopPropagation(); const [ex, sym] = ch.dataset.chart.split("/"); return openChart(ex, sym, ch.dataset.name || ""); }
  const star = e.target.closest("[data-watch]");
  if (star) { e.stopPropagation(); const s = star.dataset.watch; if (star.closest(".modal")) star.textContent = isWatched(s) ? "☆ Watch" : "★ Watching"; return isWatched(s) ? watchMutate("DELETE", `/api/watchlist/NSE/${encodeURIComponent(s)}`) : watchMutate("POST", "/api/watchlist", { symbol: s, exchange: "NSE" }); }
  const un = e.target.closest("[data-unwatch]");
  if (un) { const [ex, sym] = un.dataset.unwatch.split("/"); return watchMutate("DELETE", `/api/watchlist/${ex}/${encodeURIComponent(sym)}`); }
  const ws = e.target.closest("th[data-wsort]");
  if (ws) { const k = ws.dataset.wsort; state.watchSort = { key: k, dir: state.watchSort.key === k ? -state.watchSort.dir : (k === "symbol" ? 1 : -1) }; renderMain(); return; }
  const sg = e.target.closest("[data-sg]");
  if (sg) { const s = state.sugg[+sg.dataset.sg]; state.sugg = []; state.suggIdx = -1; return watchMutate("POST", "/api/watchlist", { symbol: s.symbol, exchange: s.exchange, name: s.name }); }
  if (!e.target.closest(".addwrap") && state.sugg.length) { state.sugg = []; state.suggIdx = -1; renderMain(); }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  switch (act.dataset.act) {
    case "refresh": return load(true);
    case "add": return accountForm(null);
    case "edit": return accountForm(accById(act.dataset.id));
    case "login": return loginFlow(act.dataset.ids.split(","));
    case "loginall": { const ids = accounts().filter(a => !a.snapshot || a.snapshot.error === "not_logged_in" || a.snapshot.error === "session_expired").map(a => a.id); return ids.length ? loginFlow(ids) : toast("All accounts are already logged in"); }
    case "logout": await api(`/api/accounts/${act.dataset.id}/logout`, { method: "POST" }); toast("Logged out"); return load(true);
    case "auto": state.auto = !state.auto; localStorage.setItem("fl.auto", state.auto ? "1" : "0"); schedule(); return renderRail();
    case "stop": {
      if (!act.dataset.armed) { act.dataset.armed = "1"; act.innerHTML = `${ICON.power} Click again to stop`; act.style.color = "var(--down)"; setTimeout(() => { if (act.isConnected) renderRail(); }, 4000); return; }
      await api("/api/shutdown", { method: "POST" }).catch(() => {});
      document.body.innerHTML = `<div class="onboard"><h2>Server stopped.</h2><p>Run <code>./run.sh</code> to start it again. You can close this tab.</p></div>`;
      return;
    }
    case "openkite": { try { await api(`/api/accounts/${act.dataset.id}/open_kite`, { method: "POST" }); toast("Opening Kite in " + (accById(act.dataset.id)?.name || "") + "’s browser profile"); } catch (e) { toast(e.message, true); } return; }
    case "privacy": { state.privacy = !state.privacy; localStorage.setItem("fl.privacy", state.privacy ? "1" : "0"); applyPrivacy(); renderMain(); renderRail(); return; }
    case "import": return importDialog(state.selected === "all" ? accounts()[0]?.id : state.selected);
    case "rail": { const h = document.documentElement; h.dataset.rail = h.dataset.rail === "collapsed" ? "" : "collapsed"; localStorage.setItem("fl.rail", h.dataset.rail); return renderRail(); }
    case "menu": { act.closest(".menu").classList.toggle("open"); return; }
    case "theme": { const h = document.documentElement; h.dataset.theme = h.dataset.theme === "light" ? "dark" : "light"; localStorage.setItem("fl.theme", h.dataset.theme); renderRail(); if (state.section === "screener") renderMain(); return; }
  }
});
let suggT;
document.addEventListener("input", e => {
  if (e.target.id === "addsym") {
    const v = e.target.value.trim(); clearTimeout(suggT);
    if (!v) { state.sugg = []; renderMain(); return; }
    suggT = setTimeout(async () => { const r = await api("/api/instruments/search?q=" + encodeURIComponent(v)).catch(() => []); state.sugg = r; state.suggIdx = r.length ? 0 : -1; const pos = $("#addsym").selectionStart; renderMain(); const i = $("#addsym"); i.value = v; i.focus(); i.setSelectionRange(pos, pos); }, 160);
    return;
  }
  if (e.target.id === "q") { state.q = e.target.value; const pos = e.target.selectionStart; renderMain(); const i = $("#q"); i.focus(); i.setSelectionRange(pos, pos); } });
document.addEventListener("keydown", e => {
  if (e.target.id === "addsym") {
    if (e.key === "ArrowDown" && state.sugg.length) { e.preventDefault(); state.suggIdx = (state.suggIdx + 1) % state.sugg.length; $$sugg(); }
    else if (e.key === "ArrowUp" && state.sugg.length) { e.preventDefault(); state.suggIdx = (state.suggIdx - 1 + state.sugg.length) % state.sugg.length; $$sugg(); }
    else if (e.key === "Enter") { e.preventDefault(); const s = state.sugg[state.suggIdx] || (e.target.value.trim() && { symbol: e.target.value.trim().toUpperCase(), exchange: "NSE", name: "" }); if (s) { state.sugg = []; state.suggIdx = -1; watchMutate("POST", "/api/watchlist", { symbol: s.symbol, exchange: s.exchange, name: s.name }).then(() => $("#addsym")?.focus()); } }
    else if (e.key === "Escape") { state.sugg = []; state.suggIdx = -1; renderMain(); }
    return;
  }
  if (e.target.classList?.contains("note")) { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.target.value = e.target.defaultValue; e.target.blur(); } return; }
  if (modalRoot.firstChild || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") { if (e.key === "Escape") { e.target.blur(); state.q = ""; renderMain(); } return; }
  if (e.key === "/") { e.preventDefault(); $("#q")?.focus(); }
  else if (e.key === "r") load(true);
  else if (e.key === "l") $('[data-act="loginall"]')?.click();
  else if (e.key === "[") $('[data-act="rail"]')?.click();
  else if (e.key === "h") $('[data-act="privacy"]')?.click();
  else if (e.key === "0") { state.selected = "all"; render(); }
  else if (/^[1-9]$/.test(e.key)) { const a = accounts()[+e.key - 1]; if (a) { state.selected = a.id; localStorage.setItem("fl.sel", a.id); render(); } }
});

function $$sugg() { document.querySelectorAll(".sg").forEach((el, i) => el.classList.toggle("on", i === state.suggIdx)); }
document.addEventListener("focusout", e => {
  if (e.target.classList?.contains("note") && e.target.value !== e.target.defaultValue) {
    const [ex, sym] = e.target.dataset.note.split("/"); watchMutate("PUT", `/api/watchlist/${ex}/${encodeURIComponent(sym)}`, { note: e.target.value });
  }
});

/* tooltips + donut hover (event delegation) */
const tip = $("#tooltip");
function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(x + 14, innerWidth - w - 8) + "px"; tip.style.top = (y - h - 12 < 0 ? y + 16 : y - h - 12) + "px"; }
document.addEventListener("mousemove", e => {
  const t = e.target.closest("[data-tip]");
  if (t) return showTip(t.dataset.tip, e.clientX, e.clientY);
  const seg = e.target.closest(".chart [data-i]");
  const chart = e.target.closest(".chart");
  document.querySelectorAll(".chart .on").forEach(el => el.classList.remove("on"));
  document.querySelectorAll(".donut.hovering").forEach(el => el.classList.remove("hovering"));
  if (seg && chart) {
    const i = +seg.dataset.i, items = JSON.parse(chart.dataset.items), total = items.reduce((s, x) => s + x.v, 0);
    chart.querySelectorAll(`[data-i="${i}"]`).forEach(el => el.classList.add("on"));
    chart.querySelector(".donut").classList.add("hovering");
    return showTip(`<b>${esc(items[i].l)}</b><span class="num">${inr(items[i].v)} · ${(items[i].v / total * 100).toFixed(1)}%</span>`, e.clientX, e.clientY);
  }
  tip.hidden = true;
});

/* coming back from a Kite login tab (phones open it as a tab, not a popup): pick up the new session */
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.overview) load(true); });
window.addEventListener("message", e => { if (e.data?.type === "kc-login" && !modalRoot.firstChild) load(true); });

/* auto refresh: every 45s while the tab is visible */
function schedule() { clearInterval(state.timer); if (state.auto) state.timer = setInterval(() => { if (!document.hidden && !modalRoot.firstChild) load(false); }, 45000); }
setInterval(() => { const el = $(".topbar .live"); if (el && state.overview) { const f = Math.max(0, ...liveAccounts().map(a => a.snapshot.fetched_at || 0)); if (f) el.innerHTML = `<i></i>updated ${timeAgo(f)}`; } }, 10000);

/* ------------------------------------------------------------ boot */
(async () => {
  const th = localStorage.getItem("fl.theme"); if (th) document.documentElement.dataset.theme = th;
  if (localStorage.getItem("fl.rail") === "collapsed") document.documentElement.dataset.rail = "collapsed";
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get("theme")) document.documentElement.dataset.theme = hp.get("theme");
  if (hp.get("a")) state.selected = hp.get("a");
  if (hp.get("s")) state.section = hp.get("s");
  if (hp.get("add")) setTimeout(() => accountForm(null), 400);
  if (hp.get("cap")) state.capFilter = hp.get("cap");
  if (hp.get("hide")) state.privacy = true;
  applyPrivacy();
  if (hp.get("rail") === "collapsed") document.documentElement.dataset.rail = "collapsed";
  if (hp.get("menu")) setTimeout(() => $(".menu")?.classList.add("open"), 3500);
  if (hp.get("chart")) setTimeout(() => openChart("NSE", hp.get("chart")), 800);
  state.config = await api("/api/config").catch(() => ({}));
  state.profiles = await api("/api/browser/profiles").catch(() => []);
  loadCaps();
  renderRail(); renderMain();
  await load(false);
  schedule();
})();
})();
