(function () {
function normalizeId(id) {
  return String(id || "").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      return value.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeCompetitor(row = {}) {
  const customers = asArray(row.customers_served).map(normalizeId).filter(Boolean);
  const channels = asArray(row.channels).map((c) => {
    if (typeof c === "string") return c;
    return c?.name ? String(c.name) : "";
  }).filter(Boolean);

  return {
    ...row,
    id: row.id || "",
    name: row.name || "",
    category: row.category || "",
    market_share_pct: Number(row.market_share_pct || 0),
    customers_served: [...new Set(customers)],
    channels,
    strengths: row.strengths || "",
    weaknesses: row.weaknesses || "",
    pricing_model: row.pricing_model || "",
    notes: row.notes || ""
  };
}

function buildMatrix(accounts = [], competitors = []) {
  const columns = competitors.map((c) => ({ id: c.id, name: c.name }));
  const rows = accounts.map((account) => {
    const overlaps = asArray(account.competitors_serving).map(normalizeId);
    const cells = {};
    columns.forEach((column) => {
      cells[column.id] = overlaps.includes(column.id);
    });
    return {
      accountId: account.id,
      accountName: account.name,
      overlapCount: overlaps.length,
      cells
    };
  });

  rows.sort((a, b) => b.overlapCount - a.overlapCount || a.accountName.localeCompare(b.accountName));
  return { columns, rows };
}

function competitorMarketSummary(competitors = []) {
  const sorted = [...competitors].sort((a, b) => Number(b.market_share_pct || 0) - Number(a.market_share_pct || 0));
  return sorted.map((c) => ({
    id: c.id,
    name: c.name,
    share: Number(c.market_share_pct || 0),
    accountCount: (c.customers_served || []).length
  }));
}

function namesForAccount(account = {}, competitors = []) {
  const map = new Map(competitors.map((c) => [normalizeId(c.id), c.name]));
  return asArray(account.competitors_serving)
    .map(normalizeId)
    .filter(Boolean)
    .map((id) => map.get(id) || id);
}

window.SNSCompetitors = {
  normalizeCompetitor,
  buildMatrix,
  competitorMarketSummary,
  namesForAccount
};

})();
