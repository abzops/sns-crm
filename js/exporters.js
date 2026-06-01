(function () {
function quote(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(row.map(quote).join(",")));
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportAccounts(rows = []) {
  const headers = [
    "id",
    "legacy_id",
    "name",
    "company_type",
    "contact_name",
    "contact_email",
    "contact_phone",
    "owner",
    "city",
    "stage",
    "priority_tier",
    "action",
    "deal_value",
    "probability",
    "score",
    "qc_score",
    "demand_low",
    "demand_high",
    "channels",
    "channel_share_note",
    "competitors_serving",
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
    "next_action_at",
    "next_action",
    "next_followup_date",
    "commercial_ask",
    "risks",
    "notes",
    "created_at",
    "updated_at"
  ];

  const body = rows.map((r) => [
    r.id,
    r.legacy_id,
    r.name,
    r.company_type,
    r.contact_name,
    r.contact_email,
    r.contact_phone,
    r.owner,
    r.city,
    r.stage,
    r.priority_tier,
    r.action,
    r.deal_value,
    r.probability,
    r.score,
    r.qc_score,
    r.demand_low,
    r.demand_high,
    JSON.stringify(r.channels || []),
    r.channel_share_note,
    JSON.stringify(r.competitors_serving || []),
    r.competitor_wallet_share,
    r.bin_slots,
    r.price_per_bin,
    r.weighted_mrr,
    r.fu1_date,
    r.fu1_contact,
    r.fu1_mode,
    r.fu1_status,
    r.fu1_note,
    r.fu2_date,
    r.fu2_contact,
    r.fu2_mode,
    r.fu2_status,
    r.fu2_note,
    r.next_action_at,
    r.next_action,
    r.next_followup_date,
    r.commercial_ask,
    r.risks,
    r.notes,
    r.created_at,
    r.updated_at
  ]);

  downloadCsv("stacknstock-crm-accounts.csv", headers, body);
}

function exportCompetitorOverlap(matrix, competitors = []) {
  const headers = ["account_id", "account_name", "overlap_count"].concat(
    competitors.map((c) => c.name)
  );

  const body = (matrix?.rows || []).map((row) => {
    const values = [row.accountId, row.accountName, row.overlapCount];
    competitors.forEach((c) => values.push(row.cells[c.id] ? "Yes" : "No"));
    return values;
  });

  downloadCsv("stacknstock-competitor-overlap.csv", headers, body);
}

function exportCompetitors(competitors = []) {
  const headers = [
    "id",
    "name",
    "category",
    "market_share_pct",
    "channels",
    "customers_served",
    "strengths",
    "weaknesses",
    "pricing_model",
    "notes"
  ];

  const body = competitors.map((c) => [
    c.id,
    c.name,
    c.category,
    c.market_share_pct,
    (c.channels || []).join("; "),
    (c.customers_served || []).join("; "),
    c.strengths,
    c.weaknesses,
    c.pricing_model,
    c.notes
  ]);

  downloadCsv("stacknstock-competitors.csv", headers, body);
}

window.SNSExporters = {
  exportAccounts,
  exportCompetitorOverlap,
  exportCompetitors
};

})();
