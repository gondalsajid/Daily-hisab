/*
 * Personal Financial Transaction System — Frontend
 * Files: index.html, style.css, app.js
 *
 * Backend contract (Google Apps Script Web App) expected by this frontend:
 * POST JSON: { action: "login", username, password }
 * POST JSON: { action: "logout", token }
 * POST JSON for all other actions includes token.
 * Successful JSON: { success: true, data: ... , message?: "..." }
 * Failed JSON: { success: false, message: "..." }
 *
 * Required actions:
 * getDashboard, listPeople, savePerson, deletePerson, getPersonLedger,
 * listTransactions, saveTransaction, deleteTransaction,
 * listTemporaryTransactions, saveTemporaryTransaction, deleteTemporaryTransaction,
 * finalizeTemporaryTransaction, listNotes, saveNote, deleteNote,
 * exportTransactionPdf, exportPersonLedgerPdf, exportNotePdf, exportNotesPdf
 *
 * PDF action response: { success:true, data:{ fileName:"report.pdf", mimeType:"application/pdf", base64:"..." } }
 * No sample/dummy financial data is included. The app displays empty states until the backend returns real records.
 */

(() => {
  "use strict";

  // Replace this value with the deployed Google Apps Script Web App URL when backend is ready.
    let API_URL = window.__PFTS_API_URL || "https://script.google.com/macros/s/AKfycbxSEbnCpuxFxKaFpibsHaOMYGwd9fw7z6aJOldtGNLI4HfWuIIZcXEDfgTKXRws32jb/exec";
  const APP_NAME = "ذاتی مالیاتی ریکارڈ";

  const state = {
    token: "",
    user: null,
    page: "dashboard",
    dashboard: null,
    people: [],
    transactions: [],
    temporaryTransactions: [],
    notes: [],
    selectedPerson: null,
    ledger: null,
    search: { people: "", transactions: "", temporary: "", notes: "" },
    busy: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const money = value => {
    const amount = Number(value || 0);
    return "PKR " + new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(amount);
  };
  const dateText = value => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return escapeHtml(value);
    return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const setBusy = value => {
    state.busy = value;
    $$("button[data-server-action]").forEach(button => button.disabled = value);
  };

  async function apiRequest(action, payload = {}, options = {}) {
    if (!API_URL || API_URL.includes("PASTE_YOUR_")) {
      throw new Error("بیک اینڈ ابھی منسلک نہیں ہے۔ پہلے Google Apps Script Web App URL درج کریں۔");
    }
    const body = { action, ...payload };
    if (action !== "login" && state.token) body.token = state.token;
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`سرور سے رابطے میں مسئلہ (${response.status})`);
    const result = await response.json();
    if (!result || result.success !== true) throw new Error(result?.message || "درخواست مکمل نہیں ہو سکی۔");
    return result.data ?? {};
  }

  function toast(message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast ${type === "error" ? "error" : type === "success" ? "success" : ""}`;
    node.textContent = message;
    $("#toast-region").appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  function showConfirm(title, message, acceptText = "تصدیق کریں") {
    return new Promise(resolve => {
      const dialog = $("#confirm-dialog");
      $("#confirm-title").textContent = title;
      $("#confirm-message").textContent = message;
      $("#confirm-accept").textContent = acceptText;
      const onClose = () => {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "ok");
      };
      dialog.addEventListener("close", onClose);
      dialog.showModal();
    });
  }

  function loading(text = "لوڈ ہو رہا ہے...") {
    return `<div class="loading-inline"><span class="spinner"></span><span>${escapeHtml(text)}</span></div>`;
  }

  function renderLogin(message = "") {
    $("#app").innerHTML = `
      <main class="login-wrap">
        <section class="login-card">
          <div class="login-brand">
            <div><h1>${APP_NAME}</h1><p class="muted">ذاتی مالی لین دین اور نوٹس</p></div>
          </div>
          ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
          <form id="login-form">
            <div class="field"><label for="username">یوزر نیم</label><input id="username" name="username" autocomplete="username" required></div>
            <div class="field" style="margin-top:13px"><label for="password">پاس ورڈ</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit" data-server-action>لاگ اِن</button></div>
          </form>
          <p class="muted" style="font-size:.8rem;margin-top:16px">لاگ اِن کے لیے Google Apps Script بیک اینڈ ضروری ہے۔</p>
        </section>
      </main>`;
    $("#login-form").addEventListener("submit", login);
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    button.textContent = "لاگ اِن ہو رہا ہے...";
    try {
      const data = await apiRequest("login", { username, password });
      if (!data.token) throw new Error("بیک اینڈ نے لاگ اِن ٹوکن واپس نہیں کیا۔");
      state.token = data.token;
      state.user = data.user || { username };
      await refreshAll();
      renderApp();
      toast("لاگ اِن کامیاب ہو گیا۔");
    } catch (error) {
      renderLogin(error.message);
    }
  }

  async function logout() {
    const ok = await showConfirm("لاگ آؤٹ", "کیا آپ واقعی لاگ آؤٹ کرنا چاہتے ہیں؟", "لاگ آؤٹ");
    if (!ok) return;
    try { await apiRequest("logout"); } catch (_) { /* Local logout must still be possible. */ }
    state.token = "";
    state.user = null;
    state.dashboard = null;
    state.people = [];
    state.transactions = [];
    state.temporaryTransactions = [];
    state.notes = [];
    state.selectedPerson = null;
    renderLogin();
  }

  async function refreshAll() {
    setBusy(true);
    try {
      const [dashboard, people, transactions, temporary, notes] = await Promise.all([
        apiRequest("getDashboard"),
        apiRequest("listPeople", { search: state.search.people }),
        apiRequest("listTransactions", { search: state.search.transactions }),
        apiRequest("listTemporaryTransactions", { search: state.search.temporary }),
        apiRequest("listNotes", { search: state.search.notes })
      ]);
      state.dashboard = dashboard || {};
      state.people = Array.isArray(people.items) ? people.items : Array.isArray(people) ? people : [];
      state.transactions = Array.isArray(transactions.items) ? transactions.items : Array.isArray(transactions) ? transactions : [];
      state.temporaryTransactions = Array.isArray(temporary.items) ? temporary.items : Array.isArray(temporary) ? temporary : [];
      state.notes = Array.isArray(notes.items) ? notes.items : Array.isArray(notes) ? notes : [];
    } finally {
      setBusy(false);
    }
  }

  const navItems = [
    ["dashboard", "⌂", "ڈیش بورڈ"],
    ["people", "♙", "افراد / کھاتے"],
    ["transactions", "⇄", "مین ٹرانزیکشنز"],
    ["temporary", "▤", "عارضی ٹرانزیکشنز"],
    ["notebook", "✎", "ڈیجیٹل نوٹ بک"]
  ];

  function renderNav(className = "nav-list") {
    return `<nav class="${className}" aria-label="مین مینو">${navItems.map(([id, icon, label]) =>
      `<button class="nav-btn ${state.page === id ? "active" : ""}" data-nav="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`
    ).join("")}</nav>`;
  }

  function renderApp() {
    $("#app").innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-brand"><div class="topbar-title"><strong>${APP_NAME}</strong><small>مالی ریکارڈ، عارضی نوٹس اور ڈیجیٹل نوٹ بک</small></div></div>
          <div class="topbar-actions"><button class="btn btn-secondary btn-small" id="refresh-btn" data-server-action>⟳ ریفریش</button><button class="btn btn-secondary btn-small" id="logout-btn">لاگ آؤٹ</button></div>
        </header>
        <div class="layout">
          <aside class="sidebar">${renderNav()}</aside>
          <main class="main" id="main-content">${loading()}</main>
        </div>
        <div class="bottom-nav">${renderNav("bottom-nav-inner")}</div>
      </div>`;
    $("#logout-btn").addEventListener("click", logout);
    $("#refresh-btn").addEventListener("click", async () => {
      try { await refreshAll(); renderPage(); toast("ریکارڈ تازہ ہو گیا۔"); }
      catch (e) { toast(e.message, "error"); }
    });
    $$("[data-nav]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.nav)));
    renderPage();
  }

  async function navigate(page) {
    state.page = page;
    if (page === "person-ledger" && !state.selectedPerson) state.page = "people";
    renderApp();
  }

  function pageHead(title, description, actions = "") {
    return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
  }

  function renderPage() {
    const main = $("#main-content");
    if (!main) return;
    switch (state.page) {
      case "dashboard": main.innerHTML = renderDashboard(); break;
      case "people": main.innerHTML = renderPeople(); break;
      case "transactions": main.innerHTML = renderTransactions(); break;
      case "temporary": main.innerHTML = renderTemporary(); break;
      case "notebook": main.innerHTML = renderNotebook(); break;
      case "person-ledger": main.innerHTML = renderPersonLedger(); break;
      default: state.page = "dashboard"; main.innerHTML = renderDashboard();
    }
    bindPageEvents();
  }

  function renderDashboard() {
    const d = state.dashboard || {};
    const stats = [
      ["کل افراد", d.peopleCount ?? state.people.length, "افراد کے مستقل کھاتے"],
      ["کل مین ٹرانزیکشنز", d.transactionCount ?? state.transactions.length, "تصدیق شدہ اندراجات"],
      ["عارضی اندراجات", d.temporaryCount ?? state.temporaryTransactions.filter(x => x.status !== "Finalized").length, "ابھی فائنل نہیں ہوئے"]
    ];
    return `${pageHead("ڈیش بورڈ", "اپنے مالی ریکارڈ اور نوٹس کا خلاصہ دیکھیں۔", `<button class="btn btn-primary" data-action="new-transaction">＋ نئی ٹرانزیکشن</button>`)}
      <div class="grid stats-grid">${stats.map(([label,value,note]) => `<div class="card"><div class="stat-label">${label}</div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-note">${note}</div></div>`).join("")}</div>
      <div class="grid two-col">
        <section class="card"><div class="section-title"><h2>فوری کام</h2></div>
          <div class="grid">
            <button class="btn btn-secondary" data-action="new-person">＋ نیا شخص شامل کریں</button>
            <button class="btn btn-secondary" data-action="new-transaction">＋ مین ٹرانزیکشن درج کریں</button>
            <button class="btn btn-secondary" data-action="new-temporary">＋ عارضی اندراج لکھیں</button>
            <button class="btn btn-secondary" data-action="new-note">✎ نیا نوٹ لکھیں</button>
          </div>
        </section>
        <section class="card"><div class="section-title"><h2>اہم اصول</h2></div>
          <p class="muted">عارضی اندراج فائنل ہونے تک کسی شخص کے مین بیلنس کو تبدیل نہیں کرتا۔</p>
          <p class="muted">مین ٹرانزیکشن اور نوٹس کی PDF الگ الگ بنائی جا سکتی ہے۔</p>
          <p class="muted">اسکرین پر اصل ریکارڈ صرف بیک اینڈ سے لوڈ ہوگا؛ کوئی ڈمی ٹرانزیکشن شامل نہیں۔</p>
        </section>
      </div>
      <p class="footer-note">ڈیٹا محفوظ کرنے کے لیے Google Apps Script Web App بیک اینڈ منسلک ہونا ضروری ہے۔</p>`;
  }

  function renderPeople() {
    const filtered = filterRecords(state.people, state.search.people, ["name","fatherName","mobile","address","personId"]);
    return `${pageHead("افراد اور کھاتے", "شخص کو ایک مرتبہ شامل کریں؛ آئندہ ہر ٹرانزیکشن اسی کھاتے میں درج ہوگی۔", `<button class="btn btn-primary" data-action="new-person">＋ نیا شخص</button>`)}
      <section class="card">
        <div class="inline-search"><input id="people-search" value="${escapeHtml(state.search.people)}" placeholder="نام، والد کا نام، موبائل یا Person ID تلاش کریں"><button class="btn btn-secondary" data-action="search-people">تلاش</button></div>
        ${filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Person ID</th><th>نام</th><th>والد کا نام</th><th>موبائل</th><th>نیٹ بیلنس</th><th>عمل</th></tr></thead><tbody>${filtered.map(p => `
          <tr><td>${escapeHtml(p.personId || "—")}</td><td><strong>${escapeHtml(p.name || "")}</strong></td><td>${escapeHtml(p.fatherName || "—")}</td><td>${escapeHtml(p.mobile || "—")}</td>
          <td class="${Number(p.netBalance || 0) < 0 ? "balance-negative" : "balance-positive"}">${money(p.netBalance || 0)}<div class="muted">${balanceLabel(p.netBalance)}</div></td>
          <td><div class="table-actions"><button class="btn btn-soft btn-small" data-action="open-ledger" data-id="${escapeHtml(p.personId)}">کھاتہ</button><button class="btn btn-secondary btn-small" data-action="edit-person" data-id="${escapeHtml(p.personId)}">ترمیم</button><button class="btn btn-secondary btn-small" data-action="delete-person" data-id="${escapeHtml(p.personId)}">حذف</button></div></td></tr>`).join("")}</tbody></table></div>` : emptyState("♙","ابھی کوئی شخص محفوظ نہیں","نیا شخص شامل کریں یا تلاش کی عبارت تبدیل کریں۔")}
      </section>`;
  }

  function balanceLabel(value) {
    const n = Number(value || 0);
    if (n > 0) return "آپ نے لینے ہیں";
    if (n < 0) return "آپ نے دینے ہیں";
    return "حساب برابر";
  }

  function renderTransactions() {
    const filtered = filterRecords(state.transactions, state.search.transactions, ["transactionId","personName","personId","type","notes","description"]);
    return `${pageHead("مین ٹرانزیکشنز", "یہاں صرف فائنل اور مستقل مالی اندراجات دکھائے جاتے ہیں۔", `<button class="btn btn-primary" data-action="new-transaction">＋ نئی ٹرانزیکشن</button>`)}
      <section class="card">
        <div class="inline-search"><input id="transactions-search" value="${escapeHtml(state.search.transactions)}" placeholder="Transaction ID، شخص یا تفصیل تلاش کریں"><button class="btn btn-secondary" data-action="search-transactions">تلاش</button></div>
        ${filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Transaction ID</th><th>تاریخ</th><th>شخص</th><th>قسم</th><th>رقم</th><th>نوٹس</th><th>PDF / عمل</th></tr></thead><tbody>${filtered.map(t => `<tr>
          <td>${escapeHtml(t.transactionId || "—")}</td><td>${dateText(t.date)}</td><td>${escapeHtml(t.personName || t.personId || "—")}</td>
          <td>${escapeHtml(transactionTypeLabel(t.type))}</td><td>${money(t.amount)}</td><td>${escapeHtml(t.notes || t.description || "—")}</td>
          <td><div class="table-actions"><button class="btn btn-soft btn-small" data-action="transaction-pdf" data-id="${escapeHtml(t.transactionId)}">PDF</button><button class="btn btn-secondary btn-small" data-action="edit-transaction" data-id="${escapeHtml(t.transactionId)}">ترمیم</button><button class="btn btn-secondary btn-small" data-action="delete-transaction" data-id="${escapeHtml(t.transactionId)}">حذف</button></div></td>
        </tr>`).join("")}</tbody></table></div>` : emptyState("⇄","ابھی کوئی مین ٹرانزیکشن نہیں","پہلی ٹرانزیکشن درج کرنے پر ریکارڈ یہاں نظر آئے گا۔")}
      </section>`;
  }

  function transactionTypeLabel(type) {
    return ({ given: "پیسے دیے", received: "پیسے وصول کیے", other: "دیگر" })[type] || type || "—";
  }

  function renderTemporary() {
    const filtered = filterRecords(state.temporaryTransactions, state.search.temporary, ["temporaryId","personName","title","type","notes","status"]);
    return `${pageHead("عارضی ٹرانزیکشنز", "یاد رکھنے یا تصدیق کرنے کے لیے اندراج کریں؛ فائنل ہونے تک مین بیلنس نہیں بدلے گا۔", `<button class="btn btn-primary" data-action="new-temporary">＋ عارضی اندراج</button>`)}
      <div class="notice">عارضی اندراج کو فائنل کرنے سے پہلے تفصیلات اور رقم کی تصدیق کریں۔ ایک ریکارڈ صرف ایک مرتبہ فائنل ہو سکتا ہے۔</div>
      <section class="card">
        <div class="inline-search"><input id="temporary-search" value="${escapeHtml(state.search.temporary)}" placeholder="عارضی ID، عنوان یا شخص تلاش کریں"><button class="btn btn-secondary" data-action="search-temporary">تلاش</button></div>
        ${filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Temporary ID</th><th>تاریخ</th><th>عنوان / تفصیل</th><th>رقم</th><th>شخص</th><th>اسٹیٹس</th><th>عمل</th></tr></thead><tbody>${filtered.map(t => `<tr>
          <td>${escapeHtml(t.temporaryId || "—")}</td><td>${dateText(t.date)}</td><td><strong>${escapeHtml(t.title || "عارضی اندراج")}</strong><div class="muted">${escapeHtml(t.notes || "")}</div></td>
          <td>${t.amount === "" || t.amount == null ? "—" : money(t.amount)}</td><td>${escapeHtml(t.personName || "ابھی منسلک نہیں")}</td>
          <td><span class="pill ${t.status === "Finalized" ? "success" : t.status === "Cancelled" ? "danger" : "warning"}">${escapeHtml(tempStatusLabel(t.status))}</span></td>
          <td><div class="table-actions">${t.status !== "Finalized" && t.status !== "Cancelled" ? `<button class="btn btn-primary btn-small" data-action="finalize-temporary" data-id="${escapeHtml(t.temporaryId)}">فائنل</button><button class="btn btn-secondary btn-small" data-action="edit-temporary" data-id="${escapeHtml(t.temporaryId)}">ترمیم</button>` : ""}<button class="btn btn-secondary btn-small" data-action="delete-temporary" data-id="${escapeHtml(t.temporaryId)}">حذف</button></div></td>
        </tr>`).join("")}</tbody></table></div>` : emptyState("▤","کوئی عارضی اندراج نہیں","عارضی نوٹ یا ٹرانزیکشن یہاں محفوظ ہوگی۔")}
      </section>`;
  }

  function tempStatusLabel(status) {
    return ({ Draft: "عارضی", Pending: "زیرِ جائزہ", Finalized: "فائنل ہو چکا", Cancelled: "منسوخ" })[status] || status || "عارضی";
  }

  function renderNotebook() {
    const filtered = filterRecords(state.notes, state.search.notes, ["noteId","title","body","content","category"]);
    return `${pageHead("ڈیجیٹل نوٹ بک", "عام نوٹس، مختصر تحریریں اور یاد رکھنے والی باتیں محفوظ کریں۔", `<button class="btn btn-primary" data-action="new-note">＋ نیا نوٹ</button><button class="btn btn-secondary" data-action="notes-pdf">منتخب / تمام نوٹس PDF</button>`)}
      <section class="card">
        <div class="inline-search"><input id="notes-search" value="${escapeHtml(state.search.notes)}" placeholder="عنوان یا نوٹ کے الفاظ تلاش کریں"><button class="btn btn-secondary" data-action="search-notes">تلاش</button></div>
        ${filtered.length ? `<div class="note-list">${filtered.map(n => `<article class="note-card">
          <div class="note-card-head"><div><h3>${escapeHtml(n.title || "بغیر عنوان")}</h3><div class="note-meta">${dateText(n.createdAt || n.date)}${n.reminderDate ? " · یاد دہانی: " + dateText(n.reminderDate) : ""}</div></div><span class="pill">${escapeHtml(n.category || "عام")}</span></div>
          <div class="note-body">${escapeHtml(n.body || n.content || "")}</div>
          <div class="note-actions"><button class="btn btn-soft btn-small" data-action="note-pdf" data-id="${escapeHtml(n.noteId)}">اس نوٹ کی PDF</button><button class="btn btn-secondary btn-small" data-action="edit-note" data-id="${escapeHtml(n.noteId)}">ترمیم</button><button class="btn btn-secondary btn-small" data-action="delete-note" data-id="${escapeHtml(n.noteId)}">حذف</button><label class="checkbox-row"><input type="checkbox" class="note-export-check" value="${escapeHtml(n.noteId)}"> PDF میں شامل کریں</label></div>
        </article>`).join("")}</div>` : emptyState("✎","ابھی کوئی نوٹ نہیں","اپنا پہلا نوٹ لکھیں؛ اسے مالی ٹرانزیکشن سے الگ رکھا جائے گا۔")}
      </section>`;
  }

  function renderPersonLedger() {
    const p = state.selectedPerson;
    if (!p) return renderPeople();
    const l = state.ledger || {};
    const txs = Array.isArray(l.transactions) ? l.transactions : [];
    return `${pageHead(`${escapeHtml(p.name)} کا کھاتہ`, `Person ID: ${escapeHtml(p.personId || "")}`, `<button class="btn btn-secondary" data-action="back-people">افراد پر واپس</button><button class="btn btn-primary" data-action="person-ledger-pdf" data-id="${escapeHtml(p.personId)}">مکمل کھاتہ PDF</button><button class="btn btn-soft" data-action="new-transaction" data-person="${escapeHtml(p.personId)}">＋ ٹرانزیکشن</button>`)}
      <div class="card person-balance-card"><div><div class="stat-label">موجودہ نیٹ بیلنس</div><div class="stat-value ${Number(l.netBalance ?? p.netBalance ?? 0) < 0 ? "balance-negative" : "balance-positive"}">${money(l.netBalance ?? p.netBalance ?? 0)}</div><div class="muted">${balanceLabel(l.netBalance ?? p.netBalance ?? 0)}</div></div><div><div>${escapeHtml(p.fatherName || "—")}</div><div class="muted">${escapeHtml(p.mobile || "—")}</div><div class="muted">${escapeHtml(p.address || "—")}</div></div></div>
      <section class="card" style="margin-top:14px"><div class="section-title"><h2>مکمل ٹرانزیکشن ہسٹری</h2></div>
        ${txs.length ? `<div class="table-wrap"><table><thead><tr><th>Transaction ID</th><th>تاریخ</th><th>قسم</th><th>رقم</th><th>تفصیل</th><th>PDF</th></tr></thead><tbody>${txs.map(t => `<tr><td>${escapeHtml(t.transactionId || "—")}</td><td>${dateText(t.date)}</td><td>${escapeHtml(transactionTypeLabel(t.type))}</td><td>${money(t.amount)}</td><td>${escapeHtml(t.notes || t.description || "—")}</td><td><button class="btn btn-soft btn-small" data-action="transaction-pdf" data-id="${escapeHtml(t.transactionId)}">PDF</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("⇄","اس شخص کی کوئی ٹرانزیکشن نہیں","نئی ٹرانزیکشن درج کرنے کے بعد ہسٹری یہاں آئے گی۔")}
      </section>`;
  }

  function emptyState(icon, title, description) {
    return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>`;
  }

  function filterRecords(items, query, fields) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter(item => fields.some(field => String(item[field] ?? "").toLowerCase().includes(q)));
  }

  function bindPageEvents() {
    $$("[data-action]").forEach(button => button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.id, button.dataset.person)));
    const bindSearch = (id, key, action) => {
      const input = $(id);
      if (input) input.addEventListener("keydown", event => { if (event.key === "Enter") { state.search[key] = input.value; handleAction(action); } });
    };
    bindSearch("#people-search", "people", "search-people");
    bindSearch("#transactions-search", "transactions", "search-transactions");
    bindSearch("#temporary-search", "temporary", "search-temporary");
    bindSearch("#notes-search", "notes", "search-notes");
  }

  async function handleAction(action, id = "", personId = "") {
    try {
      switch (action) {
        case "new-person": openPersonForm(); break;
        case "edit-person": openPersonForm(findBy(state.people, "personId", id)); break;
        case "delete-person": await deletePerson(id); break;
        case "open-ledger": await openLedger(id); break;
        case "back-people": state.page = "people"; renderApp(); break;
        case "new-transaction": openTransactionForm(null, personId); break;
        case "edit-transaction": openTransactionForm(findBy(state.transactions, "transactionId", id)); break;
        case "delete-transaction": await deleteTransaction(id); break;
        case "transaction-pdf": await exportPdf("exportTransactionPdf", { transactionId: id }); break;
        case "person-ledger-pdf": await exportPdf("exportPersonLedgerPdf", { personId: id }); break;
        case "new-temporary": openTemporaryForm(); break;
        case "edit-temporary": openTemporaryForm(findBy(state.temporaryTransactions, "temporaryId", id)); break;
        case "delete-temporary": await deleteTemporary(id); break;
        case "finalize-temporary": await finalizeTemporary(id); break;
        case "new-note": openNoteForm(); break;
        case "edit-note": openNoteForm(findBy(state.notes, "noteId", id)); break;
        case "delete-note": await deleteNote(id); break;
        case "note-pdf": await exportPdf("exportNotePdf", { noteId: id }); break;
        case "notes-pdf": await exportSelectedNotesPdf(); break;
        case "search-people": state.search.people = $("#people-search")?.value || ""; await reloadList("people"); break;
        case "search-transactions": state.search.transactions = $("#transactions-search")?.value || ""; await reloadList("transactions"); break;
        case "search-temporary": state.search.temporary = $("#temporary-search")?.value || ""; await reloadList("temporary"); break;
        case "search-notes": state.search.notes = $("#notes-search")?.value || ""; await reloadList("notebook"); break;
      }
    } catch (error) {
      toast(error.message || "عمل مکمل نہیں ہو سکا۔", "error");
    }
  }

  function findBy(items, key, value) {
    return items.find(item => String(item[key]) === String(value)) || null;
  }

  async function reloadList(page) {
    try { await refreshAll(); state.page = page; renderApp(); }
    catch (e) { toast(e.message, "error"); }
  }

  function openModal(title, content, onSubmit) {
    const existing = $("#active-modal");
    if (existing) existing.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "active-modal";
    backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${title}</h2><button type="button" class="btn btn-secondary btn-icon" data-close-modal aria-label="بند کریں">×</button></div>${content}</section>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.closest("[data-close-modal]")) backdrop.remove(); });
    const form = $("form", backdrop);
    if (form) form.addEventListener("submit", async e => {
      e.preventDefault();
      const submit = $('button[type="submit"]', form);
      if (submit) { submit.disabled = true; submit.textContent = "محفوظ ہو رہا ہے..."; }
      try { await onSubmit(new FormData(form), form); backdrop.remove(); }
      catch (error) { toast(error.message || "محفوظ نہیں ہو سکا۔", "error"); if (submit) { submit.disabled = false; submit.textContent = "محفوظ کریں"; } }
    });
    return backdrop;
  }

  function openPersonForm(person = null) {
    const p = person || {};
    const isEdit = Boolean(person);
    const content = `<form>
      <div class="form-grid">
        <div class="field full"><label>نام *</label><input name="name" required maxlength="120" value="${escapeHtml(p.name || "")}"></div>
        <div class="field"><label>والد کا نام</label><input name="fatherName" maxlength="120" value="${escapeHtml(p.fatherName || "")}"></div>
        <div class="field"><label>موبائل نمبر</label><input name="mobile" inputmode="tel" maxlength="30" value="${escapeHtml(p.mobile || "")}"></div>
        <div class="field full"><label>پتہ</label><textarea name="address" rows="2">${escapeHtml(p.address || "")}</textarea></div>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">محفوظ کریں</button><button type="button" class="btn btn-secondary" data-close-modal>منسوخ</button></div>
    </form>`;
    openModal(isEdit ? "شخص کی معلومات میں ترمیم" : "نیا شخص شامل کریں", content, async form => {
      const payload = Object.fromEntries(form.entries());
      if (isEdit) payload.personId = p.personId;
      await apiRequest("savePerson", payload);
      await refreshAll(); state.page = "people"; renderApp(); toast("شخص کا ریکارڈ محفوظ ہو گیا۔");
    });
  }

  function personOptions(selected = "") {
    return `<option value="">شخص منتخب کریں</option>` + state.people.map(p => `<option value="${escapeHtml(p.personId)}" ${String(p.personId) === String(selected) ? "selected" : ""}>${escapeHtml(p.name)} — ${escapeHtml(p.personId)}</option>`).join("");
  }

  function openTransactionForm(transaction = null, preselectedPersonId = "") {
    const t = transaction || {};
    const isEdit = Boolean(transaction);
    const selected = t.personId || preselectedPersonId || "";
    const content = `<form>
      <div class="form-grid">
        <div class="field full"><label>شخص منتخب کریں *</label><select name="personId" required>${personOptions(selected)}</select><small>اگر شخص موجود نہیں تو پہلے افراد والے حصے میں شامل کریں۔</small></div>
        <div class="field"><label>ٹرانزیکشن کی قسم *</label><select name="type" required>
          <option value="given" ${t.type === "given" ? "selected" : ""}>میں نے پیسے دیے</option>
          <option value="received" ${t.type === "received" ? "selected" : ""}>میں نے پیسے وصول کیے</option>
          <option value="other" ${t.type === "other" ? "selected" : ""}>دیگر</option>
        </select></div>
        <div class="field"><label>رقم (PKR) *</label><input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(t.amount ?? "")}"></div>
        <div class="field"><label>تاریخ *</label><input name="date" type="date" required value="${escapeHtml(t.date ? String(t.date).slice(0,10) : todayISO())}"></div>
        <div class="field"><label>ادائیگی کا طریقہ</label><select name="paymentMethod">
          <option value="">منتخب کریں (اختیاری)</option>
          <option value="cash" ${t.paymentMethod === "cash" ? "selected" : ""}>نقد</option>
          <option value="bank" ${t.paymentMethod === "bank" ? "selected" : ""}>بینک</option>
          <option value="wallet" ${t.paymentMethod === "wallet" ? "selected" : ""}>موبائل والٹ</option>
          <option value="other" ${t.paymentMethod === "other" ? "selected" : ""}>دیگر</option>
        </select></div>
        <div class="field full"><label>تفصیل / نوٹس</label><textarea name="notes" rows="3">${escapeHtml(t.notes || "")}</textarea></div>
        ${t.temporaryId ? `<input type="hidden" name="temporaryId" value="${escapeHtml(t.temporaryId)}">` : ""}
      </div>
      <div class="notice warning" style="margin-top:14px">رقم کی سمت ٹرانزیکشن کی قسم سے طے ہوگی۔ “دیگر” کے لیے بیک اینڈ میں balanceEffect (increase/decrease) کی تصدیق ضروری ہوگی۔</div>
      <div class="field full other-effect-field" style="display:${t.type === "other" ? "grid" : "none"}"><label>بیلنس پر اثر *</label><select name="balanceEffect" ${t.type === "other" ? "required" : ""}><option value="">منتخب کریں</option><option value="increase" ${t.balanceEffect === "increase" ? "selected" : ""}>وصول طلب رقم میں اضافہ</option><option value="decrease" ${t.balanceEffect === "decrease" ? "selected" : ""}>وصول طلب رقم میں کمی</option></select></div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">محفوظ کریں</button><button type="button" class="btn btn-secondary" data-close-modal>منسوخ</button></div>
    </form>`;
    const transactionModal = openModal(isEdit ? "ٹرانزیکشن میں ترمیم" : "نئی مین ٹرانزیکشن", content, async form => {
      const payload = Object.fromEntries(form.entries());
      payload.amount = Number(payload.amount);
      if (isEdit) payload.transactionId = t.transactionId;
      await apiRequest("saveTransaction", payload);
      await refreshAll();
      if (state.page === "person-ledger" && state.selectedPerson) await openLedger(state.selectedPerson.personId, false);
      else { state.page = "transactions"; renderApp(); }
      toast("مین ٹرانزیکشن محفوظ ہو گئی۔");
    });
    const typeSelect = $('select[name="type"]', transactionModal);
    const effectField = $(".other-effect-field", transactionModal);
    const effectSelect = $('select[name="balanceEffect"]', transactionModal);
    if (typeSelect && effectField && effectSelect) {
      typeSelect.addEventListener("change", () => {
        const isOther = typeSelect.value === "other";
        effectField.style.display = isOther ? "grid" : "none";
        effectSelect.required = isOther;
        if (!isOther) effectSelect.value = "";
      });
    }
  }

  function openTemporaryForm(temp = null) {
    const t = temp || {};
    const isEdit = Boolean(temp);
    const content = `<form>
      <div class="form-grid">
        <div class="field full"><label>عنوان / مختصر یادداشت *</label><input name="title" required maxlength="180" value="${escapeHtml(t.title || "")}" placeholder="مثلاً احمد سے رقم کی تصدیق کرنی ہے"></div>
        <div class="field"><label>تاریخ</label><input name="date" type="date" value="${escapeHtml(t.date ? String(t.date).slice(0,10) : todayISO())}"></div>
        <div class="field"><label>رقم (اختیاری)</label><input name="amount" type="number" min="0" step="0.01" value="${escapeHtml(t.amount ?? "")}"></div>
        <div class="field"><label>متعلقہ شخص (اختیاری)</label><select name="personId">${personOptions(t.personId || "")}</select></div>
        <div class="field"><label>ٹرانزیکشن کی قسم (اختیاری)</label><select name="type"><option value="">ابھی طے نہیں</option><option value="given" ${t.type === "given" ? "selected" : ""}>پیسے دیے</option><option value="received" ${t.type === "received" ? "selected" : ""}>پیسے وصول کیے</option><option value="other" ${t.type === "other" ? "selected" : ""}>دیگر</option></select></div>
        <div class="field full temporary-effect-field" style="display:${t.type === "other" ? "grid" : "none"}"><label>بیلنس پر اثر (Other کے لیے لازمی)</label><select name="balanceEffect" ${t.type === "other" ? "required" : ""}><option value="">منتخب کریں</option><option value="increase" ${t.balanceEffect === "increase" ? "selected" : ""}>وصول طلب رقم میں اضافہ</option><option value="decrease" ${t.balanceEffect === "decrease" ? "selected" : ""}>وصول طلب رقم میں کمی</option></select></div>
        <div class="field full"><label>نوٹس</label><textarea name="notes" rows="3">${escapeHtml(t.notes || "")}</textarea></div>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">محفوظ کریں</button><button type="button" class="btn btn-secondary" data-close-modal>منسوخ</button></div>
    </form>`;
    openModal(isEdit ? "عارضی اندراج میں ترمیم" : "نیا عارضی اندراج", content, async form => {
      const payload = Object.fromEntries(form.entries());
      payload.amount = payload.amount === "" ? null : Number(payload.amount);
      if (isEdit) payload.temporaryId = t.temporaryId;
      await apiRequest("saveTemporaryTransaction", payload);
      await refreshAll(); state.page = "temporary"; renderApp(); toast("عارضی اندراج محفوظ ہو گیا۔");
    });
    const tempModal = $("#active-modal");
    const typeSelect = $('select[name="type"]', tempModal);
    const effectField = $(".temporary-effect-field", tempModal);
    const effectSelect = $('select[name="balanceEffect"]', tempModal);
    if (typeSelect && effectField && effectSelect) {
      typeSelect.addEventListener("change", () => {
        const isOther = typeSelect.value === "other";
        effectField.style.display = isOther ? "grid" : "none";
        effectSelect.required = isOther;
        if (!isOther) effectSelect.value = "";
      });
    }
  }

  async function finalizeTemporary(id) {
    const t = findBy(state.temporaryTransactions, "temporaryId", id);
    if (!t) throw new Error("عارضی ریکارڈ نہیں ملا۔");
    if (t.status === "Finalized") throw new Error("یہ ریکارڈ پہلے ہی فائنل ہو چکا ہے۔");
    const ok = await showConfirm("عارضی ریکارڈ فائنل کریں", "فائنل کرنے سے یہ مین ٹرانزیکشن میں شامل ہوگا اور بیلنس تبدیل ہو سکتا ہے۔ پہلے تفصیلات کی تصدیق کریں۔", "فائنل کریں");
    if (!ok) return;
    const data = await apiRequest("finalizeTemporaryTransaction", { temporaryId: id });
    await refreshAll(); state.page = "temporary"; renderApp();
    toast(data.transactionId ? `فائنل ہو گیا۔ Transaction ID: ${data.transactionId}` : "عارضی ریکارڈ فائنل ہو گیا۔");
  }

  function openNoteForm(note = null) {
    const n = note || {};
    const isEdit = Boolean(note);
    const content = `<form>
      <div class="form-grid">
        <div class="field full"><label>عنوان (اختیاری)</label><input name="title" maxlength="180" value="${escapeHtml(n.title || "")}" placeholder="مثلاً ضروری کام"></div>
        <div class="field"><label>کیٹیگری</label><select name="category"><option value="عام" ${n.category === "عام" || !n.category ? "selected" : ""}>عام</option><option value="ذاتی" ${n.category === "ذاتی" ? "selected" : ""}>ذاتی</option><option value="کاروباری" ${n.category === "کاروباری" ? "selected" : ""}>کاروباری</option><option value="ضروری" ${n.category === "ضروری" ? "selected" : ""}>ضروری</option></select></div>
        <div class="field"><label>یاد دہانی کی تاریخ (اختیاری)</label><input name="reminderDate" type="date" value="${escapeHtml(n.reminderDate ? String(n.reminderDate).slice(0,10) : "")}"></div>
        <div class="field full"><label>نوٹ *</label><textarea name="body" required rows="6">${escapeHtml(n.body || n.content || "")}</textarea></div>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-primary">محفوظ کریں</button><button type="button" class="btn btn-secondary" data-close-modal>منسوخ</button></div>
    </form>`;
    openModal(isEdit ? "نوٹ میں ترمیم" : "نیا نوٹ", content, async form => {
      const payload = Object.fromEntries(form.entries());
      if (isEdit) payload.noteId = n.noteId;
      await apiRequest("saveNote", payload);
      await refreshAll(); state.page = "notebook"; renderApp(); toast("نوٹ محفوظ ہو گیا۔");
    });
  }

  async function openLedger(personId, shouldRender = true) {
    const person = findBy(state.people, "personId", personId);
    if (!person) throw new Error("شخص کا ریکارڈ نہیں ملا۔");
    const ledger = await apiRequest("getPersonLedger", { personId });
    state.selectedPerson = person;
    state.ledger = ledger || {};
    state.page = "person-ledger";
    if (shouldRender) renderApp();
  }

  async function deletePerson(id) {
    const p = findBy(state.people, "personId", id);
    if (!p) return;
    const ok = await showConfirm("شخص حذف کریں؟", "شخص کا ریکارڈ حذف کرنے سے پہلے بیک اینڈ متعلقہ ٹرانزیکشنز کی حفاظت اور پابندیاں چیک کرے گا۔", "حذف کریں");
    if (!ok) return;
    await apiRequest("deletePerson", { personId: id });
    await refreshAll(); state.page = "people"; renderApp(); toast("حذف کی درخواست مکمل ہو گئی۔");
  }

  async function deleteTransaction(id) {
    const ok = await showConfirm("ٹرانزیکشن حذف کریں؟", "اس سے بیلنس دوبارہ حساب ہوگا۔ اگر یہ مالی ریکارڈ ہے تو حذف کرنے کے بجائے منسوخی/آڈٹ ہسٹری رکھنا بہتر ہے۔", "حذف کریں");
    if (!ok) return;
    await apiRequest("deleteTransaction", { transactionId: id });
    await refreshAll(); state.page = "transactions"; renderApp(); toast("ٹرانزیکشن حذف ہو گئی۔");
  }

  async function deleteTemporary(id) {
    const t = findBy(state.temporaryTransactions, "temporaryId", id);
    const ok = await showConfirm("عارضی اندراج حذف کریں؟", t?.status === "Finalized" ? "یہ ریکارڈ فائنل ہو چکا ہے۔ اسے حذف کرنے سے پہلے بیک اینڈ کو اس کی ہسٹری برقرار رکھنی چاہیے۔" : "یہ عارضی اندراج حذف کیا جائے گا۔", "حذف کریں");
    if (!ok) return;
    await apiRequest("deleteTemporaryTransaction", { temporaryId: id });
    await refreshAll(); state.page = "temporary"; renderApp(); toast("عارضی اندراج حذف ہو گیا۔");
  }

  async function deleteNote(id) {
    const ok = await showConfirm("نوٹ حذف کریں؟", "کیا آپ یہ نوٹ حذف کرنا چاہتے ہیں؟", "حذف کریں");
    if (!ok) return;
    await apiRequest("deleteNote", { noteId: id });
    await refreshAll(); state.page = "notebook"; renderApp(); toast("نوٹ حذف ہو گیا۔");
  }

  async function exportSelectedNotesPdf() {
    const ids = $$(".note-export-check:checked").map(input => input.value);
    if (!ids.length) {
      const ok = await showConfirm("تمام نوٹس کی PDF؟", "آپ نے کوئی نوٹ منتخب نہیں کیا۔ کیا تمام نوٹس کی PDF بنانی ہے؟", "تمام نوٹس");
      if (!ok) return;
      await exportPdf("exportNotesPdf", { all: true });
    } else {
      await exportPdf("exportNotesPdf", { noteIds: ids });
    }
  }

  async function exportPdf(action, payload) {
    const defaultTitles = {
      exportTransactionPdf: "ٹرانزیکشن رپورٹ",
      exportPersonLedgerPdf: "مکمل کھاتہ",
      exportNotePdf: "ڈیجیٹل نوٹ",
      exportNotesPdf: "ڈیجیٹل نوٹس"
    };
    const customTitle = window.prompt("PDF کی اپنی مرضی کی ہیڈنگ لکھیں:", defaultTitles[action] || "رپورٹ");
    if (customTitle === null) return;
    const purpose = window.prompt("اس PDF کا مقصد / اضافی وضاحت لکھیں (اختیاری):", "");
    if (purpose === null) return;
    const data = await apiRequest(action, { ...payload, customTitle: customTitle.trim() || defaultTitles[action] || "رپورٹ", purpose: purpose.trim() });
    if (!data.base64) throw new Error("بیک اینڈ نے PDF فائل واپس نہیں کی۔");
    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: data.mimeType || "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = data.fileName || "report.pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // iOS Safari may need the object URL briefly after the download click.
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("PDF تیار ہے۔");
  }

  // Public API for later integration/testing. No dummy records are seeded.
  window.PersonalFinancialTransactionSystem = {
    apiRequest,
    refreshAll,
    getState: () => ({ ...state, token: state.token ? "[present]" : "" }),
    setApiUrl: url => { if (typeof url === "string" && url.startsWith("https://")) { API_URL = url; window.__PFTS_API_URL = url; } },
    renderApp
  };

  // API_URL can be set before app.js by defining window.__PFTS_API_URL in index.html if desired.
  // To configure without editing app.js, set window.__PFTS_API_URL in index.html before app.js loads.

  renderLogin();
})();
