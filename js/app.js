const SNSScoringApi = window.SNSScoring || {};
const SNSAlertsApi = window.SNSAlerts || {};
const SNSCompetitorsApi = window.SNSCompetitors || {};
const SNSExportersApi = window.SNSExporters || {};

const snsCalculate = SNSScoringApi.calculate;
const snsScoreBand = SNSScoringApi.scoreBand;
const snsDimensions = SNSScoringApi.dimensions;
const snsBuildTasks = SNSAlertsApi.buildTasks;
const snsBuildMatrix = SNSCompetitorsApi.buildMatrix;
const snsCompetitorMarketSummary = SNSCompetitorsApi.competitorMarketSummary;
const snsNamesForAccount = SNSCompetitorsApi.namesForAccount;
const snsNormalizeCompetitor = SNSCompetitorsApi.normalizeCompetitor;
const snsExportAccounts = SNSExportersApi.exportAccounts;
const snsExportCompetitorOverlap = SNSExportersApi.exportCompetitorOverlap;
const snsExportCompetitors = SNSExportersApi.exportCompetitors;

const cfg = window.STACKNSTOCK_CONFIG || {};
const tableName = cfg.TABLE_NAME || "crm_accounts";
const competitorTable = cfg.COMPETITOR_TABLE || "crm_competitors";
const channelsTable = cfg.CHANNEL_TABLE || "crm_channels";
const enableRealtime = cfg.ENABLE_REALTIME !== false;

const forceLocalMode = cfg.FORCE_LOCAL_MODE !== false;
const hasSupabase = !forceLocalMode && Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
const db = hasSupabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const stages = [
  "Prospecting",
  "Lead Generation",
  "Fit Score Eligible",
  "Proposal",
  "commercialization",
  "LOI/ Pilot",
  "WON",
  "Lost"
];
const closedStages = new Set(["WON", "Lost"]);
const stageProbability = {
  Prospecting: 15,
  "Lead Generation": 25,
  "Fit Score Eligible": 40,
  Proposal: 55,
  commercialization: 70,
  "LOI/ Pilot": 85,
  WON: 100,
  Lost: 0
};
const legacyStageMap = {
  prospecting: "Prospecting",
  qualified: "Lead Generation",
  "lead generation": "Lead Generation",
  "fit score": "Fit Score Eligible",
  "fit score eligible": "Fit Score Eligible",
  proposal: "Proposal",
  commercialization: "commercialization",
  commercialisation: "commercialization",
  pilot: "LOI/ Pilot",
  "loi/pilot": "LOI/ Pilot",
  "loi/ pilot": "LOI/ Pilot",
  "loi pilot": "LOI/ Pilot",
  won: "WON",
  lost: "Lost"
};

const state = {
  accounts: [],
  competitors: [],
  channels: [],
  currentView: "dashboard",
  quickStage: "all",
  competitorFocusId: null,
  loading: false
};

let realtimeChannel = null;
let realtimeWired = false;
let realtimeTimer = null;
const unsupportedAccountColumns = new Set();

const STORAGE_KEYS = {
  accounts: "sns_crm_v1_accounts",
  competitors: "sns_crm_v1_competitors",
  channels: "sns_crm_v1_channels",
  seedVersion: "sns_crm_v1_seed_version"
};
const SEED_VERSION = "2026-06-01-operational-fix-2";

function clone(value) {
  return JSON.parse(JSON.stringify(value || []));
}

function loadLocalRows(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (err) {
    console.warn("Local storage read failed", err);
  }
  return clone(fallback);
}

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(state.accounts));
    localStorage.setItem(STORAGE_KEYS.competitors, JSON.stringify(state.competitors));
    localStorage.setItem(STORAGE_KEYS.channels, JSON.stringify(state.channels));
  } catch (err) {
    console.warn("Local storage save failed", err);
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function newUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const randomByte = () => (window.crypto?.getRandomValues ? window.crypto.getRandomValues(new Uint8Array(1))[0] : Math.floor(Math.random() * 256));
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (randomByte() & (15 >> (Number(c) / 4)))).toString(16)
  );
}

const $ = (id) => document.getElementById(id);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase() || "SN";
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function shortMoney(value) {
  const n = Number(value || 0);
  if (n >= 10000000) return `Rs ${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `Rs ${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `Rs ${(n / 1000).toFixed(0)}k`;
  return money(n);
}

function toast(message, isError = false) {
  const t = $("toast");
  if (!t) return;
  t.textContent = message;
  t.style.background = isError ? "#e8614a" : "#fde215";
  t.style.color = isError ? "#fff" : "#000";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function setStatus(kind, title, text) {
  const dot = $("statusDot");
  if (dot) dot.className = `status-dot ${kind || ""}`;
  if ($("statusTitle")) $("statusTitle").textContent = title;
  if ($("statusText")) $("statusText").textContent = text;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return value.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeStage(rawStage) {
  const stage = String(rawStage || "").trim();
  if (stages.includes(stage)) return stage;
  const key = stage.replace(/\s+/g, " ").toLowerCase();
  return legacyStageMap[key] || "Prospecting";
}

function stageClass(stage) {
  const slug = String(stage || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `stage-${slug || "unknown"}`;
}

function ensureStageDropdown(value = "Prospecting") {
  const stageInput = $("stage");
  if (!stageInput) return;
  const normalized = normalizeStage(value);
  stageInput.innerHTML = stages.map((s) => `<option value="${s}">${s}</option>`).join("");
  stageInput.value = stages.includes(normalized) ? normalized : "Prospecting";
}

function missingColumnFromError(error) {
  const message = String(error?.message || "");
  const match = message.match(/'([^']+)' column of '([^']+)' in the schema cache/i);
  if (!match || match[2] !== tableName) return "";
  return match[1];
}

function accountPayloadForDb(payload) {
  const clean = { ...payload };
  unsupportedAccountColumns.forEach((column) => {
    delete clean[column];
  });
  return clean;
}

async function writeAccountToDb(payload, id = "") {
  let cleanPayload = accountPayloadForDb(id ? payload : { id: newUuid(), ...payload });

  for (let attempts = 0; attempts < 8; attempts += 1) {
    const query = id
      ? db.from(tableName).update(cleanPayload).eq("id", id)
      : db.from(tableName).insert(cleanPayload);
    const { data, error } = await query.select().single();

    if (!error) return data;

    const missingColumn = missingColumnFromError(error);
    if (!missingColumn || !(missingColumn in cleanPayload)) throw error;

    unsupportedAccountColumns.add(missingColumn);
    delete cleanPayload[missingColumn];
    console.warn(`Supabase schema is missing crm_accounts.${missingColumn}; retrying save without it.`);
  }

  throw new Error("Save failed after retrying unsupported database fields.");
}

function normalizeChannels(raw) {
  const arr = parseJsonArray(raw);
  if (!arr.length) return [];
  return arr
    .map((item) => {
      if (typeof item === "string") return { name: item, pct_share: 0 };
      return { name: String(item.name || ""), pct_share: Number(item.pct_share || item.pctShare || 0) };
    })
    .filter((x) => x.name);
}

function normalizeAccount(row = {}) {
  const channels = normalizeChannels(row.channels);
  const competitorsServing = parseJsonArray(row.competitors_serving).map((x) => String(x));
  const stage = normalizeStage(row.stage);
  return {
    ...row,
    id: row.id || "",
    name: row.name || "",
    company_type: row.company_type || "",
    contact_name: row.contact_name || "",
    contact_email: row.contact_email || "",
    contact_phone: row.contact_phone || "",
    owner: row.owner || "",
    city: row.city || "Bangalore",
    stage,
    probability: Number(row.probability ?? stageProbability[stage] ?? 0),
    score: Number(row.score || row.qc_score || 0),
    qc_score: Number(row.qc_score || row.score || 0),
    deal_value: Number(row.deal_value || 0),
    weighted_mrr: Number(row.weighted_mrr || 0),
    demand_low: Number(row.demand_low || 0),
    demand_high: Number(row.demand_high || 0),
    priority_tier: row.priority_tier || "P2",
    action: row.action || "Shortlist",
    channels,
    competitors_serving: competitorsServing,
    channel_share_note: row.channel_share_note || "",
    competitor_wallet_share: row.competitor_wallet_share || "",
    score_qc_urgency: Number(row.score_qc_urgency || 3),
    score_sku_fit: Number(row.score_sku_fit || 3),
    score_order_density: Number(row.score_order_density || 3),
    score_pilot_willing: Number(row.score_pilot_willing || 3),
    score_accessibility: Number(row.score_accessibility || 3),
    score_logo_value: Number(row.score_logo_value || 3),
    bin_slots: Number(row.bin_slots || 0),
    price_per_bin: Number(row.price_per_bin || 1500),
    next_action_at: row.next_action_at || null,
    next_action: row.next_action || "",
    notes: row.notes || "",
    fu1_date: row.fu1_date || null,
    fu1_contact: row.fu1_contact || "",
    fu1_mode: row.fu1_mode || "Call",
    fu1_status: row.fu1_status || "Pending",
    fu1_note: row.fu1_note || "",
    fu2_date: row.fu2_date || null,
    fu2_contact: row.fu2_contact || "",
    fu2_mode: row.fu2_mode || "Email",
    fu2_status: row.fu2_status || "Pending",
    fu2_note: row.fu2_note || "",
    next_followup_date: row.next_followup_date || null,
    commercial_ask: row.commercial_ask || "",
    risks: row.risks || "",
    last_contact_at: row.last_contact_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function demoState() {
  const seed = window.SNS_SEED || { accounts: [], competitors: [], channels: [] };
  const storedVersion = localStorage.getItem(STORAGE_KEYS.seedVersion);
  const shouldReseed = storedVersion !== SEED_VERSION;

  const rawAccounts = shouldReseed ? clone(seed.accounts) : loadLocalRows(STORAGE_KEYS.accounts, seed.accounts);
  const rawCompetitors = shouldReseed ? clone(seed.competitors) : loadLocalRows(STORAGE_KEYS.competitors, seed.competitors);
  const rawChannels = shouldReseed ? clone(seed.channels) : loadLocalRows(STORAGE_KEYS.channels, seed.channels);

  const accounts = rawAccounts.map(normalizeAccount);
  const competitors = rawCompetitors.map(snsNormalizeCompetitor);
  const channels = rawChannels.map((c) => ({ ...c, name: c.name || "" }));

  if (shouldReseed || !localStorage.getItem(STORAGE_KEYS.accounts)) {
    try {
      localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(accounts));
      localStorage.setItem(STORAGE_KEYS.competitors, JSON.stringify(competitors));
      localStorage.setItem(STORAGE_KEYS.channels, JSON.stringify(channels));
      localStorage.setItem(STORAGE_KEYS.seedVersion, SEED_VERSION);
    } catch (err) {
      console.warn("Seed storage failed", err);
    }
  }

  return { accounts, competitors, channels };
}

async function loadData(opts = {}) {
  if (state.loading) return;
  state.loading = true;
  const silent = Boolean(opts.silent);
  const source = opts.source || "manual";

  try {
    if (!hasSupabase) {
      const demo = demoState();
      state.accounts = demo.accounts;
      state.competitors = demo.competitors;
      state.channels = demo.channels;
      setStatus("connected", "Operational", "Local V1 data active");
      renderAll();
      return;
    }

    if (!silent) setStatus("", "Connecting", "Reading Supabase");

    const [accountsRes, competitorsRes, channelsRes] = await Promise.all([
      db.from(tableName).select("*").order("updated_at", { ascending: false }),
      db.from(competitorTable).select("*").order("name", { ascending: true }),
      db.from(channelsTable).select("*").order("name", { ascending: true })
    ]);

    if (accountsRes.error) throw accountsRes.error;
    if (competitorsRes.error) throw competitorsRes.error;
    if (channelsRes.error) throw channelsRes.error;

    state.accounts = (accountsRes.data || []).map(normalizeAccount);
    state.competitors = (competitorsRes.data || []).map(snsNormalizeCompetitor);
    state.channels = (channelsRes.data || []).map((c) => ({ ...c, name: c.name || "" }));

    setStatus("connected", "Connected", source === "realtime" ? "Live sync updated" : "Supabase live");
    renderAll();
  } catch (err) {
    setStatus("connected", "Operational", "Local fallback active");
    toast("Live sync unavailable. Running local V1 data.", true);
    const demo = demoState();
    state.accounts = demo.accounts;
    state.competitors = demo.competitors;
    state.channels = demo.channels;
    renderAll();
  } finally {
    state.loading = false;
  }
}

function debounceRealtimeReload() {
  if (realtimeTimer) clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(() => {
    loadData({ silent: true, source: "realtime" });
  }, 250);
}

function setupRealtime() {
  if (!hasSupabase || !enableRealtime || realtimeWired) return;
  realtimeWired = true;
  realtimeChannel = db
    .channel("stacknstock-live-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: tableName }, debounceRealtimeReload)
    .on("postgres_changes", { event: "*", schema: "public", table: competitorTable }, debounceRealtimeReload)
    .on("postgres_changes", { event: "*", schema: "public", table: channelsTable }, debounceRealtimeReload)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setStatus("connected", "Connected", "Live sync enabled");
    });
}

function readFilters() {
  return {
    q: ($("searchInput")?.value || "").trim().toLowerCase(),
    owner: $("ownerFilter")?.value || "all",
    stage: $("stageFilter")?.value || "all",
    tier: $("tierFilter")?.value || "all",
    action: $("actionFilter")?.value || "all",
    channel: $("channelFilter")?.value || "all",
    overlap: $("overlapFilter")?.value || "all",
    sort: $("sortSelect")?.value || "qc_score"
  };
}

function filteredAccounts() {
  const f = readFilters();
  let rows = [...state.accounts];

  if (state.quickStage !== "all") rows = rows.filter((a) => a.stage === state.quickStage);
  if (f.owner !== "all") rows = rows.filter((a) => String(a.owner || "") === f.owner);
  if (f.stage !== "all") rows = rows.filter((a) => a.stage === f.stage);
  if (f.tier !== "all") rows = rows.filter((a) => a.priority_tier === f.tier);
  if (f.action !== "all") rows = rows.filter((a) => a.action === f.action);
  if (f.channel !== "all") rows = rows.filter((a) => (a.channels || []).some((c) => c.name === f.channel));
  if (f.overlap === "risk") rows = rows.filter((a) => (a.competitors_serving || []).length > 0);
  if (f.overlap === "clear") rows = rows.filter((a) => (a.competitors_serving || []).length === 0);
  if (state.competitorFocusId) {
    rows = rows.filter((a) => (a.competitors_serving || []).includes(state.competitorFocusId));
  }

  if (f.q) {
    rows = rows.filter((a) =>
      [
        a.name,
        a.company_type,
        a.contact_name,
        a.contact_email,
        a.contact_phone,
        a.owner,
        a.city,
        a.stage,
        a.next_action,
        a.notes
      ]
        .join(" ")
        .toLowerCase()
        .includes(f.q)
    );
  }

  rows.sort((a, b) => {
    if (f.sort === "name") return String(a.name).localeCompare(String(b.name));
    if (f.sort === "deal_value") return Number(b.deal_value || 0) - Number(a.deal_value || 0);
    if (f.sort === "weighted_mrr") return Number(b.weighted_mrr || 0) - Number(a.weighted_mrr || 0);
    if (f.sort === "next_action_at") return String(a.next_action_at || "9999-99-99").localeCompare(String(b.next_action_at || "9999-99-99"));
    return Number(b.qc_score || b.score || 0) - Number(a.qc_score || a.score || 0);
  });

  return rows;
}

function renderFilters() {
  const ownerSelect = $("ownerFilter");
  const stageSelect = $("stageFilter");
  const stageQuickSelect = $("stageQuickFilter");
  const stageInput = $("stage");
  const channelSelect = $("channelFilter");
  const pipelineOwnerSelect = $("pipelineOwnerFilter");

  const currentOwner = ownerSelect?.value || "all";
  const currentStage = stageSelect?.value || "all";
  const currentQuickStage = stageQuickSelect?.value || "all";
  const currentInputStage = stageInput?.value || "Prospecting";
  const currentChannel = channelSelect?.value || "all";
  const currentPipelineOwner = pipelineOwnerSelect?.value || "all";

  const owners = [...new Set(state.accounts.map((a) => a.owner).filter(Boolean))].sort();
  if (ownerSelect) {
    ownerSelect.innerHTML = `<option value="all">All owners</option>${owners.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}`;
    ownerSelect.value = owners.includes(currentOwner) ? currentOwner : "all";
  }
  if (pipelineOwnerSelect) {
    pipelineOwnerSelect.innerHTML = `<option value="all">All owners</option>${owners.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}`;
    pipelineOwnerSelect.value = owners.includes(currentPipelineOwner) ? currentPipelineOwner : "all";
  }

  if (stageSelect) {
    stageSelect.innerHTML = `<option value="all">All stages</option>${stages.map((s) => `<option value="${s}">${s}</option>`).join("")}`;
    stageSelect.value = stages.includes(currentStage) ? currentStage : "all";
  }
  if (stageQuickSelect) {
    stageQuickSelect.innerHTML = `<option value="all">All stages</option>${stages.map((s) => `<option value="${s}">${s}</option>`).join("")}`;
    stageQuickSelect.value = stages.includes(currentQuickStage) ? currentQuickStage : "all";
  }
  if (stageInput) ensureStageDropdown(currentInputStage);

  const channelNames = [
    ...new Set([
      ...state.channels.map((c) => c.name),
      ...state.accounts.flatMap((a) => (a.channels || []).map((c) => c.name))
    ].filter(Boolean))
  ].sort();

  if (channelSelect) {
    channelSelect.innerHTML = `<option value="all">All channels</option>${channelNames.map((ch) => `<option value="${escapeHtml(ch)}">${escapeHtml(ch)}</option>`).join("")}`;
    channelSelect.value = channelNames.includes(currentChannel) ? currentChannel : "all";
  }
}

function applyKpiFilter(type) {
  if (type === "approach_now") $("actionFilter").value = "Approach now";
  if (type === "competitor_risk") $("overlapFilter").value = "risk";
  if (type === "clear_runway") $("overlapFilter").value = "clear";
  state.currentView = "accounts";
  renderAll();
  setView("accounts");
}

function renderKpis() {
  const accounts = state.accounts;
  const total = accounts.length;
  const open = accounts.filter((a) => !closedStages.has(a.stage));
  const weightedForecast = open.reduce((sum, a) => sum + Number(a.deal_value || 0) * Number(a.probability || 0) / 100, 0);
  const totalWeightedMrr = accounts.reduce((sum, a) => sum + Number(a.weighted_mrr || 0), 0);
  const peakDailyDemand = accounts.reduce((sum, a) => sum + Number(a.demand_high || 0), 0);
  const avgScore = total ? Math.round(accounts.reduce((sum, a) => sum + Number(a.qc_score || a.score || 0), 0) / total) : 0;
  const competitorRisk = accounts.filter((a) => (a.competitors_serving || []).length > 0).length;
  const clearRunway = total - competitorRisk;
  const totalBins = accounts.reduce((sum, a) => sum + Number(a.bin_slots || 0), 0);
  const wonCount = accounts.filter((a) => a.stage === "WON").length;
  const approachNow = accounts.filter((a) => a.action === "Approach now").length;
  const taskCount = snsBuildTasks(accounts).length;

  $("todayFocus").textContent = taskCount;

  $("kpiGrid").innerHTML = [
    ["Total Accounts", total, "records in CRM", ""],
    ["Weighted Forecast", shortMoney(weightedForecast), "deal value x probability", ""],
    ["Total Weighted MRR", shortMoney(totalWeightedMrr), "bin slot economics", ""],
    ["Peak Daily Demand", shortMoney(peakDailyDemand), "sum of demand high", ""],
    ["Avg QC Score", `${avgScore}/100`, "weighted score model", ""],
    ["Approach Now", approachNow, "priority outreach", "approach_now"],
    ["Competitor Risk", competitorRisk, "accounts with overlap", "competitor_risk"],
    ["Clear Runway", clearRunway, "accounts without overlap", "clear_runway"],
    ["Total Bin Slots", totalBins, "requested slots", ""],
    ["Confirmed Pilots", wonCount, "stage won", ""]
  ]
    .map(([label, value, sub, filter]) => `<article class="kpi${filter ? " clickable" : ""}" ${filter ? `data-filter="${filter}"` : ""}><p class="eyebrow">${label}</p><strong>${value}</strong><span>${sub}</span></article>`)
    .join("");
}

function renderStageBars() {
  const max = Math.max(1, ...stages.map((s) => state.accounts.filter((a) => a.stage === s).length));
  $("stageBars").innerHTML = stages
    .map((stage) => {
      const count = state.accounts.filter((a) => a.stage === stage).length;
      return `<div class="stage-row"><span>${stage}</span><div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div><span>${count}</span></div>`;
    })
    .join("");
}

function renderForecast() {
  const months = ["M1", "M2", "M3", "M4", "M5", "M6"];
  const open = state.accounts.filter((a) => !closedStages.has(a.stage));
  const weighted = open.reduce((sum, a) => sum + Number(a.deal_value || 0) * Number(a.probability || 0) / 100, 0);
  const values = months.map((_, i) => Math.round(weighted * (0.42 + i * 0.14)));
  const max = Math.max(...values, 1);
  $("forecastChart").innerHTML = values
    .map((value, i) => `<div class="forecast-col"><div class="forecast-bar" style="height:${Math.max(14, (value / max) * 180)}px" title="${shortMoney(value)}"></div><span>${months[i]}</span></div>`)
    .join("");
}

function tierClass(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "P0") return "tier-p0";
  if (t === "P1") return "tier-p1";
  if (t === "P2") return "tier-p2";
  return "tier-p3";
}

function formatDate(value) {
  if (!value) return "Not set";
  try {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch (err) {
    return String(value);
  }
}

function renderTable() {
  const rows = filteredAccounts();
  $("accountRows").innerHTML =
    rows
      .map((a) => {
        const score = Number(a.qc_score || a.score || 0);
        const band = snsScoreBand(score);
        const competitors = snsNamesForAccount(a, state.competitors);
        const risk = competitors.length > 0;
        const channels = (a.channels || []).slice(0, 3);

        return `<tr class="${risk ? "risk-row" : ""}">
          <td>
            <div class="account-cell">
              <div class="avatar">${initials(a.name)}</div>
              <div>
                <strong>${escapeHtml(a.name)}</strong>
                <span class="muted">${escapeHtml(a.company_type || "Unclassified")} | ${escapeHtml(a.owner || "Unassigned")}</span>
              </div>
            </div>
          </td>
          <td><span class="pill ${stageClass(a.stage)}">${escapeHtml(a.stage)}</span></td>
          <td>
            <span class="tier-pill ${tierClass(a.priority_tier)}">${escapeHtml(a.priority_tier || "P2")}</span>
            <span class="action-pill">${escapeHtml(a.action || "Shortlist")}</span>
          </td>
          <td>
            <div class="channel-tags">${channels.map((ch) => `<span class="channel-tag">${escapeHtml(ch.name)}</span>`).join("")}</div>
            <span class="muted">${escapeHtml(a.channel_share_note || "")}</span>
          </td>
          <td>
            <strong>${Number(a.demand_low || 0)}-${Number(a.demand_high || 0)}</strong>
            <span class="muted">orders/day</span>
          </td>
          <td>
            <span class="risk-badge ${risk ? "warn" : "clear"}">${risk ? `Risk ${competitors.length}` : "Clear"}</span>
            <span class="muted">${escapeHtml(competitors.join(", "))}</span>
          </td>
          <td>
            <strong>${shortMoney(a.deal_value)}</strong>
            <span class="muted">MRR ${shortMoney(a.weighted_mrr || 0)}</span>
          </td>
          <td>
            <span class="score-tag score-${band}">${score}</span>
          </td>
          <td>
            <strong>${formatDate(a.next_action_at)}</strong>
            <span class="muted">${escapeHtml(a.next_action || "")}</span>
          </td>
          <td>
            <div class="row-actions">
              <button class="icon" type="button" data-edit-account="${a.id}">></button>
            </div>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="10" class="muted">No matching accounts found.</td></tr>`;
}

function pipelineFilteredRows() {
  const owner = $("pipelineOwnerFilter")?.value || "all";
  const tier = $("pipelineTierFilter")?.value || "all";
  const overlap = $("pipelineOverlapFilter")?.value || "all";

  let rows = [...state.accounts];
  if (owner !== "all") rows = rows.filter((a) => a.owner === owner);
  if (tier !== "all") rows = rows.filter((a) => a.priority_tier === tier);
  if (overlap === "risk") rows = rows.filter((a) => (a.competitors_serving || []).length > 0);
  if (overlap === "clear") rows = rows.filter((a) => (a.competitors_serving || []).length === 0);
  return rows;
}

function renderPipeline() {
  const rows = pipelineFilteredRows();
  $("pipelineBoard").innerHTML = stages
    .map((stage) => {
      const stageRows = rows.filter((a) => a.stage === stage).sort((a, b) => Number(b.qc_score || b.score || 0) - Number(a.qc_score || a.score || 0));
      return `<div class="pipe-col" data-stage="${stage}">
        <div class="pipe-head"><strong>${stage}</strong><span>${stageRows.length}</span></div>
        ${stageRows
          .map((a) => {
            const risk = (a.competitors_serving || []).length > 0;
            return `<article class="deal-card" draggable="true" data-account-id="${a.id}">
              <strong><span class="tier-strip strip-${String(a.priority_tier || "P2").toLowerCase()}"></span>${escapeHtml(a.name)}</strong>
              <small>${escapeHtml(a.owner || "Unassigned")} | ${escapeHtml(a.next_action || "No next action")}</small>
              <div class="deal-meta"><span>${shortMoney(a.deal_value)}</span></div>
              ${risk ? `<span class="risk-badge warn">Risk</span>` : `<span class="risk-badge clear">Clear</span>`}
            </article>`;
          })
          .join("") || `<p class="muted">No records</p>`}
      </div>`;
    })
    .join("");

  wirePipelineDragDrop();
}

function wirePipelineDragDrop() {
  document.querySelectorAll(".deal-card[draggable='true']").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.dataset.accountId || "");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("click", () => editAccount(card.dataset.accountId));
  });

  document.querySelectorAll(".pipe-col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drop-target");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drop-target"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drop-target");
      const accountId = e.dataTransfer.getData("text/plain");
      const nextStage = col.dataset.stage;
      if (!accountId || !nextStage) return;

      const existing = state.accounts.find((a) => a.id === accountId);
      if (!existing || existing.stage === nextStage) return;

      try {
        if (hasSupabase) {
          const { error } = await db.from(tableName).update({ stage: nextStage }).eq("id", accountId);
          if (error) throw error;
          await loadData({ silent: true, source: "manual" });
        } else {
          existing.stage = nextStage;
          existing.probability = stageProbability[nextStage] ?? existing.probability;
          persistLocal();
          renderAll();
        }
      } catch (err) {
        toast(err.message || "Failed to update stage", true);
      }
    });
  });
}

function renderTasks() {
  const tasks = snsBuildTasks(state.accounts);
  $("taskList").innerHTML =
    tasks
      .map((task) => `<article class="task ${escapeHtml(task.severity)}" data-open-account="${task.accountId}">
        <div class="mark"></div>
        <div>
          <strong>${escapeHtml(task.title)} - ${escapeHtml(task.accountName || "")}</strong>
          <small>${escapeHtml(task.followupNo || "")} ${escapeHtml(task.contact || "")} ${escapeHtml(task.mode || "")} ${task.dueDate ? "| " + formatDate(task.dueDate) : ""}</small>
        </div>
        <button class="btn ghost" type="button" data-open-account="${task.accountId}">Open</button>
      </article>`)
      .join("") || `<article class="task info"><div class="mark"></div><div><strong>No open alerts</strong><small>All follow-ups are clear.</small></div></article>`;
}

function renderCompetitors() {
  $("competitorRows").innerHTML =
    state.competitors
      .map((c) => {
        const accountCount = (c.customers_served || []).length;
        return `<tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td>${escapeHtml(c.category || "-")}</td>
          <td>${Number(c.market_share_pct || 0).toFixed(2)}%</td>
          <td><button class="btn ghost small" type="button" data-focus-competitor="${c.id}">${accountCount}</button></td>
          <td>${escapeHtml((c.channels || []).join(", "))}</td>
          <td><button class="icon" type="button" data-edit-competitor="${c.id}">></button></td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="6" class="muted">No competitors yet.</td></tr>`;

  const market = snsCompetitorMarketSummary(state.competitors);
  const max = Math.max(1, ...market.map((m) => m.share));
  $("competitorChart").innerHTML =
    market
      .map((m) => `<div class="market-row"><span>${escapeHtml(m.name)}</span><div class="market-bar-wrap"><div class="market-bar-fill" style="width:${(m.share / max) * 100}%"></div></div><span>${m.share.toFixed(1)}% | ${m.accountCount} accts</span></div>`)
      .join("") || `<p class="muted">No market share data.</p>`;

  const matrix = snsBuildMatrix(state.accounts, state.competitors);
  $("matrixHead").innerHTML = `<th>Account</th><th>Overlap</th>${matrix.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("")}`;
  $("matrixBody").innerHTML =
    matrix.rows
      .map((row) => `<tr>
        <td>${escapeHtml(row.accountName)}</td>
        <td>${row.overlapCount}</td>
        ${matrix.columns.map((c) => `<td class="${row.cells[c.id] ? "matrix-risk" : "matrix-clear"}">${row.cells[c.id] ? "Yes" : "-"}</td>`).join("")}
      </tr>`)
      .join("") || `<tr><td colspan="3" class="muted">No overlap matrix data.</td></tr>`;
}

function renderAll() {
  renderFilters();
  renderKpis();
  renderStageBars();
  renderForecast();
  renderTable();
  renderPipeline();
  renderTasks();
  renderCompetitors();
  populateCompetitorSelectors();
}

function setView(view) {
  state.currentView = view;
  document.querySelectorAll(".rail-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    const panels = (panel.dataset.panel || "").split(/\s+/);
    panel.classList.toggle("hidden", !panels.includes(view));
  });

  const names = {
    dashboard: "Operational Command Center",
    accounts: "Accounts Workspace",
    pipeline: "Pipeline Board",
    tasks: "Follow-up Desk",
    competitors: "Competitor Intelligence",
    settings: "Supabase Setup"
  };
  $("pageTitle").textContent = names[view] || "Operational Command Center";
}

function switchAccountTab(tab) {
  document.querySelectorAll("#accountTabStrip .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll("#accountForm .tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tab === tab);
  });
}

function selectedMultiValues(id) {
  const select = $(id);
  if (!select) return [];
  return Array.from(select.options)
    .filter((opt) => opt.selected)
    .map((opt) => opt.value)
    .filter(Boolean);
}

function markMultiSelected(id, values = []) {
  const set = new Set(values.map((v) => String(v)));
  const select = $(id);
  if (!select) return;
  Array.from(select.options).forEach((opt) => {
    opt.selected = set.has(String(opt.value));
  });
}

function populateCompetitorSelectors() {
  const accountComp = $("competitors_serving");
  if (accountComp) {
    const previous = selectedMultiValues("competitors_serving");
    accountComp.innerHTML = state.competitors.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
    markMultiSelected("competitors_serving", previous);
  }

  const compCustomers = $("comp_customers_served");
  if (compCustomers) {
    const previous = selectedMultiValues("comp_customers_served");
    compCustomers.innerHTML = state.accounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
    markMultiSelected("comp_customers_served", previous);
  }
}

function clearAccountForm() {
  const fields = [
    "account_id",
    "name",
    "company_type",
    "contact_name",
    "contact_email",
    "contact_phone",
    "owner",
    "city",
    "deal_value",
    "probability",
    "next_action_at",
    "next_action",
    "notes",
    "priority_tier",
    "action",
    "demand_low",
    "demand_high",
    "channels_input",
    "channel_share_note",
    "competitor_wallet_share",
    "bin_slots",
    "price_per_bin",
    "weighted_mrr",
    "fu1_date",
    "fu1_contact",
    "fu1_mode",
    "fu1_status",
    "fu1_note",
    "fu2_date",
    "fu2_contact",
    "fu2_mode",
    "fu2_status",
    "fu2_note",
    "next_followup_date",
    "commercial_ask",
    "risks",
    "last_contact_at"
  ];
  fields.forEach((field) => {
    const el = $(field);
    if (!el) return;
    if (el.tagName === "SELECT") el.selectedIndex = 0;
    else el.value = "";
  });

  $("city").value = "Bangalore";
  ensureStageDropdown("Prospecting");
  $("probability").value = String(stageProbability.Prospecting);
  $("priority_tier").value = "P2";
  $("action").value = "Shortlist";
  $("score_qc_urgency").value = "3";
  $("score_sku_fit").value = "3";
  $("score_order_density").value = "3";
  $("score_pilot_willing").value = "3";
  $("score_accessibility").value = "3";
  $("score_logo_value").value = "3";
  $("price_per_bin").value = "1500";
  $("deleteBtn").style.visibility = "hidden";
  $("modalTitle").textContent = "New Account";
  $("competitorAlertBanner").classList.add("hidden");
  $("scoreBreakdownPanel").classList.add("hidden");
  markMultiSelected("competitors_serving", []);
  switchAccountTab("overview");
  updateScorePreview();
  updateWeightedMrrPreview();
}

function channelsFromInput() {
  const raw = $("channels_input").value.trim();
  if (!raw) return [];
  const names = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (!names.length) return [];
  const share = Math.floor(100 / names.length);
  const remainder = 100 - share * names.length;
  return names.map((name, idx) => ({ name, pct_share: share + (idx === 0 ? remainder : 0) }));
}

function updateScorePreview() {
  const draft = {};
  snsDimensions().forEach((dim) => {
    draft[dim.key] = Number($(dim.key).value || 3);
  });
  const result = snsCalculate(draft);
  $("qcScorePreview").textContent = String(result.qcScore);
  if (!$("scoreBreakdownPanel").classList.contains("hidden")) renderScoreBreakdown();
}

function renderScoreBreakdown() {
  const draft = {};
  snsDimensions().forEach((dim) => {
    draft[dim.key] = Number($(dim.key).value || 3);
  });
  const result = snsCalculate(draft);
  $("scoreBreakdownPanel").innerHTML = `
    ${result.contributions
      .map(
        (line) => `<div class="score-row">
          <span>${escapeHtml(line.label)}</span>
          <div class="score-mini"><span style="width:${Math.max(5, (line.contribution / 100) * 100)}%"></span></div>
          <small>${line.rating}x${line.weight}=${line.contribution}</small>
        </div>`
      )
      .join("")}
    <p class="muted">${escapeHtml(result.formulaText)} = ${result.qcScore}</p>
  `;
}

function updateWeightedMrrPreview() {
  const probability = Number($("probability").value || 0);
  const bins = Number($("bin_slots").value || 0);
  const pricePerBin = Number($("price_per_bin").value || 0);
  $("weighted_mrr").value = String(Math.round(bins * pricePerBin * (probability / 100)));
}

function updateCompetitorBanner() {
  const selected = selectedMultiValues("competitors_serving");
  const banner = $("competitorAlertBanner");
  if (!selected.length) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }
  const names = selected
    .map((id) => state.competitors.find((c) => c.id === id)?.name || id)
    .join(", ");
  const wallet = $("competitor_wallet_share").value.trim();
  banner.classList.remove("hidden");
  banner.textContent = `Competitor Alert: Served by ${names}${wallet ? ` | Wallet share: ${wallet}` : ""}`;
}

function fillAccountForm(record) {
  $("account_id").value = record.id || "";
  $("name").value = record.name || "";
  $("company_type").value = record.company_type || "";
  $("contact_name").value = record.contact_name || "";
  $("contact_email").value = record.contact_email || "";
  $("contact_phone").value = record.contact_phone || "";
  $("owner").value = record.owner || "";
  $("city").value = record.city || "";
  const stage = normalizeStage(record.stage);
  ensureStageDropdown(stage);
  $("probability").value = String(record.probability ?? "");
  $("next_action_at").value = record.next_action_at || "";
  $("next_action").value = record.next_action || "";
  $("notes").value = record.notes || "";

  $("priority_tier").value = record.priority_tier || "P2";
  $("action").value = record.action || "Shortlist";
  $("demand_low").value = String(record.demand_low || 0);
  $("demand_high").value = String(record.demand_high || 0);
  $("channels_input").value = (record.channels || []).map((c) => c.name).join(", ");
  $("channel_share_note").value = record.channel_share_note || "";

  $("score_qc_urgency").value = String(record.score_qc_urgency || 3);
  $("score_sku_fit").value = String(record.score_sku_fit || 3);
  $("score_order_density").value = String(record.score_order_density || 3);
  $("score_pilot_willing").value = String(record.score_pilot_willing || 3);
  $("score_accessibility").value = String(record.score_accessibility || 3);
  $("score_logo_value").value = String(record.score_logo_value || 3);

  $("deal_value").value = String(record.deal_value || 0);
  $("bin_slots").value = String(record.bin_slots || 0);
  $("price_per_bin").value = String(record.price_per_bin || 1500);
  $("weighted_mrr").value = String(record.weighted_mrr || 0);
  $("next_followup_date").value = record.next_followup_date || "";
  $("commercial_ask").value = record.commercial_ask || "";
  $("risks").value = record.risks || "";
  $("last_contact_at").value = record.last_contact_at || "";

  $("fu1_date").value = record.fu1_date || "";
  $("fu1_contact").value = record.fu1_contact || "";
  $("fu1_mode").value = record.fu1_mode || "Call";
  $("fu1_status").value = record.fu1_status || "Pending";
  $("fu1_note").value = record.fu1_note || "";
  $("fu2_date").value = record.fu2_date || "";
  $("fu2_contact").value = record.fu2_contact || "";
  $("fu2_mode").value = record.fu2_mode || "Email";
  $("fu2_status").value = record.fu2_status || "Pending";
  $("fu2_note").value = record.fu2_note || "";

  markMultiSelected("competitors_serving", record.competitors_serving || []);

  $("competitor_wallet_share").value = record.competitor_wallet_share || "";
  $("deleteBtn").style.visibility = "visible";
  $("modalTitle").textContent = "Edit Account";
  updateScorePreview();
  updateWeightedMrrPreview();
  updateCompetitorBanner();
}

function editAccount(id) {
  const account = state.accounts.find((a) => String(a.id) === String(id));
  if (!account) {
    toast("Account not found. Refreshing...", true);
    loadData({ source: "manual" });
    return;
  }
  fillAccountForm(account);
  $("accountDialog").showModal();
}

function accountPayload() {
  const draft = {
    score_qc_urgency: Number($("score_qc_urgency").value || 3),
    score_sku_fit: Number($("score_sku_fit").value || 3),
    score_order_density: Number($("score_order_density").value || 3),
    score_pilot_willing: Number($("score_pilot_willing").value || 3),
    score_accessibility: Number($("score_accessibility").value || 3),
    score_logo_value: Number($("score_logo_value").value || 3)
  };
  const scoreResult = snsCalculate(draft);

  const probability = Number($("probability").value || stageProbability[$("stage").value] || 0);
  const binSlots = Number($("bin_slots").value || 0);
  const pricePerBin = Number($("price_per_bin").value || 0);
  const weightedMrr = Math.round(binSlots * pricePerBin * (probability / 100));

  return {
    name: $("name").value.trim(),
    company_type: $("company_type").value.trim(),
    contact_name: $("contact_name").value.trim(),
    contact_email: $("contact_email").value.trim(),
    contact_phone: $("contact_phone").value.trim(),
    owner: $("owner").value.trim(),
    city: $("city").value.trim() || "Bangalore",
    stage: $("stage").value,
    probability,
    deal_value: Number($("deal_value").value || 0),
    next_action_at: $("next_action_at").value || null,
    next_action: $("next_action").value.trim(),
    notes: $("notes").value.trim(),
    priority_tier: $("priority_tier").value,
    action: $("action").value,
    demand_low: Number($("demand_low").value || 0),
    demand_high: Number($("demand_high").value || 0),
    channels: channelsFromInput(),
    channel_share_note: $("channel_share_note").value.trim(),
    competitors_serving: selectedMultiValues("competitors_serving"),
    competitor_wallet_share: $("competitor_wallet_share").value.trim(),
    score_qc_urgency: draft.score_qc_urgency,
    score_sku_fit: draft.score_sku_fit,
    score_order_density: draft.score_order_density,
    score_pilot_willing: draft.score_pilot_willing,
    score_accessibility: draft.score_accessibility,
    score_logo_value: draft.score_logo_value,
    qc_score: scoreResult.qcScore,
    score: scoreResult.qcScore,
    bin_slots: binSlots,
    price_per_bin: pricePerBin,
    weighted_mrr: weightedMrr,
    fu1_date: $("fu1_date").value || null,
    fu1_contact: $("fu1_contact").value.trim(),
    fu1_mode: $("fu1_mode").value,
    fu1_status: $("fu1_status").value,
    fu1_note: $("fu1_note").value.trim(),
    fu2_date: $("fu2_date").value || null,
    fu2_contact: $("fu2_contact").value.trim(),
    fu2_mode: $("fu2_mode").value,
    fu2_status: $("fu2_status").value,
    fu2_note: $("fu2_note").value.trim(),
    next_followup_date: $("next_followup_date").value || null,
    commercial_ask: $("commercial_ask").value.trim(),
    risks: $("risks").value.trim(),
    last_contact_at: $("last_contact_at").value || null
  };
}

async function saveAccount(event) {
  event.preventDefault();
  const id = $("account_id").value.trim();
  const payload = accountPayload();
  if (!payload.name) {
    toast("Account name is required", true);
    return;
  }

  const saveBtn = $("saveBtn");
  saveBtn.disabled = true;
  try {
    if (id && !state.accounts.some((a) => String(a.id) === id)) {
      throw new Error("This record is stale or missing. Please refresh and try again.");
    }

    if (!hasSupabase) {
      if (id) {
        state.accounts = state.accounts.map((a) => (String(a.id) === id ? normalizeAccount({ ...a, ...payload, id }) : a));
      } else {
        state.accounts.unshift(normalizeAccount({ id: newId("acc"), ...payload }));
      }
      persistLocal();
      $("accountDialog").close();
      renderAll();
      toast("Account saved");
      return;
    }

    const saved = await writeAccountToDb(payload, id);
    if (!saved?.id) throw new Error(id ? "Update returned no record." : "Insert returned no record.");

    $("accountDialog").close();
    await loadData({ silent: true, source: "write" });
    toast("Account saved");
  } catch (err) {
    toast(err.message || "Save failed", true);
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteAccount() {
  const id = $("account_id").value.trim();
  if (!id) {
    toast("Select an existing record before deleting.", true);
    return;
  }
  if (!state.accounts.some((a) => String(a.id) === id)) {
    toast("Record is stale or already deleted. Refreshing...", true);
    await loadData({ source: "manual" });
    return;
  }
  if (!confirm("Delete this account?")) return;

  try {
    if (!hasSupabase) {
      state.accounts = state.accounts.filter((a) => String(a.id) !== id);
      persistLocal();
      $("accountDialog").close();
      renderAll();
      toast("Account deleted");
      return;
    }

    const { error } = await db.from(tableName).delete().eq("id", id);
    if (error) throw error;

    $("accountDialog").close();
    await loadData({ silent: true, source: "write" });
    toast("Account deleted");
  } catch (err) {
    toast(err.message || "Delete failed", true);
  }
}

function clearCompetitorForm() {
  ["competitor_id", "comp_name", "comp_category", "comp_market_share_pct", "comp_channels", "comp_strengths", "comp_weaknesses", "comp_pricing_model", "comp_notes"].forEach((field) => {
    const el = $(field);
    if (el) el.value = "";
  });
  markMultiSelected("comp_customers_served", []);
  $("deleteCompetitorBtn").style.visibility = "hidden";
  $("competitorModalTitle").textContent = "New Competitor";
}

function fillCompetitorForm(comp) {
  $("competitor_id").value = comp.id || "";
  $("comp_name").value = comp.name || "";
  $("comp_category").value = comp.category || "";
  $("comp_market_share_pct").value = String(comp.market_share_pct || 0);
  $("comp_channels").value = (comp.channels || []).join(", ");
  $("comp_strengths").value = comp.strengths || "";
  $("comp_weaknesses").value = comp.weaknesses || "";
  $("comp_pricing_model").value = comp.pricing_model || "";
  $("comp_notes").value = comp.notes || "";
  markMultiSelected("comp_customers_served", comp.customers_served || []);
  $("deleteCompetitorBtn").style.visibility = "visible";
  $("competitorModalTitle").textContent = "Edit Competitor";
}

function competitorPayload() {
  const channels = $("comp_channels")
    .value.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return {
    name: $("comp_name").value.trim(),
    category: $("comp_category").value.trim(),
    market_share_pct: Number($("comp_market_share_pct").value || 0),
    channels,
    customers_served: selectedMultiValues("comp_customers_served"),
    strengths: $("comp_strengths").value.trim(),
    weaknesses: $("comp_weaknesses").value.trim(),
    pricing_model: $("comp_pricing_model").value.trim(),
    notes: $("comp_notes").value.trim()
  };
}

async function saveCompetitor(event) {
  event.preventDefault();
  const id = $("competitor_id").value.trim();
  const payload = competitorPayload();
  if (!payload.name) {
    toast("Competitor name is required", true);
    return;
  }

  const saveBtn = $("saveCompetitorBtn");
  saveBtn.disabled = true;
  try {
    if (!hasSupabase) {
      if (id) {
        state.competitors = state.competitors.map((c) => (String(c.id) === id ? snsNormalizeCompetitor({ ...c, ...payload, id }) : c));
      } else {
        state.competitors.push(snsNormalizeCompetitor({ id: newId("comp"), ...payload }));
      }
      persistLocal();
      $("competitorDialog").close();
      renderAll();
      toast("Competitor saved");
      return;
    }

    if (id) {
      const { error } = await db.from(competitorTable).update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await db.from(competitorTable).insert(payload);
      if (error) throw error;
    }

    $("competitorDialog").close();
    await loadData({ silent: true, source: "write" });
    toast("Competitor saved");
  } catch (err) {
    toast(err.message || "Competitor save failed", true);
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteCompetitor() {
  const id = $("competitor_id").value.trim();
  if (!id) {
    toast("Select an existing competitor first.", true);
    return;
  }
  if (!state.competitors.some((c) => String(c.id) === id)) {
    toast("Competitor is stale or already deleted. Refreshing...", true);
    await loadData({ source: "manual" });
    return;
  }
  if (!confirm("Delete this competitor?")) return;

  try {
    if (!hasSupabase) {
      state.competitors = state.competitors.filter((c) => String(c.id) !== id);
      state.accounts = state.accounts.map((a) => normalizeAccount({ ...a, competitors_serving: (a.competitors_serving || []).filter((x) => String(x) !== id) }));
      persistLocal();
      $("competitorDialog").close();
      renderAll();
      toast("Competitor deleted");
      return;
    }
    const { error } = await db.from(competitorTable).delete().eq("id", id);
    if (error) throw error;
    $("competitorDialog").close();
    await loadData({ silent: true, source: "write" });
    toast("Competitor deleted");
  } catch (err) {
    toast(err.message || "Delete competitor failed", true);
  }
}

function wireEvents() {
  document.querySelectorAll(".rail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setView(btn.dataset.view);
    });
  });

  $("refreshBtn").addEventListener("click", () => loadData({ source: "manual" }));
  $("newBtn").addEventListener("click", () => {
    clearAccountForm();
    $("accountDialog").showModal();
  });

  $("closeModal").addEventListener("click", () => $("accountDialog").close());
  $("cancelBtn").addEventListener("click", () => $("accountDialog").close());
  $("deleteBtn").addEventListener("click", deleteAccount);
  $("accountForm").addEventListener("submit", saveAccount);

  $("newCompetitorBtn").addEventListener("click", () => {
    clearCompetitorForm();
    $("competitorDialog").showModal();
  });
  $("closeCompetitorModal").addEventListener("click", () => $("competitorDialog").close());
  $("cancelCompetitorBtn").addEventListener("click", () => $("competitorDialog").close());
  $("deleteCompetitorBtn").addEventListener("click", deleteCompetitor);
  $("competitorForm").addEventListener("submit", saveCompetitor);

  $("accountTabStrip").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    switchAccountTab(btn.dataset.tab);
  });

  $("showScoreBreakdownBtn").addEventListener("click", () => {
    const panel = $("scoreBreakdownPanel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) renderScoreBreakdown();
  });

  ["score_qc_urgency", "score_sku_fit", "score_order_density", "score_pilot_willing", "score_accessibility", "score_logo_value"].forEach((id) => {
    $(id).addEventListener("input", updateScorePreview);
  });

  ["probability", "bin_slots", "price_per_bin"].forEach((id) => {
    $(id).addEventListener("input", updateWeightedMrrPreview);
  });

  $("competitors_serving").addEventListener("change", updateCompetitorBanner);
  $("competitor_wallet_share").addEventListener("input", updateCompetitorBanner);

  $("stage").addEventListener("change", (e) => {
    const stage = e.target.value;
    if (!$("probability").value) $("probability").value = String(stageProbability[stage] ?? 0);
    updateWeightedMrrPreview();
  });

  [
    "searchInput",
    "ownerFilter",
    "stageFilter",
    "tierFilter",
    "actionFilter",
    "channelFilter",
    "overlapFilter",
    "sortSelect"
  ].forEach((id) => {
    $(id).addEventListener("input", () => {
      renderTable();
      renderTasks();
      renderPipeline();
    });
    $(id).addEventListener("change", () => {
      renderTable();
      renderTasks();
      renderPipeline();
    });
  });

  $("stageQuickFilter").addEventListener("change", (e) => {
    state.quickStage = e.target.value || "all";
    renderTable();
  });

  $("pipelineOwnerFilter").addEventListener("change", renderPipeline);
  $("pipelineTierFilter").addEventListener("change", renderPipeline);
  $("pipelineOverlapFilter").addEventListener("change", renderPipeline);

  $("kpiGrid").addEventListener("click", (e) => {
    const card = e.target.closest(".kpi[data-filter]");
    if (!card) return;
    applyKpiFilter(card.dataset.filter);
  });

  $("accountRows").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-edit-account]");
    if (!btn) return;
    editAccount(btn.dataset.editAccount);
  });

  $("taskList").addEventListener("click", (e) => {
    const open = e.target.closest("[data-open-account]");
    if (!open) return;
    editAccount(open.dataset.openAccount);
  });

  $("competitorRows").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit-competitor]");
    if (editBtn) {
      const comp = state.competitors.find((c) => c.id === editBtn.dataset.editCompetitor);
      if (comp) {
        fillCompetitorForm(comp);
        $("competitorDialog").showModal();
      }
      return;
    }
    const focusBtn = e.target.closest("[data-focus-competitor]");
    if (focusBtn) {
      state.competitorFocusId = focusBtn.dataset.focusCompetitor || null;
      setView("accounts");
      renderTable();
      toast("Filtered accounts by selected competitor");
    }
  });

  $("exportBtn").addEventListener("click", () => {
    snsExportAccounts(filteredAccounts());
    toast("Accounts exported");
  });

  $("exportOverlapBtn").addEventListener("click", () => {
    const matrix = snsBuildMatrix(filteredAccounts(), state.competitors);
    snsExportCompetitorOverlap(matrix, state.competitors);
    toast("Overlap report exported");
  });

  $("exportCompetitorsBtn").addEventListener("click", () => {
    snsExportCompetitors(state.competitors);
    toast("Competitors exported");
  });

  const resetLocalBtn = $("resetLocalBtn");
  if (resetLocalBtn) {
    resetLocalBtn.addEventListener("click", () => {
      if (!confirm("Reset local CRM data back to the bundled V1 seed data?")) return;
      localStorage.removeItem(STORAGE_KEYS.accounts);
      localStorage.removeItem(STORAGE_KEYS.competitors);
      localStorage.removeItem(STORAGE_KEYS.channels);
      localStorage.removeItem(STORAGE_KEYS.seedVersion);
      const demo = demoState();
      state.accounts = demo.accounts;
      state.competitors = demo.competitors;
      state.channels = demo.channels;
      renderAll();
      toast("Local V1 data reset");
    });
  }
}

wireEvents();
setView("dashboard");
loadData({ source: "manual" }).then(setupRealtime);
