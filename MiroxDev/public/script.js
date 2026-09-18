/* MiroxAI v33 — circular video progress + reliable frame generation */

window.addEventListener("load", () => {
  const l = document.getElementById("loadingScreen");
  if (l) setTimeout(() => l.classList.add("hidden"), 400);
  applyExtensions(); syncRailDefault(); loadBackground(); loadMe(); showAgentWebAnnouncementOnce();
});

const chat = document.getElementById("chat");
const form = document.getElementById("composerForm");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const micBtn = document.getElementById("micBtn");
const chatTitle = document.getElementById("chatTitle");
const chatSubtitle = document.getElementById("chatSubtitle");
const settingsBtn = document.getElementById("settingsBtn");
const userChip = document.getElementById("userChip");
const imageModeBtn = document.getElementById("imageModeBtn");
const videoModeBtn = document.getElementById("videoModeBtn");
const bgModeBtn = document.getElementById("backgroundModeBtn");
const plansModeBtn = document.getElementById("plansModeBtn");
const supportModeBtn = document.getElementById("supportModeBtn");

let currentConversationId = null, isReplying = false, currentBlobUrl = "";
let micPermissionGranted = false, audioStream = null;
let __user = null, __tier = "free", __modelsAllowed = ["mirox-gen1"];
let __imagesAllowed = false, __videoAllowed = false, __dailyRemaining = 999;

const escapeHtml = s => { const d = document.createElement("div"); d.textContent = String(s); return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
const scrollToBottom = () => { if (chat) chat.scrollTop = chat.scrollHeight; };
const isNearBottom = () => chat ? (chat.scrollHeight - chat.scrollTop - chat.clientHeight < 150) : true;
const safeHostname = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

function applyCodeTheme(mode) {
  const d = document.getElementById("hljs-dark"), l = document.getElementById("hljs-light");
  if (!d || !l) return; d.disabled = mode !== "dark"; l.disabled = mode === "dark";
}
const openModal = id => { const el = document.getElementById(id); if (el) el.classList.add("open"); };
const closeModal = id => { const el = document.getElementById(id); if (el) el.classList.remove("open"); };
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.close)));
document.querySelectorAll(".modal-overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) o.classList.remove("open"); }));
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-overlay.open").forEach(o => o.classList.remove("open"));
  if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = ""; }
});
document.addEventListener("click", e => {
  if (e.target.closest("[data-open-plans]")) { e.preventDefault(); openModal("plansModal"); loadPlans(); loadUserKeys(); }
});

function showAgentWebAnnouncementOnce() {
  try { if (localStorage.getItem("miroxai_agentweb_announced") === "1") return; } catch {}
  setTimeout(() => openModal("announceModal"), 700);
  const okBtn = document.getElementById("announceOkBtn");
  const dismiss = () => { try { localStorage.setItem("miroxai_agentweb_announced", "1"); } catch {} closeModal("announceModal"); };
  if (okBtn) okBtn.addEventListener("click", dismiss);
  const cb = document.querySelector('#announceModal [data-close]');
  if (cb) cb.addEventListener("click", dismiss);
}

const railToggleBtn = document.getElementById("railToggleBtn");
const isTablet = () => window.matchMedia("(max-width:1024px)").matches;
function syncRailDefault() {
  if (isTablet()) {
    document.body.classList.remove("rail-collapsed");
    try { if (localStorage.getItem("miroxai_rail_open") === "1") document.body.classList.add("rail-open"); } catch {}
  } else {
    document.body.classList.remove("rail-open");
    try { if (localStorage.getItem("miroxai_rail_collapsed") === "1") document.body.classList.add("rail-collapsed"); } catch {}
  }
}
if (railToggleBtn) railToggleBtn.addEventListener("click", () => {
  if (isTablet()) { document.body.classList.toggle("rail-open"); try { localStorage.setItem("miroxai_rail_open", document.body.classList.contains("rail-open") ? "1" : "0"); } catch {} }
  else { document.body.classList.toggle("rail-collapsed"); try { localStorage.setItem("miroxai_rail_collapsed", document.body.classList.contains("rail-collapsed") ? "1" : "0"); } catch {} }
});
let rzT; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(syncRailDefault, 200); });

const sidebar = document.getElementById("sidebar"), sidebarScrim = document.getElementById("sidebarScrim");
const hamburgerBtn = document.getElementById("hamburgerBtn"), sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
const openSidebar = () => { sidebar.classList.add("open"); sidebarScrim.classList.add("open"); };
const closeSidebar = () => { sidebar.classList.remove("open"); sidebarScrim.classList.remove("open"); };
if (hamburgerBtn) hamburgerBtn.addEventListener("click", openSidebar);
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", closeSidebar);
if (sidebarScrim) sidebarScrim.addEventListener("click", closeSidebar);

const root = document.documentElement;
function applyAppearance({ mode, theme, corner, font }) {
  if (mode) root.setAttribute("data-mode", mode);
  if (theme) root.setAttribute("data-theme", theme);
  if (corner) root.setAttribute("data-corner", corner);
  if (font) root.setAttribute("data-font", font);
  document.querySelectorAll("#modeOptions .option-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === (mode || root.getAttribute("data-mode"))));
  document.querySelectorAll("#themeSwatches .swatch").forEach(s => s.classList.toggle("active", s.dataset.theme === (theme || root.getAttribute("data-theme"))));
  document.querySelectorAll("#cornerOptions .option-btn").forEach(b => b.classList.toggle("active", b.dataset.corner === (corner || root.getAttribute("data-corner"))));
  document.querySelectorAll("#fontOptions .option-btn").forEach(b => b.classList.toggle("active", b.dataset.font === (font || root.getAttribute("data-font"))));
  applyCodeTheme(root.getAttribute("data-mode") || "light");
}
function loadAppearance() { const s = JSON.parse(localStorage.getItem("miroxai_appearance") || "{}"); applyAppearance({ mode: s.mode || "light", theme: s.theme || "warm", corner: s.corner || "soft", font: s.font || "system" }); }
loadAppearance();
function saveAppearance(patch) { const c = JSON.parse(localStorage.getItem("miroxai_appearance") || "{}"); const m = { ...c, ...patch }; localStorage.setItem("miroxai_appearance", JSON.stringify(m)); applyAppearance(m); }
document.querySelectorAll("#modeOptions .option-btn").forEach(b => b.addEventListener("click", () => saveAppearance({ mode: b.dataset.mode })));
document.querySelectorAll("#themeSwatches .swatch").forEach(s => s.addEventListener("click", () => saveAppearance({ theme: s.dataset.theme })));
document.querySelectorAll("#cornerOptions .option-btn").forEach(b => b.addEventListener("click", () => saveAppearance({ corner: b.dataset.corner })));
document.querySelectorAll("#fontOptions .option-btn").forEach(b => b.addEventListener("click", () => saveAppearance({ font: b.dataset.font })));

function openSettings(tab) { openModal("settingsModal"); refreshProviderPanel(); loadPersona(); loadMemory(); loadAdminContact(); if (tab) switchSettingsTab(tab); }
if (settingsBtn) settingsBtn.addEventListener("click", () => openSettings());
if (userChip) userChip.addEventListener("click", () => { if (!window.__user) openModal("loginModal"); });
if (imageModeBtn) imageModeBtn.addEventListener("click", () => { openModal("imageModal"); refreshImageGate(); });
if (videoModeBtn) videoModeBtn.addEventListener("click", () => { openModal("videoModal"); refreshVideoGate(); });
if (bgModeBtn) bgModeBtn.addEventListener("click", () => { openModal("backgroundModal"); populateBackgroundUI(); });
if (plansModeBtn) plansModeBtn.addEventListener("click", () => { openModal("plansModal"); loadPlans(); loadUserKeys(); });
if (supportModeBtn) supportModeBtn.addEventListener("click", () => { openModal("supportModal"); loadMyReports(); });
const upgradeBtnEl = document.getElementById("upgradeBtn");
if (upgradeBtnEl) upgradeBtnEl.addEventListener("click", () => { openModal("plansModal"); loadPlans(); loadUserKeys(); });
const extModeBtn = document.getElementById("extensionsModeBtn");
if (extModeBtn) extModeBtn.addEventListener("click", () => { openModal("extensionsModal"); renderExtensions(); });
const talkModeBtn = document.getElementById("talkModeBtn");
if (talkModeBtn) talkModeBtn.addEventListener("click", () => startCall());

function switchSettingsTab(tab) {
  document.querySelectorAll(".settings-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".settings-pane").forEach(p => p.classList.toggle("active", p.dataset.pane === tab));
}
document.querySelectorAll(".settings-tab").forEach(tab => tab.addEventListener("click", () => switchSettingsTab(tab.dataset.tab)));

const editTitleBtnEl = document.getElementById("editTitleBtn");
if (editTitleBtnEl) editTitleBtnEl.addEventListener("click", () => {
  const current = chatTitle.textContent;
  const next = prompt("Rename this chat", current);
  if (next === null) return;
                                                    const trimmed = next.trim(); if (!trimmed) return;
  chatTitle.textContent = trimmed;
  if (currentConversationId) fetch(`/api/history/${currentConversationId}/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: trimmed }) }).then(() => loadHistory()).catch(() => {});
});

async function loadMe() {
  try {
    const r = await fetch("/api/me"); const d = await r.json();
    window.__user = d.user || null; __user = window.__user;
    const chipLabel = document.getElementById("userChipLabel");
    if (chipLabel) chipLabel.textContent = __user ? __user.name : "Sign in";
    const titleEl = document.getElementById("loginTitle");
    if (titleEl) titleEl.textContent = __user ? "Update profile" : "Sign in";
    if (__user) {
      const nameIn = document.getElementById("simpleLoginName"), emailIn = document.getElementById("simpleLoginEmail");
      if (nameIn) nameIn.value = __user.name || ""; if (emailIn) emailIn.value = __user.email || "";
      updateTierUI(__user.tier, __user.tier_label);
      loadSubscriptionInfo(); loadHistory(); setComposerEnabled(true); checkUnreadSupport();
    } else {
      updateTierUI("free", "Free plan");
      const meta = document.getElementById("tierMeta"); if (meta) meta.textContent = "Sign in to continue";
      setComposerEnabled(false);
    }
  } catch {}
}

function setComposerEnabled(on) {
  if (input) input.disabled = !on; if (sendBtn) sendBtn.disabled = !on; if (micBtn) micBtn.disabled = !on;
  const disc = document.getElementById("disclaimer"); if (!disc) return;
  disc.innerHTML = on ? `MiroxAI can make mistakes. Made by the <b>OpenSurr</b> team.` : `Please <a href="#" id="loginLink">sign in</a> to start chatting. Made by the <b>OpenSurr</b> team.`;
  const link = document.getElementById("loginLink");
  if (link) link.addEventListener("click", e => { e.preventDefault(); openModal("loginModal"); });
}

function updateTierUI(tier, label) {
  __tier = tier || "free";
  const labelEl = document.getElementById("tierLabel"); if (labelEl) labelEl.textContent = (label || "Free") + " plan";
  const icon = document.querySelector(".tier-chip-icon");
  if (icon) icon.style.background = __tier === "ultimate" ? "linear-gradient(135deg,#8b5cf6,#6d28d9)" : __tier === "pro" ? "linear-gradient(135deg,#3b82f6,#1d4ed8)" : "linear-gradient(135deg,var(--accent),var(--accent-hover))";
  const ub = document.getElementById("upgradeBtn"); if (ub) ub.textContent = __tier === "free" ? "Upgrade" : "Manage";
}

async function loadSubscriptionInfo() {
  if (!__user) return;
  try {
    const r = await fetch("/api/subscription/me"); const d = await r.json(); if (!d.ok) return;
    __modelsAllowed = d.models_allowed || ["mirox-gen1"];
    __imagesAllowed = !!d.images_allowed; __videoAllowed = !!d.video_allowed; __dailyRemaining = d.daily_remaining;
    updateTierUI(d.tier, d.tier_label);
    const meta = document.getElementById("tierMeta");
    if (meta) {
      if (d.lite_mode) { const h = Math.floor((d.daily_reset_seconds || 0) / 3600); meta.textContent = `Lite mode — resets in ${h}h`; }
      else {
        const parts = [`${d.daily_remaining}/${d.daily_limit} msgs`];
        if (typeof d.img_5h_remaining === "number" && d.img_5h_remaining >= 0) parts.push(`${d.img_5h_remaining} img/5h`);
        if (typeof d.vision_remaining === "number" && d.vision_remaining >= 0) parts.push(`${d.vision_remaining} vision/day`);
        if (d.video_allowed && typeof d.video_remaining === "number") parts.push(d.video_remaining < 0 ? "video ∞" : `${d.video_remaining} video/day`);
        meta.textContent = parts.join(" · ");
      }
    }
    const ku = document.getElementById("keysUsage"); if (ku) ku.textContent = `${d.keys_remaining}/${d.keys_per_period} keys · refill every ${d.refill_days}d`;
    refreshModelLocks(); refreshImageGate(); refreshVideoGate();
  } catch {}
}

function refreshModelLocks() {
  document.querySelectorAll(".model-chip").forEach(chip => {
    const id = chip.dataset.modelId; if (!id) return;
    chip.classList.toggle("locked", !__modelsAllowed.includes(id));
  });
}

const simpleLoginForm = document.getElementById("simpleLoginForm");
if (simpleLoginForm) simpleLoginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const status = document.getElementById("loginStatus");
  const name = document.getElementById("simpleLoginName").value.trim();
  const email = document.getElementById("simpleLoginEmail").value.trim();
  if (!name || !email) { status.textContent = "Name and email are required."; return; }
  status.textContent = "Signing in…";
  try {
    const r = await fetch("/api/auth/simple-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
    const d = await r.json();
    if (d.ok) { window.__user = d.user; __user = d.user; document.getElementById("userChipLabel").textContent = d.user.name; status.textContent = "Signed in ✅"; closeModal("loginModal"); loadMe(); setComposerEnabled(true); }
    else status.textContent = d.error || "Failed.";
  } catch { status.textContent = "Could not reach the server."; }
});

const logoutBtnEl = document.getElementById("logoutBtn");
if (logoutBtnEl) logoutBtnEl.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.__user = null; __user = null;
  document.getElementById("userChipLabel").textContent = "Sign in";
  document.getElementById("simpleLoginName").value = ""; document.getElementById("simpleLoginEmail").value = "";
  document.getElementById("tierMeta").textContent = "Sign in to continue";
  setComposerEnabled(false); loadHistory();
});

const modelSwitcher = document.getElementById("modelSwitcher");
window.__model = "mirox-gen1";
async function loadModels() {
  try {
    const r = await fetch("/api/models"); const d = await r.json();
    window.__model = d.default || "mirox-gen1";
    modelSwitcher.innerHTML = "";
    (d.models || []).forEach(m => {
      const c = document.createElement("button"); c.type = "button";
      c.className = "model-chip" + (m.id === window.__model ? " active" : "");
      c.dataset.modelId = m.id; c.title = m.tagline || ""; c.textContent = m.label;
      c.addEventListener("click", () => {
        if (c.classList.contains("locked")) { openModal("plansModal"); loadPlans(); return; }
        window.__model = m.id;
        modelSwitcher.querySelectorAll(".model-chip").forEach(x => x.classList.remove("active"));
        c.classList.add("active");
      });
      modelSwitcher.appendChild(c);
    });
    refreshModelLocks();
  } catch {}
}
loadModels();

let plansCache = [];
async function loadPlans() {
  try {
    const r = await fetch("/api/subscription/plans"); const d = await r.json();
    plansCache = d.plans || [];
    const email = d.admin_email || "admin@example.com", phone = d.admin_phone || "";
    document.getElementById("plansEmail").textContent = email; document.getElementById("buyEmail").textContent = email;
    if (phone) { document.getElementById("plansPhone").textContent = phone; document.getElementById("plansPhoneWrap").style.display = ""; }
    else document.getElementById("plansPhoneWrap").style.display = "none";
    renderPlans(plansCache);
  } catch {}
}
function renderPlans(plans) {
  const grid = document.getElementById("plansGrid"); if (!grid) return;
  grid.innerHTML = plans.map(p => {
    const isCurrent = __tier === p.id, featured = p.id === "pro";
    let priceHtml = '<span style="color:var(--text-muted);font-weight:700">Free</span>';
    if (p.price_robux > 0) priceHtml = `R$ ${p.price_robux}<span class="currency">or ${p.price_afg} AFG</span>`;
    let buyBtn;
    if (p.id === "free") buyBtn = `<div class="plan-buy disabled">Free forever</div>`;
    else if (isCurrent) buyBtn = `<div class="plan-buy disabled">Current plan</div>`;
    else buyBtn = `<button class="plan-buy" data-buy="${p.id}">Buy ${escapeHtml(p.label)}</button>`;
    return `<div class="plan-card${featured ? " featured" : ""}${isCurrent ? " current" : ""}">
    ${isCurrent ? '<span class="plan-badge current">Current</span>' : (featured ? '<span class="plan-badge">Popular</span>' : "")}
    <div class="plan-name">${escapeHtml(p.label)}</div>
    <div class="plan-tagline">${escapeHtml(p.tagline)}</div>
    <div class="plan-price">${priceHtml}</div>
    <ul class="plan-perks">${p.perks.map(perk => `<li><i class="ri-check-line"></i><span>${escapeHtml(perk)}</span></li>`).join("")}</ul>
    ${buyBtn}</div>`;
  }).join("");
  grid.querySelectorAll("[data-buy]").forEach(btn => btn.addEventListener("click", () => handleBuyClick(btn.dataset.buy)));
}
async function handleBuyClick(planId) {
  if (!__user) { sessionStorage.setItem("miroxai_pending_buy", planId); closeModal("plansModal"); openModal("loginModal"); document.getElementById("loginStatus").textContent = "Sign in first, then we will continue with your purchase."; return; }
  const plan = plansCache.find(p => p.id === planId); if (!plan) return;
  openBuyModal(plan);
}
function openBuyModal(plan) {
  document.getElementById("buyTitle").textContent = "Buy " + plan.label;
  document.getElementById("buySub").textContent = `${plan.tagline} · ${plan.daily_limit} msgs/day`;
  const opts = document.getElementById("buyOptions");
  const email = document.getElementById("plansEmail").textContent;
  const phone = document.getElementById("plansPhone").textContent;
  let html = "";
  if (plan.gamepass_id) html += `<a class="buy-option rbx" href="https://www.roblox.com/game-pass/${plan.gamepass_id}" target="_blank" rel="noopener"><div class="buy-option-icon"><i class="ri-robot-2-line"></i></div><div class="buy-option-info"><div class="buy-option-title">Pay with Robux</div><div class="buy-option-meta">Opens the Roblox gamepass page.</div></div><div class="buy-option-price">R$ ${plan.price_robux}</div></a>`;
    if (plan.price_afg > 0) html += `<div class="buy-option afg" id="afgBuyOption"><div class="buy-option-icon"><i class="ri-hand-coin-line"></i></div><div class="buy-option-info"><div class="buy-option-title">Pay with AFG (cash in person)</div><div class="buy-option-meta">Hand the money directly to the admin.</div></div><div class="buy-option-price">${plan.price_afg} AFG</div></div>`;
    opts.innerHTML = html;
    const afgEl = document.getElementById("afgBuyOption");
    if (afgEl) afgEl.addEventListener("click", () => {
      const ex = opts.querySelector(".afg-instructions"); if (ex) ex.remove();
      const div = document.createElement("div"); div.className = "afg-instructions";
      div.style.cssText = "margin-top:14px;padding:14px 16px;background:var(--accent-soft);border:1px solid var(--accent-ring);border-radius:12px;font-size:13px;line-height:1.7;color:var(--text)";
      div.innerHTML = `<b style="color:var(--accent)">How to pay with AFG:</b><br>1. Contact the admin to arrange a meeting:<br><div style="margin:8px 0 8px 12px;font-family:monospace;font-size:12.5px;background:var(--bg);padding:8px 12px;border-radius:8px;">📧 ${escapeHtml(email)}<br>${phone ? "📞 " + escapeHtml(phone) : ""}</div>2. Give <b>${plan.price_afg} AFG</b> in hand to the admin.<br>3. Take a photo of your receipt.<br>4. Email the photo to <b>${escapeHtml(email)}</b>.<br>5. Admin will upgrade your account to <b>${escapeHtml(plan.label)}</b> within 24 hours.<br><br><span style="color:#dc2626;font-weight:700">⚠ Fake or AI-edited receipts = permanent ban.</span>`;
      opts.appendChild(div);
    });
    openModal("buyModal");
}

async function loadUserKeys() {
  if (!__user) { document.getElementById("keysList").innerHTML = '<li class="key-empty">Sign in to manage API keys.</li>'; return; }
  try { const r = await fetch("/api/keys"); const d = await r.json(); if (!d.ok) return; renderKeys(d.keys || []); } catch {}
}
function renderKeys(keys) {
  const list = document.getElementById("keysList");
  if (!keys.length) { list.innerHTML = '<li class="key-empty">No keys yet. Generate one above.</li>'; return; }
  list.innerHTML = keys.map(k => {
    const fullKey = k.key || "", display = k.revoked ? "(revoked)" : (k.key_preview || "");
    return `<li class="key-item${k.revoked ? ' revoked' : ''}"><div class="key-info"><div class="key-name">${escapeHtml(k.name)} <span class="key-tier-badge ${k.tier}">${escapeHtml(k.tier)}</span></div><div class="key-value">${escapeHtml(display)}</div></div><div class="key-actions">${k.revoked ? "" : `<button class="key-btn" data-copy="${escapeHtml(fullKey)}" title="Copy key"><i class="ri-file-copy-line"></i></button>`}${k.revoked ? "" : `<button class="key-btn" data-revoke="${k.id}" title="Revoke"><i class="ri-delete-bin-line"></i></button>`}</div></li>`;
  }).join("");
  list.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", async () => {
    const ok = await copyToClipboard(btn.dataset.copy);
    if (ok) { btn.classList.add("copied"); const o = btn.innerHTML; btn.innerHTML = '<i class="ri-check-line"></i>'; setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = o; }, 1400); }
    else prompt("Copy your API key:", btn.dataset.copy);
  }));
    list.querySelectorAll("[data-revoke]").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("Revoke this key? It cannot be undone.")) return;
      await fetch(`/api/keys/${b.dataset.revoke}`, { method: "DELETE" });
      loadUserKeys(); loadSubscriptionInfo();
    }));
}
const generateKeyBtnEl = document.getElementById("generateKeyBtn");
if (generateKeyBtnEl) generateKeyBtnEl.addEventListener("click", async () => {
  const status = document.getElementById("keyGenStatus"), nameInput = document.getElementById("newKeyNameInput");
  if (!__user) { status.textContent = "Sign in first."; return; }
  status.textContent = "Generating…";
  try {
    const r = await fetch("/api/keys/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nameInput.value.trim() || "My key" }) });
    const d = await r.json();
    if (d.ok) { status.innerHTML = `Created ✅ — your new key: <code style="user-select:all">${escapeHtml(d.key)}</code>`; nameInput.value = ""; loadUserKeys(); loadSubscriptionInfo(); copyToClipboard(d.key); }
    else status.textContent = d.error || "Failed.";
  } catch { status.textContent = "Could not reach the server."; }
});

async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) { try { await navigator.clipboard.writeText(text); return true; } catch {} }
  try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.focus(); ta.select(); const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok; } catch { return false; }
}

let expandedTickets = new Set();
const submitReportBtnEl = document.getElementById("submitReportBtn");
if (submitReportBtnEl) submitReportBtnEl.addEventListener("click", async () => {
  const status = document.getElementById("reportStatus");
  const subject = document.getElementById("reportSubject").value.trim();
  const message = document.getElementById("reportMessage").value.trim();
  const category = document.getElementById("reportCategory").value;
  if (!message) { status.textContent = "Please describe your issue first."; return; }
  status.textContent = "Sending…";
  try {
    const r = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, message, category }) });
    const d = await r.json();
    if (d.ok) { status.textContent = ""; document.getElementById("reportSubject").value = ""; document.getElementById("reportMessage").value = ""; document.getElementById("ticketIdDisplay").textContent = d.ticket_id; document.getElementById("supportEta").style.display = "flex"; loadMyReports(); }
    else status.textContent = d.error || "Failed to send.";
  } catch { status.textContent = "Could not reach the server."; }
});
async function loadMyReports() {
  const box = document.getElementById("supportMine"); if (!box) return;
  try {
    const r = await fetch("/api/report/mine"); const d = await r.json();
    if (!d.ok || !d.reports?.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<h4>Your tickets (${d.reports.length})</h4>` + d.reports.map(t => {
      const isReplied = t.status === "replied", expanded = expandedTickets.has(t.id);
      const msgs = (t.messages || []).map(m => {
        const cls = m.from === "admin" ? "admin" : "user", label = m.from === "admin" ? "SUPPORT" : "YOU";
        return `<div class="tmsg ${cls}"><div>${escapeHtml(m.text || "")}</div><div class="meta">${label} · ${new Date((m.ts || 0) * 1000).toLocaleString()}</div></div>`;
      }).join("");
      return `<div class="support-ticket ${isReplied ? 'replied' : 'open'} ${expanded ? 'expanded' : ''}" data-ticket="${t.id}"><div class="support-ticket-head" data-toggle="${t.id}"><span class="pill ${isReplied ? 'ok' : 'warn'}">${isReplied ? 'Replied' : 'Waiting for agent'}</span><span class="subject">${escapeHtml(t.subject || '(no subject)')}</span>${t.unread_user ? '<span class="pill danger">NEW</span>' : ''}<i class="ri-arrow-right-s-line chev"></i></div><div class="support-ticket-body"><div class="support-thread">${msgs}</div><div class="support-reply-row"><input placeholder="Type a reply…" data-support-reply="${t.id}"><button data-support-send="${t.id}"><i class="ri-send-plane-fill"></i> Send</button></div></div></div>`;
    }).join("");
    box.querySelectorAll("[data-toggle]").forEach(h => h.onclick = () => {
      const id = h.dataset.toggle, el = h.closest('.support-ticket');
      if (expandedTickets.has(id)) { expandedTickets.delete(id); el.classList.remove('expanded'); }
      else { expandedTickets.add(id); el.classList.add('expanded'); setTimeout(() => { const inp = box.querySelector(`[data-support-reply="${id}"]`); if (inp) inp.focus(); }, 50); }
    });
    box.querySelectorAll("[data-support-send]").forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.supportSend, inp = box.querySelector(`[data-support-reply="${id}"]`);
      const text = (inp.value || '').trim(); if (!text) return;
      btn.disabled = true;
      try { const r = await fetch(`/api/report/${id}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); const d = await r.json(); if (d.ok) { inp.value = ''; expandedTickets.add(id); loadMyReports(); } } catch {}
      finally { btn.disabled = false; }
    });
  } catch { box.innerHTML = ""; }
}
setInterval(() => { if (document.getElementById("supportModal")?.classList.contains("open")) loadMyReports(); }, 20000);
async function checkUnreadSupport() {
  if (!window.__user) return;
  try {
    const r = await fetch("/api/report/mine"); const d = await r.json(); if (!d.ok) return;
    const unread = (d.reports || []).filter(t => t.unread_user > 0).length;
    let badge = document.getElementById("supportBadge");
    if (!badge && supportModeBtn) { badge = document.createElement("span"); badge.id = "supportBadge"; badge.className = "rail-badge"; supportModeBtn.querySelector(".rail-icon").appendChild(badge); }
    if (badge) { if (unread > 0) { badge.textContent = unread; badge.style.display = "flex"; } else badge.style.display = "none"; }
  } catch {}
}
setInterval(checkUnreadSupport, 30000); setTimeout(checkUnreadSupport, 3000);

const historyList = document.getElementById("historyList"), chatSearchInput = document.getElementById("chatSearchInput"), clearSearchBtn = document.getElementById("clearSearchBtn");
let searchDebounceTimer = null;
async function loadHistory(query) {
  const q = (query || "").trim();
  if (!__user) { if (historyList) historyList.innerHTML = '<li class="history-empty">Sign in to see chats</li>'; return; }
  try { const url = q ? `/api/history/search?q=${encodeURIComponent(q)}` : "/api/history"; const r = await fetch(url); const d = await r.json(); renderHistory(d.conversations || [], q); } catch {}
}
function highlightMatch(text, q) {
  if (!q) return escapeHtml(text);
  const safe = escapeHtml(text);
  const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
  return safe.replace(re, "<em>$1</em>");
}
function renderHistory(convos, q) {
  if (!historyList) return; historyList.innerHTML = "";
  if (!convos.length) { const e = document.createElement("li"); e.className = q ? "history-no-match" : "history-empty"; e.textContent = q ? "No chats matched." : "No conversations yet"; historyList.appendChild(e); return; }
  convos.forEach(c => {
    const item = document.createElement("li");
    item.className = "history-item" + (c.id === currentConversationId ? " active" : "");
    const titleHtml = q ? highlightMatch(c.title, q) : escapeHtml(c.title);
    const matchHtml = c.match ? `<span class="history-match">${highlightMatch(c.match, q)}</span>` : "";
    item.innerHTML = `<i class="ri-chat-3-line"></i><div><span>${titleHtml}</span>${matchHtml}</div><button class="history-delete"><i class="ri-delete-bin-line"></i></button>`;
    item.addEventListener("click", e => { if (e.target.closest(".history-delete")) return; openConversation(c.id); if (window.innerWidth <= 860) closeSidebar(); });
    item.querySelector(".history-delete").addEventListener("click", async e => { e.stopPropagation(); await fetch(`/api/history/${c.id}`, { method: "DELETE" }); if (c.id === currentConversationId) startNewChat(); loadHistory(q); });
    historyList.appendChild(item);
  });
}
if (chatSearchInput) chatSearchInput.addEventListener("input", () => {
  const q = chatSearchInput.value.trim(); clearSearchBtn.classList.toggle("visible", !!q);
  clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(() => loadHistory(q), 220);
});
if (clearSearchBtn) clearSearchBtn.addEventListener("click", () => { chatSearchInput.value = ""; clearSearchBtn.classList.remove("visible"); loadHistory(""); });
async function openConversation(id) {
  try {
    const r = await fetch(`/api/history/${id}`); if (!r.ok) return;
    const c = await r.json(); currentConversationId = c.id;
    chatTitle.textContent = c.title; chatSubtitle.textContent = "";
    chat.innerHTML = ""; c.messages.forEach(m => addMessage(m.text, m.role, { instant: true }));
    loadHistory(chatSearchInput.value.trim());
  } catch {}
}
function startNewChat() {
  currentConversationId = null; chat.innerHTML = "";
  addMessage("New chat started. How can I help?", "ai", { instant: true });
  chatTitle.textContent = "New chat"; chatSubtitle.textContent = "";
  clearAttachment(); loadHistory(chatSearchInput.value.trim());
}
if (newChatBtn) newChatBtn.addEventListener("click", () => { startNewChat(); if (window.innerWidth <= 860) closeSidebar(); });

let bgState = { url: null, dim: 45, blur: 0, fit: "cover" };
function loadBackground() { try { const saved = JSON.parse(localStorage.getItem("miroxai_bg") || "{}"); bgState = { url: saved.url || null, dim: saved.dim ?? 45, blur: saved.blur ?? 0, fit: saved.fit || "cover" }; } catch {} applyBackground(); populateBackgroundUI(); }
function applyBackground() {
  const el = document.getElementById("userBackground"); if (!el) return;
  if (!bgState.url) { el.classList.remove("active"); el.style.backgroundImage = ""; root.style.setProperty("--bg-dim", "0"); root.style.setProperty("--bg-blur", "0px"); return; }
  el.style.backgroundImage = `url('${bgState.url}')`;
  el.style.backgroundSize = bgState.fit === "repeat" ? "auto" : bgState.fit;
  el.style.backgroundRepeat = bgState.fit === "repeat" ? "repeat" : "no-repeat";
  el.style.setProperty("--bg-dim", (bgState.dim / 100).toFixed(2)); el.style.setProperty("--bg-blur", bgState.blur + "px");
  el.classList.add("active");
}
function saveBackgroundPrefs() { try { localStorage.setItem("miroxai_bg", JSON.stringify(bgState)); } catch {} }
function populateBackgroundUI() {
  const d = document.getElementById("bgDimInput"), b = document.getElementById("bgBlurInput");
  if (d) d.value = bgState.dim; if (b) b.value = bgState.blur;
  const dl = document.getElementById("bgDimLabel"); if (dl) dl.textContent = bgState.dim + "%";
  const bl = document.getElementById("bgBlurLabel"); if (bl) bl.textContent = bgState.blur + "px";
  document.querySelectorAll("#bgFitOptions .option-btn").forEach(x => x.classList.toggle("active", x.dataset.fit === bgState.fit));
  const urlEl = document.getElementById("bgUrlInput"); if (urlEl) urlEl.value = bgState.url && !bgState.url.startsWith("data:") ? bgState.url : "";
}
const bgUploadZone = document.getElementById("bgUploadZone"), bgFileInput = document.getElementById("bgFileInput");
if (bgUploadZone && bgFileInput) {
  bgUploadZone.addEventListener("click", () => bgFileInput.click());
  bgUploadZone.addEventListener("dragover", e => { e.preventDefault(); bgUploadZone.classList.add("drag"); });
  bgUploadZone.addEventListener("dragleave", () => bgUploadZone.classList.remove("drag"));
  bgUploadZone.addEventListener("drop", e => { e.preventDefault(); bgUploadZone.classList.remove("drag"); if (e.dataTransfer.files.length) uploadBackgroundLocal(e.dataTransfer.files[0]); });
  bgFileInput.addEventListener("change", () => { if (bgFileInput.files.length) uploadBackgroundLocal(bgFileInput.files[0]); bgFileInput.value = ""; });
}
async function fileToOptimizedDataURL(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("invalid image"));
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error("bad dims");
          if (w > maxDim || h > maxDim) { const s = Math.min(maxDim / w, maxDim / h); w = Math.round(w * s); h = Math.round(h * s); }
          const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function uploadBackgroundLocal(file) {
  const status = document.getElementById("bgStatus");
  if (!file.type || !file.type.startsWith("image/")) { status.textContent = "Please choose an image file."; return; }
  if (file.size > 20 * 1024 * 1024) { status.textContent = "Image is over 20MB."; return; }
  status.textContent = "Optimizing for iOS Safari…";
  try {
    const dataUrl = await fileToOptimizedDataURL(file, 1400, 0.82);
    const kb = Math.round((dataUrl.length * 0.75) / 1024);
    if (kb > 800) { const smaller = await fileToOptimizedDataURL(file, 1000, 0.72); bgState.url = smaller; status.textContent = `Set as background ✅ (${Math.round((smaller.length * 0.75) / 1024)} KB)`; }
    else { bgState.url = dataUrl; status.textContent = `Set as background ✅ (${kb} KB)`; }
    saveBackgroundPrefs(); applyBackground(); populateBackgroundUI();
  } catch { status.textContent = "Couldn't process the image. Try a different one."; }
}
const bgUrlApplyBtnEl = document.getElementById("bgUrlApplyBtn");
if (bgUrlApplyBtnEl) bgUrlApplyBtnEl.addEventListener("click", () => {
  const u = document.getElementById("bgUrlInput").value.trim(); if (!u) return;
  bgState.url = u; saveBackgroundPrefs(); applyBackground();
  document.getElementById("bgStatus").textContent = "URL applied ✅";
});
const bgDimInputEl = document.getElementById("bgDimInput");
if (bgDimInputEl) bgDimInputEl.addEventListener("input", e => { bgState.dim = parseInt(e.target.value); document.getElementById("bgDimLabel").textContent = bgState.dim + "%"; applyBackground(); });
const bgBlurInputEl = document.getElementById("bgBlurInput");
if (bgBlurInputEl) bgBlurInputEl.addEventListener("input", e => { bgState.blur = parseInt(e.target.value); document.getElementById("bgBlurLabel").textContent = bgState.blur + "px"; applyBackground(); });
document.querySelectorAll("#bgFitOptions .option-btn").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("#bgFitOptions .option-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active"); bgState.fit = b.dataset.fit; applyBackground();
}));
const bgSaveBtnEl = document.getElementById("bgSaveBtn");
if (bgSaveBtnEl) bgSaveBtnEl.addEventListener("click", () => { saveBackgroundPrefs(); applyBackground(); document.getElementById("bgStatus").textContent = "Saved ✅"; });
const bgRemoveBtnEl = document.getElementById("bgRemoveBtn");
if (bgRemoveBtnEl) bgRemoveBtnEl.addEventListener("click", () => { bgState.url = null; saveBackgroundPrefs(); applyBackground(); document.getElementById("bgUrlInput").value = ""; document.getElementById("bgStatus").textContent = "Removed."; });

let extensions = [];
try { extensions = JSON.parse(localStorage.getItem("miroxai_extensions") || "[]"); } catch { extensions = []; }
function saveExtensions() { try { localStorage.setItem("miroxai_extensions", JSON.stringify(extensions)); } catch {} }
function applyExtensions() {
  document.querySelectorAll('style[data-ext]').forEach(s => s.remove());
  extensions.forEach(ext => {
    if (!ext.enabled) return;
    const s = document.createElement("style"); s.setAttribute("data-ext", ext.id); s.textContent = ext.css || ""; document.head.appendChild(s);
  });
}
function renderExtensions() {
  const list = document.getElementById("extList"); if (!list) return; list.innerHTML = "";
  if (!extensions.length) { const e = document.createElement("li"); e.className = "ext-empty"; e.textContent = "No extensions yet."; list.appendChild(e); return; }
  extensions.forEach(ext => {
    const li = document.createElement("li"); li.className = "ext-item";
    li.innerHTML = `<label class="ext-toggle"><input type="checkbox" ${ext.enabled ? "checked" : ""}><span class="ext-slider"></span></label><div class="ext-info"><div class="ext-name">${escapeHtml(ext.name)}</div><div class="ext-preview">${escapeHtml((ext.css || "").slice(0, 90).replace(/\n/g, " "))}${(ext.css || "").length > 90 ? "…" : ""}</div></div><button class="ext-action" data-edit><i class="ri-pencil-line"></i></button><button class="ext-action" data-delete><i class="ri-delete-bin-line"></i></button>`;
    li.querySelector("input").addEventListener("change", e => { ext.enabled = e.target.checked; saveExtensions(); applyExtensions(); });
    li.querySelector("[data-edit]").addEventListener("click", () => { document.getElementById("extNameInput").value = ext.name; document.getElementById("extCssInput").value = ext.css; document.getElementById("extSaveBtn").dataset.editingId = ext.id; document.getElementById("extStatus").textContent = "Editing: " + ext.name; });
    li.querySelector("[data-delete]").addEventListener("click", () => { if (!confirm("Delete " + ext.name + "?")) return; extensions = extensions.filter(e => e.id !== ext.id); saveExtensions(); applyExtensions(); renderExtensions(); });
    list.appendChild(li);
  });
}
const EXT_PRESETS = {
  font: { name: "Custom font", css: `html, body, .bubble, input, textarea, button, select { font-family: 'Comic Sans MS', 'Trebuchet MS', cursive !important; }` },
  rounded: { name: "Rounded corners", css: `.bubble, .composer, .modal, .rail-btn, .icon-btn, .send-btn, input, textarea, .save-btn, .option-btn, .chip, .model-chip, .proj-card { border-radius: 18px !important; }` },
  compact: { name: "Compact mode", css: `.chat { padding: 14px !important; gap: 12px !important; } .bubble { font-size: 13.5px !important; } .avatar { width: 26px !important; height: 26px !important; min-width: 26px !important; }` },
  accent: { name: "Custom accent", css: `:root { --accent: #ff0080 !important; --accent-hover: #cc0066 !important; --accent-soft: rgba(255,0,128,.12) !important; --accent-ring: rgba(255,0,128,.3) !important; --accent-glow: rgba(255,0,128,.4) !important; }` }
};
document.querySelectorAll(".ext-preset[data-preset]").forEach(btn => btn.addEventListener("click", () => {
  const p = EXT_PRESETS[btn.dataset.preset]; if (!p) return;
  document.getElementById("extNameInput").value = p.name; document.getElementById("extCssInput").value = p.css; document.getElementById("extStatus").textContent = "Preset loaded.";
}));
const extSaveBtnEl = document.getElementById("extSaveBtn");
if (extSaveBtnEl) extSaveBtnEl.addEventListener("click", () => {
  const name = document.getElementById("extNameInput").value.trim(), css = document.getElementById("extCssInput").value;
  const status = document.getElementById("extStatus"), btn = document.getElementById("extSaveBtn"), editingId = btn.dataset.editingId;
  if (!name) { status.textContent = "Name required."; return; }
  if (!css.trim()) { status.textContent = "CSS required."; return; }
  if (editingId) { const ext = extensions.find(e => e.id === editingId); if (ext) { ext.name = name; ext.css = css; } delete btn.dataset.editingId; status.textContent = "Updated ✅"; }
  else { extensions.push({ id: "ext_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, css, enabled: true }); status.textContent = "Saved ✅"; }
  saveExtensions(); applyExtensions(); renderExtensions();
  document.getElementById("extNameInput").value = ""; document.getElementById("extCssInput").value = "";
});
const extClearBtnEl = document.getElementById("extClearBtn");
if (extClearBtnEl) extClearBtnEl.addEventListener("click", () => { document.getElementById("extNameInput").value = ""; document.getElementById("extCssInput").value = ""; document.getElementById("extStatus").textContent = ""; delete document.getElementById("extSaveBtn").dataset.editingId; });

const LANG_META = {
  html:{label:"HTML",icon:"ri-html5-fill",runnable:true},htm:{label:"HTML",icon:"ri-html5-fill",runnable:true},
  svg:{label:"SVG",icon:"ri-image-line",runnable:true},css:{label:"CSS",icon:"ri-css3-fill",runnable:true},
  js:{label:"JavaScript",icon:"ri-javascript-fill",runnable:true},javascript:{label:"JavaScript",icon:"ri-javascript-fill",runnable:true},
  mjs:{label:"JavaScript",icon:"ri-javascript-fill",runnable:true},jsx:{label:"JSX",icon:"ri-reactjs-fill"},
  ts:{label:"TypeScript",icon:"ri-code-s-slash-line",runnable:true},typescript:{label:"TypeScript",icon:"ri-code-s-slash-line",runnable:true},
  python:{label:"Python",icon:"ri-code-s-slash-line"},py:{label:"Python",icon:"ri-code-s-slash-line"},
  lua:{label:"Lua",icon:"ri-code-s-slash-line"},rb:{label:"Ruby",icon:"ri-code-s-slash-line"},
  go:{label:"Go",icon:"ri-code-s-slash-line"},rust:{label:"Rust",icon:"ri-code-s-slash-line"},rs:{label:"Rust",icon:"ri-code-s-slash-line"},
  java:{label:"Java",icon:"ri-code-s-slash-line"},c:{label:"C",icon:"ri-code-s-slash-line"},h:{label:"Header",icon:"ri-code-s-slash-line"},
  cpp:{label:"C++",icon:"ri-code-s-slash-line"},csharp:{label:"C#",icon:"ri-code-s-slash-line"},cs:{label:"C#",icon:"ri-code-s-slash-line"},
  php:{label:"PHP",icon:"ri-code-s-slash-line"},sql:{label:"SQL",icon:"ri-database-2-line"},
  bash:{label:"Bash",icon:"ri-terminal-box-line"},sh:{label:"Shell",icon:"ri-terminal-box-line"},
  json:{label:"JSON",icon:"ri-brackets-line"},yaml:{label:"YAML",icon:"ri-file-list-3-line"},yml:{label:"YAML",icon:"ri-file-list-3-line"},
  xml:{label:"XML",icon:"ri-code-line"},markdown:{label:"Markdown",icon:"ri-markdown-fill"},md:{label:"Markdown",icon:"ri-markdown-fill"},
  plaintext:{label:"Text",icon:"ri-file-text-line"}
};
function getLangMeta(lang) { const k = (lang || "").toLowerCase(); return LANG_META[k] || { label: (lang || "Code").toUpperCase(), icon: "ri-code-s-slash-line", runnable: false }; }
let lastRunnableDoc = "";
function buildRunnableDoc(lang, code) {
  const l = (lang || "").toLowerCase();
  if (l === "html" || l === "htm" || l === "svg") return code;
  if (l === "css") return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;padding:32px;background:#0f1014;color:#e5e7eb;margin:0}.demo{padding:24px;border-radius:12px;background:#1a1c22;border:1px solid #2a2d36}${code}</style></head><body><div class="demo"><h2>CSS Preview</h2><p>Sample with <a href="#">a link</a>.</p><button>Button</button></div></body></html>`;
  if (["js","javascript","mjs","ts","typescript"].includes(l)) {
    let js = code;
    if (l === "ts" || l === "typescript") js = js.replace(/:\s*(string|number|boolean|any|void|unknown|never)\b/g, "");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:ui-monospace,monospace;padding:20px;background:#0f1014;color:#e5e7eb;margin:0;font-size:13px}.out{white-space:pre-wrap;line-height:1.55}.err{color:#f87171}.label{font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:8px}</style></head><body><div class="label">Console</div><div class="out" id="out"></div><scr`+`ipt>const out=document.getElementById('out');const fmt=x=>x===null?'null':x===undefined?'undefined':(typeof x==='object')?JSON.stringify(x,null,2):String(x);const log=(...a)=>{out.textContent+=a.map(fmt).join(' ')+'\\n'};console.log=log;console.info=log;console.warn=log;console.error=log;window.onerror=m=>{out.innerHTML+='<span class="err">'+m+'</span>\\n'};try{${js}}catch(e){out.innerHTML+='<span class="err">'+e.message+'</span>'}</scr`+`ipt></body></html>`;
  }
  return null;
}
function runCode(lang, code) {
  const doc = buildRunnableDoc(lang, code); if (!doc) return;
  lastRunnableDoc = doc;
  if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = ""; }
  currentBlobUrl = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
  const frame = document.getElementById("runFrame"); if (frame) frame.src = currentBlobUrl;
  const langLabel = document.getElementById("runModalLang"); if (langLabel) langLabel.textContent = getLangMeta(lang).label + " Preview";
  openModal("runModal");
}
const runRefreshBtnEl = document.getElementById("runRefreshBtn");
if (runRefreshBtnEl) runRefreshBtnEl.addEventListener("click", () => { if (!lastRunnableDoc) return; if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = ""; } currentBlobUrl = URL.createObjectURL(new Blob([lastRunnableDoc], { type: "text/html;charset=utf-8" })); document.getElementById("runFrame").src = currentBlobUrl; });
const runOpenTabBtnEl = document.getElementById("runOpenTabBtn");
if (runOpenTabBtnEl) runOpenTabBtnEl.addEventListener("click", () => { if (!lastRunnableDoc) return; const url = URL.createObjectURL(new Blob([lastRunnableDoc], { type: "text/html;charset=utf-8" })); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000); });
function highlightBlock(codeEl, lang) {
  if (!window.hljs) return;
  const raw = codeEl.textContent || ""; if (!raw.trim()) return;
  codeEl.classList.remove("hljs"); codeEl.removeAttribute("data-highlighted");
  const alias = { js:"javascript",mjs:"javascript",ts:"typescript",py:"python",rb:"ruby",sh:"bash",shell:"bash",zsh:"bash",yml:"yaml",md:"markdown",htm:"xml",html:"xml",rs:"rust",kt:"kotlin",cs:"csharp" };
  const norm = lang ? (alias[lang.toLowerCase()] || lang.toLowerCase()) : "";
  try {
    let result;
    if (norm && hljs.getLanguage(norm)) result = hljs.highlight(raw, { language: norm, ignoreIllegals: true });
    else result = hljs.highlightAuto(raw);
    codeEl.innerHTML = result.value; codeEl.classList.add("hljs"); if (result.language) codeEl.classList.add("language-" + result.language);
  } catch { codeEl.textContent = raw; codeEl.classList.add("hljs"); }
}
function balanceFences(text) { const c = (text.match(/^```/gm) || []).length; return c % 2 === 1 ? text + "\n```" : text; }
function renderRichText(container, text) {
  if (!window.marked || !window.DOMPurify) { container.textContent = text; return; }
  const safe = balanceFences(text);
  const raw = marked.parse(safe, { breaks: true, gfm: true });
  container.innerHTML = DOMPurify.sanitize(raw, { ADD_ATTR: ["target","class"] });
  container.querySelectorAll("a").forEach(a => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  container.querySelectorAll("pre code").forEach(block => { let lang = ""; const m = (block.className || "").match(/language-([a-z0-9+#-]+)/i); if (m) lang = m[1]; highlightBlock(block, lang); });
  decorateCodeBlocks(container);
}
function decorateCodeBlocks(container) {
  container.querySelectorAll("pre").forEach(pre => {
    if (pre.closest(".code-block")) return;
    const codeEl = pre.querySelector("code"); if (!codeEl) return;
    let lang = ""; const m = (codeEl.className || "").match(/language-([a-z0-9+#-]+)/i); if (m) lang = m[1];
    const meta = getLangMeta(lang), codeText = codeEl.textContent;
    const wrapper = document.createElement("div"); wrapper.className = "code-block";
    pre.parentNode.insertBefore(wrapper, pre); wrapper.appendChild(pre);
    const header = document.createElement("div"); header.className = "code-header";
    const langEl = document.createElement("span"); langEl.className = "lang"; langEl.innerHTML = `<i class="${meta.icon}"></i><span>${escapeHtml(meta.label)}</span>`;
    const actions = document.createElement("div"); actions.className = "code-actions";
    const copyBtn = document.createElement("button"); copyBtn.type = "button"; copyBtn.className = "code-action-btn";
    copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copy';
    copyBtn.addEventListener("click", () => { copyToClipboard(codeText).then(ok => { copyBtn.innerHTML = ok ? '<i class="ri-check-line"></i> Copied' : '<i class="ri-error-warning-line"></i>'; setTimeout(() => { copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copy'; }, 1400); }); });
    actions.appendChild(copyBtn);
    if (meta.runnable) { const runBtn = document.createElement("button"); runBtn.type = "button"; runBtn.className = "code-action-btn run"; runBtn.innerHTML = '<i class="ri-play-fill"></i> Run'; runBtn.addEventListener("click", () => runCode(lang, codeText)); actions.appendChild(runBtn); }
    header.appendChild(langEl); header.appendChild(actions); wrapper.insertBefore(header, pre);
  });
}
function addThinking() {
  document.getElementById("thinkingMessage")?.remove();
  const m = document.createElement("div"); m.className = "message ai"; m.id = "thinkingMessage";
  m.innerHTML = `<div class="avatar ai-avatar"><img src="logo.png" alt="" class="theme-logo"></div><div class="bubble-wrap"><div class="bubble"><div class="thinking"><span class="thinking-word"><span>T</span><span>h</span><span>i</span><span>n</span><span>k</span><span>i</span><span>n</span><span>g</span></span><span class="thinking-dots"><span></span><span></span><span></span></span></div></div></div>`;
  chat.appendChild(m); scrollToBottom();
}
function removeThinking() { document.getElementById("thinkingMessage")?.remove(); }
function addWebSearchStatus() {
  document.getElementById("webSearchStatus")?.remove();
  const m = document.createElement("div"); m.className = "message ai"; m.id = "webSearchStatus";
  m.innerHTML = `<div class="avatar ai-avatar"><img src="logo.png" alt="" class="theme-logo"></div><div class="bubble-wrap"><div class="bubble"><div class="web-status searching"><div class="ws-icon"><i class="ri-global-line"></i></div><div>Searching the web<span class="ws-dots"><span></span><span></span><span></span></span></div></div></div></div>`;
  chat.appendChild(m); scrollToBottom();
}
function removeWebSearchStatus() { document.getElementById("webSearchStatus")?.remove(); }
function buildMessage(text, sender) {
  const m = document.createElement("div"); m.className = `message ${sender}`;
  if (sender !== "system") { const a = document.createElement("div"); a.className = `avatar ${sender === "ai" ? "ai-avatar" : "user-avatar"}`; a.innerHTML = sender === "ai" ? '<img src="logo.png" alt="" class="theme-logo">' : '<i class="ri-user-3-line"></i>'; m.appendChild(a); }
  const w = document.createElement("div"); w.className = "bubble-wrap";
  const b = document.createElement("div"); b.className = "bubble";
  if (sender === "ai") renderRichText(b, text); else b.textContent = text;
  w.appendChild(b); m.appendChild(w); chat.appendChild(m);
  return { message: m, bubble: b, wrap: w };
}
function addActions(wrap, text, sender) {
  if (sender !== "user" && sender !== "ai") return;
  const actions = document.createElement("div"); actions.className = "msg-actions";
  const copyBtn = document.createElement("button"); copyBtn.type = "button"; copyBtn.className = "msg-action-btn"; copyBtn.title = "Copy";
  copyBtn.innerHTML = '<i class="ri-file-copy-line"></i>';
  copyBtn.addEventListener("click", () => { copyToClipboard(text).then(ok => { copyBtn.innerHTML = ok ? '<i class="ri-check-line"></i>' : '<i class="ri-error-warning-line"></i>'; setTimeout(() => { copyBtn.innerHTML = '<i class="ri-file-copy-line"></i>'; }, 1200); }); });
  actions.appendChild(copyBtn); wrap.appendChild(actions);
}
function addMessage(text, sender, opts = {}) {
  const { bubble, wrap } = buildMessage(text, sender);
  if (!opts.skipActions) addActions(wrap, text, sender);
  scrollToBottom(); return { bubble, wrap };
}
function parseProjectFilesFromText(text) {
  const files = []; const re = /```file:([^\n`]+)\n([\s\S]*?)\n```/g; let m;
  while ((m = re.exec(text)) !== null) { const path = m[1].trim(), content = m[2]; const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : ""; files.push({ path, content, lang: ext || "plaintext" }); }
  return files;
}
function renderProjectPanel(wrap, files) {
  if (!files.length) return;
  const panel = document.createElement("div"); panel.className = "project-panel";
  panel.innerHTML = `<div class="project-head"><div class="project-title"><i class="ri-folder-code-line"></i><span>Project files</span><span class="count">${files.length} ${files.length === 1 ? "file" : "files"}</span></div><div class="project-actions"><button type="button" class="proj-btn" data-dl-all><i class="ri-download-2-line"></i> Download all (.zip)</button></div></div><div class="proj-files"></div>`;
  const grid = panel.querySelector(".proj-files");
  files.forEach(f => {
    const meta = getLangMeta(f.lang), bytes = (f.content || "").length, sizeStr = bytes < 1024 ? bytes + " B" : (bytes / 1024).toFixed(1) + " KB";
    const card = document.createElement("div"); card.className = "proj-card";
    card.innerHTML = `<div class="proj-icon"><i class="${meta.icon}"></i></div><div class="proj-info"><div class="proj-name">${escapeHtml(f.path)}</div><div class="proj-meta">${escapeHtml(meta.label)} · ${sizeStr}</div></div><button type="button" class="proj-dl"><i class="ri-download-line"></i></button>`;
    card.querySelector(".proj-dl").addEventListener("click", () => { const blob = new Blob([f.content], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = f.path.split("/").pop() || "file.txt"; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000); });
    grid.appendChild(card);
  });
  panel.querySelector("[data-dl-all]").addEventListener("click", async () => {
    const btn = panel.querySelector("[data-dl-all]"), old = btn.innerHTML;
    btn.innerHTML = '<i class="ri-loader-4-line"></i> Zipping…'; btn.disabled = true;
    try {
      const r = await fetch("/api/project/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
      if (!r.ok) throw new Error("Server error");
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "miroxai-project.zip";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { alert("Download failed: " + e.message); }
    finally { btn.innerHTML = old; btn.disabled = false; }
  });
  wrap.appendChild(panel);
}

const fileInput = document.getElementById("fileInput"), attachBtn = document.getElementById("attachBtn");
const attachmentPreview = document.getElementById("attachmentPreview"), attachmentName = document.getElementById("attachmentName");
const removeAttachmentBtn = document.getElementById("removeAttachmentBtn"), attSpinner = document.getElementById("attSpinner"), attIcon = document.getElementById("attIcon"), attThumb = document.getElementById("attThumb");
let pendingAttachment = null;
if (attachBtn) attachBtn.addEventListener("click", () => fileInput.click());
function looksBinary(str) { const s = Math.min(str.length, 2000); if (!s) return false; let sus = 0; for (let i = 0; i < s; i++) { const c = str.charCodeAt(i); if (c === 0) return true; if (c < 9 || (c > 13 && c < 32)) sus++; } return sus / s > 0.15; }
function isImageFile(file) { if (!file) return false; const type = (file.type || "").toLowerCase(); if (type.startsWith("image/")) return true; return /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(file.name || ""); }
function setFileStatus(state, text) {
  if (!attachmentPreview) return;
  attachmentPreview.style.display = "flex"; attachmentPreview.classList.remove("reading", "ready");
  if (state === "reading") { attachmentPreview.classList.add("reading"); if (attSpinner) attSpinner.style.display = "inline-flex"; if (attIcon) attIcon.style.display = "none"; if (attThumb) attThumb.style.display = "none"; }
  else if (state === "ready") { attachmentPreview.classList.add("ready"); if (attSpinner) attSpinner.style.display = "none"; }
  else { if (attSpinner) attSpinner.style.display = "none"; if (attIcon) attIcon.style.display = "none"; if (attThumb) attThumb.style.display = "none"; }
  if (attachmentName) attachmentName.textContent = text;
}
if (fileInput) fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0]; if (!file) return;
  if (isImageFile(file)) {
    if (file.size > 12 * 1024 * 1024) { addMessage("That image is over 12MB.", "ai", { instant: true }); fileInput.value = ""; return; }
    setFileStatus("reading", "Optimizing image…");
    try {
      const dataUrl = await fileToOptimizedDataURL(file, 1200, 0.85);
      const kb = Math.round((dataUrl.length * 0.75) / 1024);
      setFileStatus("ready", `${file.name} · ${kb} KB · ready`);
      if (attThumb) { attThumb.src = dataUrl; attThumb.style.display = "block"; }
      if (attIcon) attIcon.style.display = "none";
                                          pendingAttachment = { name: file.name, content: dataUrl, type: "image" };
    } catch { if (attachmentPreview) attachmentPreview.style.display = "none"; addMessage("Couldn't read that image. Try a smaller one.", "ai", { instant: true }); }
    fileInput.value = ""; return;
  }
  if (file.size > 2 * 1024 * 1024) { addMessage("That file is over 2MB.", "ai", { instant: true }); fileInput.value = ""; return; }
  setFileStatus("reading", "Reading file…");
  const reader = new FileReader();
  reader.onload = () => {
    const content = String(reader.result);
    if (looksBinary(content)) { if (attachmentPreview) attachmentPreview.style.display = "none"; addMessage(`"${file.name}" looks binary. Attach images through the same button — they'll be sent to vision.`, "ai", { instant: true }); return; }
    setFileStatus("reading", "Understanding file…");
    setTimeout(() => {
      const kb = (content.length / 1024).toFixed(1);
      setFileStatus("ready", `${file.name} · ${kb} KB · ready`);
      if (attThumb) { attThumb.src = ""; attThumb.style.display = "none"; }
      if (attIcon) attIcon.style.display = "inline-flex";
      pendingAttachment = { name: file.name, content, type: "text" };
    }, 200);
  };
  reader.onerror = () => { if (attachmentPreview) attachmentPreview.style.display = "none"; addMessage("Couldn't read that file.", "ai", { instant: true }); };
  reader.readAsText(file); fileInput.value = "";
});
function clearAttachment() { pendingAttachment = null; if (attachmentPreview) attachmentPreview.style.display = "none"; if (attachmentPreview) attachmentPreview.classList.remove("reading", "ready"); if (attThumb) { attThumb.src = ""; attThumb.style.display = "none"; } if (attIcon) attIcon.style.display = "none"; }
if (removeAttachmentBtn) removeAttachmentBtn.addEventListener("click", clearAttachment);

const searchToggleBtn = document.getElementById("searchToggleBtn");
let webSearchEnabled = false;
if (searchToggleBtn) searchToggleBtn.addEventListener("click", () => { webSearchEnabled = !webSearchEnabled; searchToggleBtn.classList.toggle("active", webSearchEnabled); });

function normalizeSources(data) {
  const raw = (Array.isArray(data.sources) && data.sources) || [];
  return raw.map((s, i) => {
    if (typeof s === "string") return { title: safeHostname(s) || "source", url: s, index: i + 1 };
    const url = s.url || s.link || s.href || "";
    const title = s.title || s.name || safeHostname(url) || `Source ${i + 1}`;
    return { title, url, index: i + 1 };
  }).filter(s => s.url || s.title);
}
function renderSources(wrap, sources) {
  if (!sources || !sources.length) return;
  const box = document.createElement("div"); box.className = "sources";
  box.innerHTML = `<div class="sources-head"><i class="ri-links-line"></i><span>Sources · ${sources.length}</span></div><div class="sources-row"></div>`;
  const row = box.querySelector(".sources-row");
  sources.forEach(s => { const a = document.createElement("a"); a.className = "source-card"; a.href = s.url || "#"; a.target = "_blank"; a.rel = "noopener noreferrer"; const host = safeHostname(s.url) || ""; a.innerHTML = `<div class="source-favicon">${s.index}</div><div class="source-meta"><div class="source-title">${escapeHtml(s.title)}</div><div class="source-url">${escapeHtml(host || s.url || "")}</div></div>`; row.appendChild(a); });
  wrap.appendChild(box);
}

async function handleInlineImage(prompt) {
  if (!__user) { addMessage("Sign in to generate images.", "ai"); return; }
  if (!__imagesAllowed) { addMessage("Image generation requires Pro or Ultimate. Open the Plans tab to upgrade.", "ai"); return; }
  addMessage(`/image ${prompt}`, "user");
  const { bubble } = buildMessage("", "ai");
  const wrapDiv = document.createElement("div"); wrapDiv.className = "img-gen-wrap";
  wrapDiv.innerHTML = `<div class="img-gen-bg"></div><div class="img-gen-stage"><div class="img-gen-orb"></div><div class="img-gen-label">Generating image…</div><div class="img-gen-progress"><div class="img-gen-progress-bar"></div></div></div>`;
  bubble.appendChild(wrapDiv); scrollToBottom();
  try {
    const r = await fetch("/api/image/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, style: "", ratio: "1:1" }) });
    const data = await r.json();
    if (!r.ok || !data.image) { wrapDiv.innerHTML = `<div class="gallery-error"><i class="ri-error-warning-line"></i><span>${escapeHtml(data.error || "Failed.")}</span></div>`; return; }
    wrapDiv.innerHTML = `<img class="img-gen-result" src="${data.image}" alt="${escapeHtml(prompt)}">`;
    const actions = document.createElement("div"); actions.className = "img-gen-actions";
    const dlBtn = document.createElement("button"); dlBtn.className = "proj-btn ghost"; dlBtn.innerHTML = '<i class="ri-download-2-line"></i> Download';
    dlBtn.addEventListener("click", () => { const a = document.createElement("a"); a.href = data.image; a.download = "miroxai-image.png"; document.body.appendChild(a); a.click(); document.body.removeChild(a); });
    const regenBtn = document.createElement("button"); regenBtn.className = "proj-btn ghost"; regenBtn.innerHTML = '<i class="ri-refresh-line"></i> Regenerate';
    regenBtn.addEventListener("click", () => handleInlineImage(prompt));
    actions.appendChild(dlBtn); actions.appendChild(regenBtn); bubble.appendChild(actions); scrollToBottom();
  } catch { wrapDiv.innerHTML = `<div class="gallery-error"><i class="ri-error-warning-line"></i><span>Couldn't reach the server.</span></div>`; }
}

async function handleInlineVideo(prompt) {
  if (!__user) { addMessage("Sign in to generate videos.", "ai"); return; }
  if (!__videoAllowed) { addMessage("Video generation requires Pro or Ultimate. Open the Plans tab to upgrade.", "ai"); return; }
  addMessage(`/video ${prompt}`, "user");
  const { bubble } = buildMessage("", "ai");
  const wrapDiv = document.createElement("div"); wrapDiv.className = "img-gen-wrap";
  wrapDiv.innerHTML = `<div class="img-gen-bg"></div><div class="img-gen-stage"><div class="img-gen-orb"></div><div class="img-gen-label" id="vstageLabel">Generating frames…</div><div class="img-gen-progress"><div class="img-gen-progress-bar"></div></div></div>`;
  bubble.appendChild(wrapDiv); scrollToBottom();
  const setLabel = t => { const el = wrapDiv.querySelector("#vstageLabel"); if (el) el.textContent = t; };
  try {
    const r = await fetch("/api/video/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, style: "" }) });
    const data = await r.json();
    if (!r.ok || !data.frames) { wrapDiv.innerHTML = `<div class="gallery-error"><i class="ri-error-warning-line"></i><span>${escapeHtml(data.error || "Failed.")}</span></div>`; return; }
    setLabel(`Waiting for all ${data.count} frames to finish…`);
    const blob = await buildVideoFromFrames(data.frames, data.fps || 4, data.size || 512, (stage, n, t) => {
      if (stage === "load") setLabel(`Loading image ${n}/${t}…`);
      else if (stage === "render") setLabel(`Rendering frame ${n}/${t}…`);
    });
    const url = URL.createObjectURL(blob);
    wrapDiv.innerHTML = `<video class="chat-video" controls playsinline src="${url}"></video><div class="sound-note" style="margin-top:8px;"><i class="ri-volume-mute-line"></i> Sound will come soon</div>`;
    loadSubscriptionInfo();
  } catch (e) { wrapDiv.innerHTML = `<div class="gallery-error"><i class="ri-error-warning-line"></i><span>${escapeHtml(e.message || "Failed.")}</span></div>`; }
}

function loadImage(src, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const img = new Image(); let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; reject(new Error("Image load timeout")); } }, timeoutMs);
    img.onload = () => { if (settled) return; settled = true; clearTimeout(t); if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve(img); else reject(new Error("Image has zero size")); };
    img.onerror = () => { if (settled) return; settled = true; clearTimeout(t); reject(new Error("Image decode error")); };
    img.crossOrigin = "anonymous"; img.src = src;
  });
}
function waitPaint() { return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res()))); }

async function buildVideoFromFrames(frames, fps, size, onProgress) {
  if (!frames || !frames.length) throw new Error("No frames");
  if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder is not supported in this browser");
  const imgs = [];
  for (let i = 0; i < frames.length; i++) {
    try { const img = await loadImage(frames[i], 15000); imgs.push(img); }
    catch (e) { console.warn("Frame " + i + " failed:", e.message); }
    if (onProgress) onProgress("load", i + 1, frames.length);
  }
  if (imgs.length < 2) throw new Error("Not enough valid frames to build video");
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, size, size); ctx.drawImage(imgs[0], 0, 0, size, size);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : (MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm");
  const stream = canvas.captureStream(fps);
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
  const stopped = new Promise((resolve, reject) => { rec.onstop = () => resolve(); rec.onerror = e => reject(e.error || new Error("Recorder error")); });
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  await waitPaint(); rec.start(200);
  const frameDelayMs = Math.max(120, Math.round(1000 / fps));
  for (let i = 0; i < imgs.length; i++) {
    ctx.drawImage(imgs[i], 0, 0, size, size);
    await waitPaint();
    await new Promise(r => setTimeout(r, frameDelayMs));
    if (onProgress) onProgress("render", i + 1, imgs.length);
  }
  await new Promise(r => setTimeout(r, 600));
  rec.stop(); await stopped;
  const blob = new Blob(chunks, { type: mime });
  if (!blob.size) throw new Error("Recorder produced an empty video");
  return blob;
}

async function streamReply(response, { bubble, wrap }, prevSubtitle, userText) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", fullText = "", meta = {};
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim(); if (!payload) continue;
        let evt; try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.delta) { fullText += evt.delta; renderRichText(bubble, fullText); const cur = document.createElement("span"); cur.className = "stream-cursor"; bubble.appendChild(cur); if (isNearBottom()) scrollToBottom(); }
        else if (evt.meta) meta = { ...meta, ...evt.meta };
        else if (evt.error) { fullText += `\n\n_(error: ${evt.error})_`; renderRichText(bubble, fullText); }
      }
    }
  }
  bubble.querySelectorAll(".stream-cursor").forEach(c => c.remove());
  renderRichText(bubble, fullText || "(empty reply)");
  addActions(wrap, fullText, "ai");
  const sources = normalizeSources(meta); if (sources.length) renderSources(wrap, sources);
  const files = parseProjectFilesFromText(fullText); if (files.length) renderProjectPanel(wrap, files);
  currentConversationId = meta.conversation_id || currentConversationId;
  if (meta.model) { const ens = meta.ensemble_size ? ` · ${meta.ensemble_size} models` : ""; chatSubtitle.textContent = meta.model + (meta.ms ? ` · ${meta.ms}ms` : "") + ens + (meta.provider ? ` · ${meta.provider}` : ""); }
  else chatSubtitle.textContent = prevSubtitle;
  if (chatTitle.textContent === "New chat") chatTitle.textContent = userText.slice(0, 48) + (userText.length > 48 ? "…" : "");
  if (meta.lite_mode) { const h = Math.floor((meta.daily_reset_seconds || 0) / 3600); addMessage(`⚠️ Daily limit reached. You are now on **lite mode** — using a lighter model until midnight UTC (${h}h). Upgrade to Pro or Ultimate for full speed.`, "system", { skipActions: true }); }
  if (meta.vision && typeof meta.vision_remaining === "number" && meta.vision_remaining >= 0) { if (meta.vision_remaining <= 2) addMessage(`👁️ Vision: ${meta.vision_remaining} image${meta.vision_remaining === 1 ? "" : "s"} left today.`, "system", { skipActions: true }); }
  if (typeof meta.daily_remaining === "number") loadSubscriptionInfo();
}

async function sendMessage(userText) {
  if (isReplying) return;
  if (!__user) { addMessage("Please sign in first.", "ai"); openModal("loginModal"); return; }
  isReplying = true; sendBtn.disabled = true;
  const imgMatch = userText.match(/^\/image\s+(.+)/i);
  if (imgMatch) { isReplying = false; sendBtn.disabled = false; await handleInlineImage(imgMatch[1].trim()); return; }
  const vidMatch = userText.match(/^\/video\s+(.+)/i);
  if (vidMatch) { isReplying = false; sendBtn.disabled = false; await handleInlineVideo(vidMatch[1].trim()); return; }
  const attachment = pendingAttachment; clearAttachment();
  let msgForModel = userText;
  if (attachment && attachment.type !== "image") msgForModel = `The user attached a file named "${attachment.name}". Contents:\n\n\`\`\`\n${attachment.content}\n\`\`\`\n\nUser's request:\n${userText}`;
  addMessage(userText || (attachment && attachment.type === "image" ? "(image)" : ""), "user");
  if (attachment) { const label = attachment.type === "image" ? `🖼️ Attached image: ${attachment.name}` : `📎 Attached: ${attachment.name}`; addMessage(label, "system", { skipActions: true }); }
  const usedSearch = webSearchEnabled, prevSubtitle = chatSubtitle.textContent;
  if (usedSearch) { addWebSearchStatus(); chatSubtitle.textContent = "Searching the web…"; }
  else { addThinking(); chatSubtitle.textContent = attachment && attachment.type === "image" ? "Looking at your image…" : "Thinking…"; }
  try {
    const body = { message: msgForModel, conversation_id: currentConversationId, model: window.__model, web_search: usedSearch };
    if (attachment) { if (attachment.type === "image") body.image_data_url = attachment.content; else { body.file_name = attachment.name; body.file_content = attachment.content; } }
    const response = await fetch("/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok || !response.body) throw new Error("Stream unavailable");
    removeThinking(); removeWebSearchStatus();
    const { bubble, wrap } = buildMessage("", "ai"); bubble.innerHTML = '<span class="stream-cursor"></span>';
    await streamReply(response, { bubble, wrap }, prevSubtitle, userText);
    loadHistory(chatSearchInput.value.trim());
  } catch (err) {
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msgForModel, conversation_id: currentConversationId, model: window.__model, web_search: usedSearch, image_data_url: (attachment && attachment.type === "image") ? attachment.content : undefined, file_name: (attachment && attachment.type === "text") ? attachment.name : undefined, file_content: (attachment && attachment.type === "text") ? attachment.content : undefined }) });
      const data = await response.json();
      removeThinking(); removeWebSearchStatus();
      if (!response.ok) { addMessage(data.error || "Error", "ai"); chatSubtitle.textContent = prevSubtitle; isReplying = false; sendBtn.disabled = false; return; }
      currentConversationId = data.conversation_id || currentConversationId;
      const result = addMessage(data.reply || "(empty reply)", "ai");
      const sources = normalizeSources(data); if (sources.length) renderSources(result.wrap, sources);
      const files = parseProjectFilesFromText(data.reply || ""); if (files.length) renderProjectPanel(result.wrap, files);
      chatSubtitle.textContent = data.model ? data.model + (data.ms ? ` · ${data.ms}ms` : "") : prevSubtitle;
      loadSubscriptionInfo(); loadHistory(chatSearchInput.value.trim());
    } catch { removeThinking(); removeWebSearchStatus(); chatSubtitle.textContent = prevSubtitle; addMessage("Couldn't reach the server.", "ai"); }
  } finally { isReplying = false; sendBtn.disabled = false; if (!("ontouchstart" in window)) input.focus(); }
}
if (form) form.addEventListener("submit", e => { e.preventDefault(); if (isReplying) return; const text = input.value.trim(); if (!text && !pendingAttachment) return; input.value = ""; sendMessage(text || "(see attached file)"); });

async function requestMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { ok: false, reason: "Microphone API not available." };
  try { audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); micPermissionGranted = true; setTimeout(() => { if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; } }, 300); return { ok: true }; }
  catch (e) { micPermissionGranted = false; let msg = "Microphone access denied."; if (e && e.name === "NotAllowedError") msg = "You blocked microphone access. Allow it in your browser's site settings."; if (e && e.name === "NotFoundError") msg = "No microphone found."; return { ok: false, reason: msg }; }
}
const requestMicBtnEl = document.getElementById("requestMicBtn");
if (requestMicBtnEl) requestMicBtnEl.addEventListener("click", async () => { const status = document.getElementById("micStatus"); status.textContent = "Requesting…"; const r = await requestMicPermission(); status.textContent = r.ok ? "Microphone granted ✅" : r.reason; });

const composer = document.getElementById("composerForm");
let recognizing = false, recognition = null;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function setRecordingUI(on) { micBtn.classList.toggle("recording", on); composer.classList.toggle("recording", on); }
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false; recognition.interimResults = true; recognition.lang = "en-US";
  recognition.onresult = e => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; input.value = t; };
  recognition.onend = () => { recognizing = false; setRecordingUI(false); const t = input.value.trim(); if (t) { input.value = ""; sendMessage(t); } };
  recognition.onerror = () => { recognizing = false; setRecordingUI(false); };
}
if (micBtn) micBtn.addEventListener("click", async () => {
  if (!SpeechRecognition) { addMessage("Voice input isn't supported here.", "ai"); return; }
  if (recognizing) { recognition.stop(); return; }
  if (!micPermissionGranted) { const r = await requestMicPermission(); if (!r.ok) { addMessage(r.reason, "ai"); return; } }
  recognizing = true; setRecordingUI(true);
  try { recognition.start(); } catch { recognizing = false; setRecordingUI(false); addMessage("Could not start mic.", "ai"); }
});

const synth = window.speechSynthesis;
const speechSupportEl = document.getElementById("speechRecognitionSupport");
if (speechSupportEl) speechSupportEl.textContent = SpeechRecognition ? "Supported ✅" : "Not supported.";
function loadVoicePrefs() { return JSON.parse(localStorage.getItem("miroxai_voice") || "{}"); }
function saveVoicePrefs(patch) { const m = { ...loadVoicePrefs(), ...patch }; localStorage.setItem("miroxai_voice", JSON.stringify(m)); }
const voiceSelect = document.getElementById("voiceSelect"), voiceRateInput = document.getElementById("voiceRateInput"), voiceRateLabel = document.getElementById("voiceRateLabel");
function populateVoiceList() { if (!synth || !voiceSelect) return; const voices = synth.getVoices(); if (!voices.length) return; const prefs = loadVoicePrefs(); voiceSelect.innerHTML = ""; voices.forEach((v, i) => { const opt = document.createElement("option"); opt.value = v.name; opt.textContent = `${v.name} (${v.lang})`; if (v.name === prefs.voiceName || (!prefs.voiceName && i === 0)) opt.selected = true; voiceSelect.appendChild(opt); }); }
if (synth) { populateVoiceList(); synth.addEventListener("voiceschanged", populateVoiceList); }
const savedRate = loadVoicePrefs().rate || 1;
if (voiceRateInput) voiceRateInput.value = savedRate;
if (voiceRateLabel) voiceRateLabel.textContent = `${parseFloat(savedRate).toFixed(1)}×`;
if (voiceSelect) voiceSelect.addEventListener("change", () => saveVoicePrefs({ voiceName: voiceSelect.value }));
if (voiceRateInput) voiceRateInput.addEventListener("input", () => { voiceRateLabel.textContent = `${parseFloat(voiceRateInput.value).toFixed(1)}×`; saveVoicePrefs({ rate: parseFloat(voiceRateInput.value) }); });
function speak(text, onEnd) { if (!synth) { onEnd && onEnd(); return; } synth.cancel(); const u = new SpeechSynthesisUtterance(text); const prefs = loadVoicePrefs(); const v = synth.getVoices().find(x => x.name === prefs.voiceName); if (v) u.voice = v; u.rate = prefs.rate || 1; u.onend = () => onEnd && onEnd(); u.onerror = () => onEnd && onEnd(); synth.speak(u); }
const testVoiceBtnEl = document.getElementById("testVoiceBtn");
if (testVoiceBtnEl) testVoiceBtnEl.addEventListener("click", () => speak("Hi, this is MiroxAI, made by the OpenSurr team."));

const callOverlay = document.getElementById("callOverlay"), callStatus = document.getElementById("callStatus");
const callOrb = document.getElementById("callOrb"), callTranscript = document.getElementById("callTranscript");
const callTextForm = document.getElementById("callTextForm"), callTextInput = document.getElementById("callTextInput");
const callMuteBtn = document.getElementById("callMuteBtn"), callEndBtn = document.getElementById("callEndBtn");
let callActive = false, callMuted = false, callRecognition = null, callErrorCount = 0;
function setCallState(state, text) { callOrb.classList.remove("listening", "speaking"); if (state) callOrb.classList.add(state); callStatus.textContent = text; }
async function sendCallMessage(said) {
  setCallState(null, "Thinking…");
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: said, conversation_id: currentConversationId, model: window.__model }) });
    const data = await response.json(); if (!callActive) return;
    if (!response.ok) { callTranscript.textContent = data.error || "Error"; setCallState(null, "Tap to reply"); return; }
    currentConversationId = data.conversation_id || currentConversationId;
    const reply = data.reply || data.text || "(no reply)";
    callTranscript.textContent = reply; setCallState("speaking", "Speaking…");
    speak(reply, () => { if (!callActive) return; if (SpeechRecognition && !callMuted) startCallListening(); else setCallState(null, "Tap to reply"); });
    loadHistory(chatSearchInput.value.trim()); loadSubscriptionInfo();
  } catch { callTranscript.textContent = "Couldn't reach the server."; if (callActive) { if (SpeechRecognition && !callMuted) setTimeout(startCallListening, 1500); else setCallState(null, "Tap to reply"); } }
}
function startCallListening() {
  if (!callActive || callMuted) return;
  callErrorCount = 0; setCallState("listening", "Listening…"); callTranscript.textContent = "";
  callRecognition = new SpeechRecognition();
  callRecognition.continuous = false; callRecognition.interimResults = true; callRecognition.lang = "en-US";
  callRecognition.onresult = e => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; callTranscript.textContent = t; };
  callRecognition.onerror = () => { if (!callActive) return; callErrorCount++; if (callErrorCount >= 3) { setCallState(null, "Mic unavailable — type below"); callTextForm.style.display = "flex"; callMuteBtn.style.display = "none"; return; } setTimeout(startCallListening, 600); };
  callRecognition.onend = () => { if (!callActive) return; const s = callTranscript.textContent.trim(); if (!s) { startCallListening(); return; } sendCallMessage(s); };
  try { callRecognition.start(); } catch {}
}
if (callTextForm) callTextForm.addEventListener("submit", e => { e.preventDefault(); const s = callTextInput.value.trim(); if (!s) return; callTextInput.value = ""; callTranscript.textContent = s; sendCallMessage(s); });
async function startCall() {
  if (!__user) { addMessage("Sign in first.", "ai"); openModal("loginModal"); return; }
  callActive = true; callMuted = false; callErrorCount = 0;
  callMuteBtn.classList.remove("muted"); callOverlay.classList.add("open");
  setCallState(null, "Requesting microphone access…"); callTextForm.style.display = "none";
  if (!SpeechRecognition) { callTextForm.style.display = "flex"; callMuteBtn.style.display = "none"; setCallState(null, "Voice not supported — type below"); setTimeout(() => callTextInput.focus(), 300); return; }
  if (!micPermissionGranted) { const r = await requestMicPermission(); if (!r.ok) { callTextForm.style.display = "flex"; callMuteBtn.style.display = "none"; setCallState(null, r.reason || "Mic unavailable — type below"); callTranscript.textContent = "You can type below."; setTimeout(() => callTextInput.focus(), 300); return; } }
  callMuteBtn.style.display = "flex"; setCallState(null, "Connecting…");
  setTimeout(startCallListening, 400);
}
function endCall() { callActive = false; if (callRecognition) { callRecognition.onend = null; try { callRecognition.stop(); } catch {} } if (synth) synth.cancel(); callOverlay.classList.remove("open"); }
if (callEndBtn) callEndBtn.addEventListener("click", endCall);
if (callMuteBtn) callMuteBtn.addEventListener("click", () => { callMuted = !callMuted; callMuteBtn.classList.toggle("muted", callMuted); if (callMuted) { if (callRecognition) { callRecognition.onend = null; try { callRecognition.stop(); } catch {} } setCallState(null, "Muted"); } else startCallListening(); });

window.__isAdmin = false;
async function refreshProviderPanel() {
  try {
    const [a, p, h] = await Promise.all([
      fetch("/api/settings/airoute").then(r => r.json()).catch(() => ({})),
                                        fetch("/api/settings/pollinations").then(r => r.json()).catch(() => ({})),
                                        fetch("/api/settings/huggingface").then(r => r.json()).catch(() => ({}))
    ]);
    window.__isAdmin = a.is_admin || p.is_admin || h.is_admin;
    document.getElementById("adminLoginRow").style.display = window.__isAdmin ? "none" : "flex";
    document.getElementById("adminStatus").textContent = window.__isAdmin ? "Unlocked ✅" : "";
    document.getElementById("providerKeysSection").style.display = window.__isAdmin ? "block" : "none";
    const anyConfigured = a.configured || p.configured || h.configured;
    document.getElementById("providerKeysLockedNote").style.display = window.__isAdmin ? "none" : "block";
    document.getElementById("providerKeysStatus").textContent = anyConfigured ? "A model is connected." : "No model connected yet.";
    document.querySelectorAll(".settings-tab.admin-only").forEach(t => t.style.display = window.__isAdmin ? "" : "none");
    document.getElementById("adminPill").style.display = window.__isAdmin ? "flex" : "none";
  } catch {}
}
const adminLoginBtnEl = document.getElementById("adminLoginBtn");
if (adminLoginBtnEl) adminLoginBtnEl.addEventListener("click", async () => {
  const password = document.getElementById("adminPasswordInput").value, status = document.getElementById("adminStatus");
  if (!password) { status.textContent = "Enter the admin password."; return; }
  try { const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); const data = await r.json(); if (data.ok) { document.getElementById("adminPasswordInput").value = ""; refreshProviderPanel(); loadAdminContact(); } else status.textContent = data.error || "Wrong password."; }
  catch { status.textContent = "Could not reach the server."; }
});
const PROVIDER_FIELDS = {
  airoute: { inputId: "airouteTokenInput", statusId: "airouteStatus", buttonId: "saveAirouteBtn" },
  pollinations: { inputId: "pollinationsTokenInput", statusId: "pollinationsStatus", buttonId: "savePollinationsBtn" },
  huggingface: { inputId: "hfTokenInput", statusId: "hfStatus", buttonId: "saveHuggingfaceBtn" }
};
Object.entries(PROVIDER_FIELDS).forEach(([kind, cfg]) => {
  const btn = document.getElementById(cfg.buttonId); if (!btn) return;
  btn.addEventListener("click", async e => {
    e.preventDefault();
    const inputEl = document.getElementById(cfg.inputId), statusEl = document.getElementById(cfg.statusId), token = inputEl.value.trim();
    if (kind !== "pollinations" && !token) { statusEl.textContent = "Paste a key first."; return; }
    statusEl.textContent = "Saving...";
    try { const r = await fetch(`/api/settings/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); const data = await r.json(); statusEl.textContent = data.ok ? "Saved ✅" : (data.error || "Could not save."); if (data.ok) { inputEl.value = ""; refreshProviderPanel(); } }
    catch { statusEl.textContent = "Could not reach the server."; }
  });
});
const testHfBtnEl = document.getElementById("testHfBtn");
if (testHfBtnEl) testHfBtnEl.addEventListener("click", async () => { const status = document.getElementById("hfStatus"); status.textContent = "Testing…"; try { const r = await fetch("/api/settings/huggingface/test", { method: "POST" }); const data = await r.json(); status.textContent = data.ok ? `Connected ✅ — ${data.message}` : (data.error || "Failed."); } catch { status.textContent = "Could not reach the server."; } });

async function loadPersona() { try { const r = await fetch("/api/settings/persona"); const d = await r.json(); document.getElementById("personaInput").value = d.persona || ""; } catch {} }
const savePersonaBtnEl = document.getElementById("savePersonaBtn");
if (savePersonaBtnEl) savePersonaBtnEl.addEventListener("click", async () => { const persona = document.getElementById("personaInput").value.trim(), status = document.getElementById("personaStatus"); status.textContent = "Saving..."; try { const r = await fetch("/api/settings/persona", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona }) }); const d = await r.json(); status.textContent = d.ok ? "Saved." : (d.error || "Failed."); } catch { status.textContent = "Could not reach the server."; } });

const memoryList = document.getElementById("memoryList");
async function loadMemory() { try { const r = await fetch("/api/memory"); const d = await r.json(); renderMemory(d.facts || []); } catch {} }
function renderMemory(facts) {
  if (!memoryList) return; memoryList.innerHTML = "";
  if (!facts.length) { const e = document.createElement("li"); e.className = "memory-empty"; e.textContent = "Nothing remembered yet."; memoryList.appendChild(e); return; }
  facts.slice().reverse().forEach(f => { const li = document.createElement("li"); li.innerHTML = `<span>${escapeHtml(f.text)}</span><button class="memory-delete"><i class="ri-delete-bin-line"></i></button>`; li.querySelector(".memory-delete").addEventListener("click", async () => { await fetch(`/api/memory/${f.id}`, { method: "DELETE" }); loadMemory(); }); memoryList.appendChild(li); });
}
const addMemoryBtnEl = document.getElementById("addMemoryBtn");
if (addMemoryBtnEl) addMemoryBtnEl.addEventListener("click", async () => { const memoryInput = document.getElementById("memoryInput"), fact = memoryInput.value.trim(); if (!fact) return; await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fact }) }); memoryInput.value = ""; loadMemory(); });

const connectServerBtnEl = document.getElementById("connectServerBtn");
if (connectServerBtnEl) connectServerBtnEl.addEventListener("click", async () => { const status = document.getElementById("serverStatus"); status.textContent = "Searching…"; try { const r = await fetch("/api/health", { cache: "no-store" }); if (!r.ok) throw new Error("bad"); const d = await r.json(); status.textContent = `Connected ✅ (${d.app})`; } catch { status.textContent = "No server found."; } });

async function loadAdminContact() { if (!window.__isAdmin) return; try { const r = await fetch("/api/admin/contact"); const d = await r.json(); if (d.ok) { document.getElementById("adminContactEmail").value = d.email || ""; document.getElementById("adminContactPhone").value = d.phone || ""; } } catch {} }
const saveAdminContactBtnEl = document.getElementById("saveAdminContactBtn");
if (saveAdminContactBtnEl) saveAdminContactBtnEl.addEventListener("click", async () => { const status = document.getElementById("adminContactStatus"); status.textContent = "Saving…"; try { const r = await fetch("/api/admin/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: document.getElementById("adminContactEmail").value.trim(), phone: document.getElementById("adminContactPhone").value.trim() }) }); const d = await r.json(); status.textContent = d.ok ? "Saved ✅" : (d.error || "Failed."); if (d.ok) loadPlans(); } catch { status.textContent = "Could not reach the server."; } });
const aqBanSelfEl = document.getElementById("aqBanSelf");
if (aqBanSelfEl) aqBanSelfEl.addEventListener("click", async () => {
  const status = document.getElementById("aqStatus");
  try { const q = await fetch("/api/admin/quick").then(r => r.json()); if (!q.ok) { status.textContent = "Not admin."; return; } const ip = q.current_ip; if (!ip) { status.textContent = "Could not detect IP."; return; } const reason = prompt(`Ban IP ${ip}? Reason:`, "Admin self-ban test"); if (reason === null) return; const r = await fetch("/api/admin/ban", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip, reason }) }); const d = await r.json(); status.textContent = d.ok ? `Banned ${ip}` : (d.error || "Failed."); }
  catch { status.textContent = "Could not reach the server."; }
});
const aqOpenConsoleEl = document.getElementById("aqOpenConsole"); if (aqOpenConsoleEl) aqOpenConsoleEl.addEventListener("click", () => { window.open("/admin/console", "_blank"); });
const aqBroadcastEl = document.getElementById("aqBroadcast");
if (aqBroadcastEl) aqBroadcastEl.addEventListener("click", async () => { const msg = prompt("Broadcast message:", ""); if (!msg) return; const r = await fetch("/api/admin/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg, type: "info" }) }); const d = await r.json(); document.getElementById("aqStatus").textContent = d.ok ? "Broadcast sent." : (d.error || "Failed."); });
const aqMaintEl = document.getElementById("aqMaint");
if (aqMaintEl) aqMaintEl.addEventListener("click", async () => { const r = await fetch("/api/admin/maintenance"); const d = await r.json(); const next = !d.enabled; const r2 = await fetch("/api/admin/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) }); const d2 = await r2.json(); document.getElementById("aqStatus").textContent = d2.ok ? `Maintenance ${d2.enabled ? "ON" : "OFF"}` : "Failed."; });
const grantTierBtnEl = document.getElementById("grantTierBtn");
if (grantTierBtnEl) grantTierBtnEl.addEventListener("click", async () => { const status = document.getElementById("grantStatus"); const email = document.getElementById("grantEmailInput").value.trim(), tier = document.getElementById("grantTierInput").value; if (!email) { status.textContent = "Enter a user email."; return; } status.textContent = "Granting…"; try { const r = await fetch("/api/admin/set-tier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, tier }) }); const d = await r.json(); if (d.ok) { const exp = new Date(d.expires * 1000).toLocaleDateString(); status.textContent = `Granted ${tier} to ${email} until ${exp} ✅`; document.getElementById("grantEmailInput").value = ""; } else status.textContent = d.error || "Failed."; } catch { status.textContent = "Could not reach the server."; } });

let selectedStyle = "", selectedRatio = "1:1";
document.querySelectorAll("#styleChips .chip").forEach(chip => chip.addEventListener("click", () => { document.querySelectorAll("#styleChips .chip").forEach(c => c.classList.remove("active")); chip.classList.add("active"); selectedStyle = chip.dataset.style || ""; }));
document.querySelectorAll("#ratioChips .chip").forEach(chip => chip.addEventListener("click", () => { document.querySelectorAll("#ratioChips .chip").forEach(c => c.classList.remove("active")); chip.classList.add("active"); selectedRatio = chip.dataset.ratio || "1:1"; }));
const imagePromptInput = document.getElementById("imagePromptInput"), imageGallery = document.getElementById("imageGallery");
const imageStudioStatus = document.getElementById("imageStudioStatus"), generateImageBtn = document.getElementById("generateImageBtn");
function addImageMessageToChat(dataUrl, prompt) { const m = document.createElement("div"); m.className = "message ai"; m.innerHTML = `<div class="avatar ai-avatar"><img src="logo.png" alt="" class="theme-logo"></div><div class="bubble-wrap"><div class="bubble"><div>${escapeHtml(prompt)}</div><img class="chat-image" src="${dataUrl}" alt="${escapeHtml(prompt)}"></div></div>`; chat.appendChild(m); scrollToBottom(); }
function refreshImageGate() { const hint = document.getElementById("imageUpgradeHint"); if (hint) hint.style.display = __imagesAllowed ? "none" : "block"; if (generateImageBtn) generateImageBtn.disabled = !__imagesAllowed; }
async function generateImage() {
  if (!__imagesAllowed) { imageStudioStatus.textContent = "Upgrade to Pro or Ultimate for image generation."; return; }
  const prompt = imagePromptInput.value.trim(); if (!prompt) { imageStudioStatus.textContent = "Please describe what you want first."; return; }
  generateImageBtn.disabled = true; imageStudioStatus.textContent = "";
  const card = document.createElement("div"); card.className = "gallery-card"; card.innerHTML = `<div class="gallery-skeleton"></div>`; imageGallery.prepend(card);
  try {
    const r = await fetch("/api/image/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, style: selectedStyle, ratio: selectedRatio }) });
    const data = await r.json();
    if (!r.ok || !data.image) { card.innerHTML = `<div class="gallery-error"><i class="ri-error-warning-line"></i><span>${escapeHtml(data.error || "Failed.")}</span></div>`; imageStudioStatus.textContent = data.error || "Failed."; return; }
    card.innerHTML = `<img src="${data.image}" alt="${escapeHtml(prompt)}"><div class="gallery-actions"><a class="gallery-icon-btn" href="${data.image}" download="miroxai-image.png"><i class="ri-download-2-line"></i></a><button type="button" class="gallery-icon-btn" title="Send to chat"><i class="ri-chat-3-line"></i></button></div>`;
    card.querySelector(".gallery-icon-btn:last-child").addEventListener("click", () => { addImageMessageToChat(data.image, prompt); closeModal("imageModal"); });
    loadSubscriptionInfo();
  } catch { card.innerHTML = `<div class="gallery-error"><i class="ri-error-warning-line"></i><span>Couldn't reach the server.</span></div>`; }
  finally { generateImageBtn.disabled = !__imagesAllowed; }
}
if (generateImageBtn) generateImageBtn.addEventListener("click", generateImage);
if (imagePromptInput) imagePromptInput.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generateImage(); });

/* ===== Video Studio with circular progress ===== */
let selectedVStyle = "";
document.querySelectorAll("#vstyleChips .chip").forEach(chip => chip.addEventListener("click", () => { document.querySelectorAll("#vstyleChips .chip").forEach(c => c.classList.remove("active")); chip.classList.add("active"); selectedVStyle = chip.dataset.style || ""; }));
const videoPromptInput = document.getElementById("videoPromptInput");
const videoStudioStatus = document.getElementById("videoStudioStatus");
const generateVideoBtn = document.getElementById("generateVideoBtn");
const videoResult = document.getElementById("videoResult");
const videoPlayer = document.getElementById("videoPlayer");
const videoDownloadLink = document.getElementById("videoDownloadLink");
const videoLoader = document.getElementById("videoLoader");
const videoLoaderPct = document.getElementById("videoLoaderPct");
const videoLoaderBar = document.getElementById("videoLoaderBar");
const videoLoaderStatus = document.getElementById("videoLoaderStatus");
const videoLoaderSub = document.getElementById("videoLoaderSub");
const videoRingFg = document.getElementById("videoRingFg");
const RING_CIRC = 326.7256;

function setVideoProgress(pct, status, sub) {
  pct = Math.max(0, Math.min(100, pct));
  if (videoRingFg) videoRingFg.style.strokeDashoffset = String(RING_CIRC * (1 - pct / 100));
  if (videoLoaderPct) videoLoaderPct.textContent = Math.round(pct) + "%";
  if (videoLoaderBar) videoLoaderBar.style.width = pct + "%";
  if (videoLoaderStatus && status !== undefined) videoLoaderStatus.textContent = status;
  if (videoLoaderSub && sub !== undefined) videoLoaderSub.textContent = sub;
}
function showVideoLoader() { if (videoLoader) videoLoader.style.display = "flex"; if (videoResult) videoResult.style.display = "none"; setVideoProgress(0, "Preparing…", ""); }
function hideVideoLoader() { if (videoLoader) videoLoader.style.display = "none"; }
function refreshVideoGate() { const hint = document.getElementById("videoUpgradeHint"); if (hint) hint.style.display = __videoAllowed ? "none" : "block"; if (generateVideoBtn) generateVideoBtn.disabled = !__videoAllowed; }

async function generateVideo() {
  if (!__videoAllowed) { videoStudioStatus.textContent = "Upgrade to Pro or Ultimate to generate videos."; return; }
  const prompt = videoPromptInput.value.trim();
  if (!prompt) { videoStudioStatus.textContent = "Please describe the video first."; return; }
  generateVideoBtn.disabled = true;
  videoStudioStatus.textContent = "";
  showVideoLoader();
  setVideoProgress(2, "Requesting frames from the server…", "0 / 20 frames ready");

  try {
    const r = await fetch("/api/video/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, style: selectedVStyle }) });
    setVideoProgress(35, "Server is generating frames…", "");
    const data = await r.json();
    if (!r.ok || !data.frames) {
      hideVideoLoader();
      videoStudioStatus.textContent = data.error || "Failed.";
      return;
    }
    const total = data.frames.length;
    setVideoProgress(45, `Frames ready — loading ${total} images…`, `0 / ${total} loaded`);

    const blob = await buildVideoFromFrames(
      data.frames,
      data.fps || 4,
      data.size || 512,
      (stage, n, t) => {
        if (stage === "load") {
          const p = 45 + (n / t) * 25;
          setVideoProgress(p, `Loading image ${n}/${t}…`, "");
        } else if (stage === "render") {
          const p = 70 + (n / t) * 30;
          setVideoProgress(p, `Rendering frame ${n}/${t}…`, "Encoding WebM");
        }
      }
    );

    setVideoProgress(100, "Finalizing video…", "Encoding complete");
    await new Promise(res => setTimeout(res, 350));

    const url = URL.createObjectURL(blob);
    videoPlayer.src = url;
    videoDownloadLink.href = url;
    hideVideoLoader();
    videoResult.style.display = "flex";
    videoStudioStatus.textContent = `Done ✅ — 5s silent video (sound will come soon).`;
    loadSubscriptionInfo();
  } catch (e) {
    hideVideoLoader();
    videoStudioStatus.textContent = e.message || "Video generation failed.";
  } finally {
    generateVideoBtn.disabled = !__videoAllowed;
  }
}
if (generateVideoBtn) generateVideoBtn.addEventListener("click", generateVideo);
if (videoPromptInput) videoPromptInput.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generateVideo(); });

async function probeLatency() {
  const t0 = performance.now();
  try { const r = await fetch("/api/ping", { cache: "no-store" }); await r.json(); const ms = Math.round(performance.now() - t0); const sub = document.getElementById("chatSubtitle"); if (sub && !sub.textContent) sub.textContent = `ping ${ms}ms`; } catch {}
}
probeLatency(); setInterval(() => { if (!document.hidden) probeLatency(); }, 30000);
