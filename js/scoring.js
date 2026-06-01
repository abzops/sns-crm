(function () {
  const WEIGHTS = {
    score_qc_urgency: 15,
    score_sku_fit: 20,
    score_order_density: 15,
    score_pilot_willing: 15,
    score_accessibility: 15,
    score_logo_value: 20
  };

  const DIMENSIONS = [
    { key: "score_qc_urgency", label: "QC Urgency" },
    { key: "score_sku_fit", label: "SKU Fit" },
    { key: "score_order_density", label: "Order Density" },
    { key: "score_pilot_willing", label: "Pilot Willing" },
    { key: "score_accessibility", label: "Accessibility" },
    { key: "score_logo_value", label: "Logo Value" }
  ];

  function clampRating(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 3;
    if (n < 1) return 1;
    if (n > 5) return 5;
    return Math.round(n);
  }

  function calculate(recordDraft = {}) {
    let weighted = 0;
    const contributions = DIMENSIONS.map((dimension) => {
      const rating = clampRating(recordDraft[dimension.key]);
      const weight = WEIGHTS[dimension.key];
      const contribution = rating * weight;
      weighted += contribution;
      return { ...dimension, rating, weight, contribution };
    });

    const qcScore = Math.round(weighted / 5);
    return {
      qcScore,
      contributions,
      formulaText:
        "Score = ((Urgency*15)+(SKU Fit*20)+(Order Density*15)+(Pilot Willing*15)+(Accessibility*15)+(Logo Value*20))/5"
    };
  }

  function scoreBand(score) {
    if (score >= 80) return "high";
    if (score >= 65) return "mid";
    return "low";
  }

  function dimensions() {
    return DIMENSIONS.map((d) => ({ ...d, weight: WEIGHTS[d.key] }));
  }

  window.SNSScoring = {
    calculate,
    scoreBand,
    dimensions
  };
})();
