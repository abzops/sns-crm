(function () {
function toDate(value) {
  if (!value) return null;
  const dt = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  return Math.floor((a.getTime() - b.getTime()) / ms);
}

function isPending(status) {
  return String(status || "").toLowerCase() === "pending";
}

function buildTasks(accounts = [], now = new Date()) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00`);
  const out = [];

  accounts.forEach((account) => {
    const fu1Date = toDate(account.fu1_date);
    const fu2Date = toDate(account.fu2_date);
    const nextActionAt = toDate(account.next_action_at);
    const nextFollowupDate = toDate(account.next_followup_date);
    const competitors = Array.isArray(account.competitors_serving) ? account.competitors_serving : [];

    if (fu1Date && isPending(account.fu1_status) && fu1Date <= today) {
      out.push({
        type: fu1Date < today ? "followup_overdue" : "followup_due",
        severity: fu1Date < today ? "critical" : "warning",
        followupNo: "FU1",
        accountId: account.id,
        accountName: account.name,
        contact: account.fu1_contact,
        mode: account.fu1_mode || "Call",
        dueDate: account.fu1_date,
        title: "Follow-up 1 pending"
      });
    }

    if (fu2Date && isPending(account.fu2_status) && fu2Date <= today) {
      out.push({
        type: fu2Date < today ? "followup_overdue" : "followup_due",
        severity: fu2Date < today ? "critical" : "warning",
        followupNo: "FU2",
        accountId: account.id,
        accountName: account.name,
        contact: account.fu2_contact,
        mode: account.fu2_mode || "Email",
        dueDate: account.fu2_date,
        title: "Follow-up 2 pending"
      });
    }

    if (nextActionAt && nextActionAt < today) {
      out.push({
        type: "next_action_overdue",
        severity: "warning",
        accountId: account.id,
        accountName: account.name,
        dueDate: account.next_action_at,
        title: "Next action overdue",
        note: account.next_action || ""
      });
    }

    if (nextFollowupDate && nextFollowupDate < today) {
      out.push({
        type: "next_followup_overdue",
        severity: "warning",
        accountId: account.id,
        accountName: account.name,
        dueDate: account.next_followup_date,
        title: "Next follow-up overdue"
      });
    }

    const lastFollowup = [fu1Date, fu2Date].filter(Boolean).sort((a, b) => b - a)[0];
    if (lastFollowup && daysBetween(today, lastFollowup) > 14) {
      out.push({
        type: "no_contact_14_days",
        severity: "info",
        accountId: account.id,
        accountName: account.name,
        dueDate: account.fu1_date || account.fu2_date || "",
        title: "No contact in 14+ days"
      });
    }

    if (competitors.length > 0 && !String(account.fu1_note || "").trim()) {
      out.push({
        type: "competitor_unreviewed",
        severity: "warning",
        accountId: account.id,
        accountName: account.name,
        dueDate: "",
        title: "Competitor risk unreviewed"
      });
    }

    if (Number(account.qc_score || 0) > 80 && String(account.stage || "") === "Prospecting") {
      const updated = account.updated_at ? new Date(account.updated_at) : null;
      if (updated && !Number.isNaN(updated.getTime()) && daysBetween(today, updated) > 7) {
        out.push({
          type: "high_score_no_action",
          severity: "info",
          accountId: account.id,
          accountName: account.name,
          dueDate: "",
          title: "High score, no movement"
        });
      }
    }
  });

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  out.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 9;
    const sb = severityOrder[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.dueDate || "9999-99-99").localeCompare(String(b.dueDate || "9999-99-99"));
  });

  return out;
}

window.SNSAlerts = { buildTasks };

})();
