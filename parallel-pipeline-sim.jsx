import { useState, useMemo } from "react";

// ═══════════════════════════════════════════════════════
// SIMULATION ENGINE v4 — Parallel Pipeline, Variable Load
// ═══════════════════════════════════════════════════════

function simulate(cfg) {
  const P = cfg.patients || 1000;
  const TUBES = P * 3;
  const WB = P, PLASMA = P, SERUM = P;
  const PSA_COUNT = Math.ceil(P * 0.5 * 0.1);
  const MIN_BATCH = 50;

  const accSecPerTube = 20;
  const patientsPerMin = cfg.accessionStaff;
  const accEndMin = P / patientsPerMin;
  const minBatchMin = MIN_BATCH / patientsPerMin;

  // ── STREAM A: WB → CBC (×2) → HbA1c (×2) — 1 operator ──
  const cbcTotalPerMin = (2 * 60) / 60; // 2 machines × 60/hr = 2/min
  const cbcStartMin = minBatchMin;
  const cbcEndMin = Math.max(accEndMin, cbcStartMin + WB / cbcTotalPerMin);
  const cbcFirstResultMin = cbcStartMin + 1;
  const hba1cStartMin = cbcFirstResultMin;
  const hba1cEndMin = cbcEndMin + 1;
  const hba1cFirstResultMin = hba1cStartMin + 1;

  // ── CENTRIFUGATION (Plasma + Serum shared) ──
  const centCap = MIN_BATCH; // 50 tubes/run
  const cycleMin = 15; // 10 spin + 5 change
  const totalCentTubes = PLASMA + SERUM;
  const totalRuns = Math.ceil(totalCentTubes / centCap);
  const centrifuges = cfg.centrifuges || 3;
  const totalCycles = Math.ceil(totalRuns / centrifuges);
  const centStartMin = minBatchMin;
  const centEndMin = centStartMin + totalCycles * cycleMin;
  const centFirstOutputMin = centStartMin + cycleMin;

  // ── STREAM B: PLASMA CHEMISTRY — shared operator ──
  const plasmaStartupMin = 10;
  const plasmaRatePerMin = 200 / 60;
  const plasmaStartMin = centFirstOutputMin;
  const plasmaFirstResultMin = plasmaStartMin + plasmaStartupMin;
  const plasmaRealEnd = Math.max(centEndMin + plasmaStartupMin, plasmaStartMin + plasmaStartupMin + PLASMA / plasmaRatePerMin);

  // ── STREAM C: SERUM CHEMISTRY + PSA — same operator ──
  const serumStartupMin = 15;
  const serumRatePerMin = 200 / 60;
  const serumStartMin = centFirstOutputMin + 1;
  const serumFirstResultMin = serumStartMin + serumStartupMin;
  const serumRealEnd = Math.max(centEndMin + serumStartupMin, serumStartMin + serumStartupMin + SERUM / serumRatePerMin);

  const psaStartMin = centFirstOutputMin + 3;
  const psaEndMin = psaStartMin + 30 + PSA_COUNT / (200 / 60);

  // ── RERUNS ──
  const rerunSamples = Math.ceil(P * 0.04);
  const analyticalEndMin = Math.max(hba1cEndMin, plasmaRealEnd, serumRealEnd, psaEndMin);
  const rerunEndMin = analyticalEndMin + 25;

  // ── RACK SORTING ──
  const criticalCount = Math.ceil(P * 0.03);
  const issuesCount = Math.ceil(P * 0.05);
  const normalCount = P - criticalCount - issuesCount;
  const rackSortEnd = analyticalEndMin + 15;

  // ── APPROVAL ──
  const firstAllResultsMin = Math.max(hba1cFirstResultMin, plasmaFirstResultMin, serumFirstResultMin);
  const approvalStartMin = firstAllResultsMin;
  const approvalDuration = (P * 3) / cfg.approvers;
  const slowestEnd = Math.max(hba1cEndMin, plasmaRealEnd, serumRealEnd);
  const approvalEndMin = Math.max(
    approvalStartMin + approvalDuration,
    slowestEnd + (P * 0.05 * 3 / cfg.approvers)
  );

  const totalEndMin = Math.max(approvalEndMin, rerunEndMin, rackSortEnd);

  const stages = [
    { name: `Accession (${TUBES.toLocaleString()})`, duration: accEndMin, start: 0, end: accEndMin, color: "#7c3aed", group: "pre" },
    { name: "CBC (Whole Blood)", duration: cbcEndMin - cbcStartMin, start: cbcStartMin, end: cbcEndMin, color: "#dc2626", group: "wb" },
    { name: "HbA1c (Whole Blood)", duration: hba1cEndMin - hba1cStartMin, start: hba1cStartMin, end: hba1cEndMin, color: "#e11d48", group: "wb" },
    { name: `Centrifugation (${totalCentTubes.toLocaleString()})`, duration: centEndMin - centStartMin, start: centStartMin, end: centEndMin, color: "#ea580c", group: "cent" },
    { name: "Plasma Chemistry", duration: plasmaRealEnd - plasmaStartMin, start: plasmaStartMin, end: plasmaRealEnd, color: "#059669", group: "plasma" },
    { name: "Serum Chemistry", duration: serumRealEnd - serumStartMin, start: serumStartMin, end: serumRealEnd, color: "#2563eb", group: "serum" },
    { name: `PSA Immunoassay (${PSA_COUNT})`, duration: psaEndMin - psaStartMin, start: psaStartMin, end: psaEndMin, color: "#7c2d12", group: "serum" },
    { name: "Reruns / Dilutions", duration: 25, start: analyticalEndMin, end: rerunEndMin, color: "#a16207", group: "post" },
    { name: "Rack Sorting", duration: 15, start: analyticalEndMin, end: rackSortEnd, color: "#be185d", group: "post" },
    { name: "Result Approval", duration: approvalEndMin - approvalStartMin, start: approvalStartMin, end: approvalEndMin, color: "#4f46e5", group: "post" },
  ];

  const bottleneck = stages.reduce((a, b) => (a.end > b.end ? a : b));
  const totalStaff = cfg.accessionStaff + cfg.centrifugeOps + 1 + 1 + cfg.approvers + 1;

  return {
    P, totalEndMin, totalEndHrs: (totalEndMin / 60).toFixed(1),
    stages, bottleneck, totalStaff,
    psaSamples: PSA_COUNT, rerunSamples, totalTubes: TUBES,
    accEndMin, cbcEndMin, hba1cEndMin, centEndMin, centStartMin,
    plasmaRealEnd, serumRealEnd, psaEndMin, approvalEndMin,
    centCycles: totalCycles, centRuns: totalRuns, centCap,
    firstAllResultsMin, slowestEnd, analyticalEndMin,
    hba1cFirstResultMin, plasmaFirstResultMin, serumFirstResultMin, hba1cStartMin,
    patientsPerMin, cbcTotalPerMin, centFirstOutputMin,
    rackSortEnd, criticalCount, issuesCount, normalCount,
    MIN_BATCH, WB, PLASMA, SERUM, totalCentTubes, cbcStartMin,
  };
}

const presets = [
  { id: "lean", name: "Lean", desc: "Min staff", accent: "#dc2626",
    cfg: { patients: 1000, accessionStaff: 3, centrifuges: 2, centrifugeOps: 1, approvers: 4 } },
  { id: "optimal", name: "Optimal ✦", desc: "Best balance", accent: "#059669",
    cfg: { patients: 1000, accessionStaff: 5, centrifuges: 3, centrifugeOps: 1, approvers: 8 } },
  { id: "fast", name: "Fast", desc: "Max speed", accent: "#2563eb",
    cfg: { patients: 1000, accessionStaff: 8, centrifuges: 4, centrifugeOps: 2, approvers: 12 } },
];

// ═══════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════

function Stat({ label, value, sub, accent, small }) {
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: small ? "8px 5px" : "12px 10px", border: "1px solid #e2e8f0", textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: 9, color: "#64748b", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: small ? 15 : 20, fontWeight: 800, color: accent || "#1e293b", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#94a3b8" }}>{sub}</div>}
    </div>
  );
}

function GanttChart({ results }) {
  const maxMin = Math.max(...results.stages.map(s => s.end)) * 1.08;
  const groups = [
    { label: "PRE-ANALYTICAL", color: "#6b7280", stages: results.stages.filter(s => s.group === "pre") },
    { label: "STREAM A: WHOLE BLOOD", color: "#dc2626", stages: results.stages.filter(s => s.group === "wb") },
    { label: "CENTRIFUGATION", color: "#ea580c", stages: results.stages.filter(s => s.group === "cent") },
    { label: "STREAM B: PLASMA", color: "#059669", stages: results.stages.filter(s => s.group === "plasma") },
    { label: "STREAM C: SERUM", color: "#2563eb", stages: results.stages.filter(s => s.group === "serum") },
    { label: "POST-ANALYTICAL", color: "#4f46e5", stages: results.stages.filter(s => s.group === "post") },
  ];
  return (
    <div>
      <div style={{ display: "flex", marginBottom: 2, paddingLeft: 165 }}>
        {Array.from({ length: Math.ceil(maxMin / 60) + 1 }, (_, i) => (
          <div key={i} style={{ width: `${(60 / maxMin) * 100}%`, fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>{i}h</div>
        ))}
      </div>
      {groups.map((g, gi) => (
        <div key={gi}>
          <div style={{ fontSize: 8, fontWeight: 700, color: g.color, letterSpacing: 1.2, margin: "8px 0 3px", textTransform: "uppercase" }}>{g.label}</div>
          {g.stages.map((s, si) => {
            const left = (s.start / maxMin) * 100;
            const width = Math.max(((s.end - s.start) / maxMin) * 100, 0.8);
            const isBn = s.name === results.bottleneck.name;
            return (
              <div key={si} style={{ display: "flex", alignItems: "center", marginBottom: 4, gap: 6 }}>
                <div style={{ width: 160, fontSize: 11, fontWeight: isBn ? 700 : 500, color: isBn ? "#b91c1c" : "#374151", textAlign: "right", flexShrink: 0 }}>{s.name}</div>
                <div style={{ flex: 1, position: "relative", height: 18, background: "#f1f5f9", borderRadius: 3 }}>
                  <div style={{
                    position: "absolute", left: `${left}%`, width: `${width}%`, height: "100%",
                    background: isBn ? `repeating-linear-gradient(45deg, ${s.color}, ${s.color} 3px, ${s.color}bb 3px, ${s.color}bb 6px)` : s.color,
                    borderRadius: 3, opacity: isBn ? 1 : 0.75,
                    boxShadow: isBn ? `0 0 8px ${s.color}50` : "none",
                  }} />
                  <div style={{ position: "absolute", left: `${Math.min(left + width + 0.5, 88)}%`, top: 2, fontSize: 9, color: "#6b7280", whiteSpace: "nowrap", fontWeight: 600 }}>{(s.end / 60).toFixed(1)}h</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function RackSortDiagram({ results }) {
  const P = results.P;
  const racks = [
    { name: "🔴 CRITICAL VALUES", color: "#dc2626", bg: "#fef2f2", border: "#fecaca", count: results.criticalCount, pct: ((results.criticalCount / P) * 100).toFixed(1),
      desc: "Immediate physician notification", items: ["Glucose <40 or >500 mg/dL", "Hb <6 g/dL, K⁺ >6.5 mEq/L", "Creatinine >10 mg/dL", "TSH critical ranges"],
      action: "Priority approval → telephonic intimation within 30 min" },
    { name: "🟡 ISSUES / RERUNS", color: "#d97706", bg: "#fffbeb", border: "#fde68a", count: results.issuesCount, pct: ((results.issuesCount / P) * 100).toFixed(1),
      desc: "Reprocessing or investigation needed", items: ["Hemolyzed / lipemic / icteric", "QC flag / Westgard violations", "Dilution reruns, delta check failures", "Insufficient volume → recollect flag"],
      action: "Rerun batch → supervisor review → recollect if unresolved" },
    { name: "🟢 NORMAL / COMPLETE", color: "#059669", bg: "#f0fdf4", border: "#bbf7d0", count: results.normalCount, pct: ((results.normalCount / P) * 100).toFixed(1),
      desc: "All results within reference range", items: ["All analytes within normal limits", "No QC flags or instrument errors", "Eligible for auto-validation"],
      action: "Batch approval → PDF report → SMS/WhatsApp delivery" },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {racks.map((r, i) => (
          <div key={i} style={{ flex: 1, background: r.bg, border: `1.5px solid ${r.border}`, borderRadius: 10, padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>{r.name.split(" ")[0]}</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: r.color, marginTop: 2 }}>{r.count}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>patients ({r.pct}%)</div>
          </div>
        ))}
      </div>
      {racks.map((r, i) => (
        <div key={i} style={{ background: r.bg, border: `1.5px solid ${r.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: r.color, marginBottom: 4 }}>{r.name}</div>
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>{r.desc}</div>
          {r.items.map((item, j) => (
            <div key={j} style={{ fontSize: 11, color: "#374151", padding: "3px 0 3px 12px", borderLeft: `2px solid ${r.color}40`, marginBottom: 2 }}>{item}</div>
          ))}
          <div style={{ fontSize: 11, fontWeight: 600, color: r.color, marginTop: 6, padding: "6px 10px", background: "#fff", borderRadius: 6, border: `1px solid ${r.border}` }}>➜ {r.action}</div>
        </div>
      ))}
      <div style={{ marginTop: 8, padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 6 }}>Physical Rack Layout & Protocol</div>
        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
          <strong>Color-coded rack inserts</strong> (Red / Yellow / Green) placed at each analyzer exit point.
          <br /><strong>During processing:</strong> LIS auto-prints rack destination. Operator places tube in designated rack as result posts.
          <br /><strong>Post-processing sweep (~15 min):</strong> Every tube's rack placement verified against LIS flags.
          <br /><strong>Peripheral re-checking:</strong> 🔴 + 🟡 racks remain on bench 24 hrs for re-testing, dilutions, add-ons.
          <br /><strong>Archival:</strong> 🟢 rack tubes archived in cold storage after approval complete.
        </div>
      </div>
    </div>
  );
}

function WorkflowSequence({ results, cfg }) {
  const P = results.P;
  const steps = [
    {
      step: 1, title: "SAMPLE RECEIVING & ACCESSION",
      time: "T+0", duration: `${Math.round(results.accEndMin)} min`,
      color: "#7c3aed", bg: "#f5f3ff",
      desc: `${cfg.accessionStaff} accessioners × 3 tubes/patient × 20 sec = ${P.toLocaleString()} patients in ${Math.round(results.accEndMin)} min. Scan barcode → visual inspect → sort into 3 racks.`,
      parallel: [
        { label: "Whole Blood rack", detail: `EDTA purple → batch of ${results.MIN_BATCH} triggers CBC`, color: "#dc2626" },
        { label: "Plasma rack", detail: `Citrate/Heparin → batch of ${results.MIN_BATCH} triggers centrifuge`, color: "#059669" },
        { label: "Serum rack", detail: `SST/Red top → batch of ${results.MIN_BATCH} triggers centrifuge`, color: "#2563eb" },
      ],
      output: `Feed rate: ${results.patientsPerMin} patients/min · Min batch: ${results.MIN_BATCH} tubes`,
      trigger: `First batch ready at T+${Math.round(results.MIN_BATCH / results.patientsPerMin)} min → all 3 streams fire simultaneously`,
    },
    { step: 2, title: `THREE PARALLEL STREAMS (batch ≥ ${results.MIN_BATCH})`, time: `T+${Math.round(results.MIN_BATCH / results.patientsPerMin)} min`,
      color: "#0f172a", bg: "#f0f9ff", desc: `Min batch of ${results.MIN_BATCH} accumulated → all streams fire. Accession continues feeding in parallel.`, isParallelStart: true },
    {
      step: "2A", title: "STREAM A: WB → CBC → HbA1c (1 Operator, 4 Machines)",
      time: `T+${Math.round(results.cbcStartMin)} min → T+${Math.round(results.hba1cEndMin)} min`,
      duration: `${((results.hba1cEndMin - results.cbcStartMin) / 60).toFixed(1)} hrs`,
      color: "#dc2626", bg: "#fef2f2",
      desc: `1 Hematology Operator continuously manages 2 CBC + 2 HbA1c machines. Loads batch of ${results.MIN_BATCH} WB → CBC. As CBC results complete, transfers SAME tubes → HbA1c.`,
      substeps: [
        `CBC: 2 machines × 60/hr = ${results.cbcTotalPerMin}/min → first result T+${Math.round(results.cbcStartMin + 1)} min`,
        `HbA1c: pipeline starts T+${Math.round(results.hba1cStartMin)} min (1 min after first CBC)`,
        `Operator workflow: Load CBC M1 → Load CBC M2 → Unload M1 done → Load HbA1c M1 → repeat`,
        `Pipeline: ${P.toLocaleString()} tubes ÷ 120/hr = ${(P / 120).toFixed(1)} hrs equipment minimum`,
      ],
      critical: results.bottleneck.name.includes("HbA1c") || results.bottleneck.name.includes("CBC"),
      criticalNote: `⚠ EQUIPMENT-BOUND: ${P.toLocaleString()} ÷ 120/hr = ${(P / 120).toFixed(1)} hrs. Cannot speed up without adding machines.`,
    },
    {
      step: "2B", title: "STREAM B: PLASMA → CENTRIFUGE → CHEMISTRY",
      time: `T+${Math.round(results.centStartMin)} min → T+${Math.round(results.plasmaRealEnd)} min`,
      duration: `${((results.plasmaRealEnd - results.centStartMin) / 60).toFixed(1)} hrs`,
      color: "#059669", bg: "#f0fdf4",
      desc: `1 Chemistry+PSA Operator loads 50-tube racks from centrifuge → plasma analyzer (200/hr).`,
      substeps: [
        `Centrifuge: ${cfg.centrifuges} units × ${results.centCap}/run × 15 min → first output T+${Math.round(results.centFirstOutputMin)} min`,
        `Chemistry: 50-tube placement, 10 min startup → first result T+${Math.round(results.plasmaFirstResultMin)} min`,
        `${(200 / 60).toFixed(1)} samples/min continuous after startup`,
        `Complete: T+${(results.plasmaRealEnd / 60).toFixed(1)} hrs`,
      ],
    },
    {
      step: "2C", title: "STREAM C: SERUM → CENTRIFUGE → CHEMISTRY + PSA",
      time: `T+${Math.round(results.centStartMin)} min → T+${Math.round(Math.max(results.serumRealEnd, results.psaEndMin))} min`,
      duration: `${((Math.max(results.serumRealEnd, results.psaEndMin) - results.centStartMin) / 60).toFixed(1)} hrs`,
      color: "#2563eb", bg: "#eff6ff",
      desc: `Same Chemistry+PSA Operator handles serum analyzer + PSA immunoassay. Loads PSA during serum startup delay window.`,
      substeps: [
        `Centrifuge: shared with plasma, ${results.centCycles} total cycles`,
        `Serum chemistry: 15 min startup → first result T+${Math.round(results.serumFirstResultMin)} min`,
        `PSA branch: ${results.psaSamples} samples sorted → immunoassay (30 min startup, 200/hr)`,
        `Operator uses serum 15-min startup delay to load PSA immunoassay — zero idle time`,
        `Complete: T+${(Math.max(results.serumRealEnd, results.psaEndMin) / 60).toFixed(1)} hrs`,
      ],
    },
    {
      step: 3, title: "POST-TESTING: RERUNS + RACK SORTING",
      time: `Rolling → T+${Math.round(Math.max(results.rackSortEnd, results.rerunSamples > 0 ? results.analyticalEndMin + 25 : 0))} min`,
      duration: `~25 min post-analytical`,
      color: "#a16207", bg: "#fefce8",
      desc: `~${results.rerunSamples} samples (4%) flagged for reruns. All ${P.toLocaleString()} patients' tubes sorted into 3 designated racks during processing + final verification sweep.`,
      substeps: [
        `🔴 Critical rack: ~${results.criticalCount} patients — immediate physician notification`,
        `🟡 Issues rack: ~${results.issuesCount} patients — hemolysis, QC flags, reruns, delta checks`,
        `🟢 Normal rack: ~${results.normalCount} patients — all within reference range`,
        "Rack placement happens DURING processing (LIS flags auto-route)",
        "Final 15-min sweep: verify every tube's rack vs LIS status",
        "🔴 + 🟡 racks kept on bench 24 hrs for peripheral re-checking",
      ],
    },
    {
      step: 4, title: "RESULT APPROVAL & RELEASE",
      time: `T+${Math.round(results.firstAllResultsMin)} min → T+${Math.round(results.approvalEndMin)} min`,
      duration: `${((results.approvalEndMin - results.firstAllResultsMin) / 60).toFixed(1)} hrs`,
      color: "#4f46e5", bg: "#eef2ff",
      desc: `${cfg.approvers} approvers × 3 min/patient. Approval begins when first patient's complete set (CBC+HbA1c+Plasma+Serum±PSA) is ready.`,
      substeps: [
        `First approval at T+${Math.round(results.firstAllResultsMin)} min`,
        `${cfg.approvers} parallel: ${P.toLocaleString()} × 3 min ÷ ${cfg.approvers} = ${Math.round(P * 3 / cfg.approvers)} min`,
        "Priority: 🔴 Critical rack first → 🟡 Issues → 🟢 Normal batch",
        "Auto-validation of normals can eliminate 60-70% manual reviews",
      ],
      critical: results.bottleneck.name.includes("Approval"),
      criticalNote: "⚠ STAFF-BOUND: Add auto-validation or more approvers to reduce.",
    },
  ];

  return (
    <div>
      {steps.map((s, i) => (
        <div key={i} style={{ marginBottom: s.isParallelStart ? 8 : 12 }}>
          {s.isParallelStart ? (
            <div style={{ background: s.bg, border: `2px dashed ${s.color}40`, borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: s.color }}>⚡ {s.title}</div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{s.desc}</div>
            </div>
          ) : (
            <div style={{ background: s.bg, border: `1.5px solid ${s.color}25`, borderRadius: 12, padding: "14px 16px", borderLeft: s.critical ? `4px solid ${s.color}` : `4px solid ${s.color}40` }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: s.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{s.step}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: s.color }}>{s.title}</div>
                  <div style={{ display: "flex", gap: 12, marginTop: 2 }}>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>⏱ {s.time}</span>
                    {s.duration && <span style={{ fontSize: 11, color: "#6b7280" }}>⏳ {s.duration}</span>}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6, marginBottom: 8, marginLeft: 42 }}>{s.desc}</div>
              {s.parallel && (
                <div style={{ display: "flex", gap: 6, marginLeft: 42, marginBottom: 8, flexWrap: "wrap" }}>
                  {s.parallel.map((p, pi) => (
                    <div key={pi} style={{ flex: 1, minWidth: 130, padding: "8px 10px", borderRadius: 8, background: "#fff", border: `1px solid ${p.color}30` }}>
                      <div style={{ fontWeight: 700, fontSize: 11, color: p.color }}>{p.label}</div>
                      <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{p.detail}</div>
                    </div>
                  ))}
                </div>
              )}
              {s.substeps && (
                <div style={{ marginLeft: 42 }}>
                  {s.substeps.map((ss, si) => (
                    <div key={si} style={{ fontSize: 12, color: "#475569", padding: "4px 0 4px 14px", borderLeft: `2px solid ${s.color}30`, marginBottom: 3, lineHeight: 1.5 }}>{ss}</div>
                  ))}
                </div>
              )}
              {s.output && <div style={{ marginLeft: 42, marginTop: 6, fontSize: 11, color: "#475569", fontStyle: "italic" }}>📊 {s.output}</div>}
              {s.trigger && <div style={{ marginLeft: 42, marginTop: 4, fontSize: 11, color: s.color, fontWeight: 600 }}>🔗 {s.trigger}</div>}
              {s.critical && s.criticalNote && (
                <div style={{ marginLeft: 42, marginTop: 8, padding: "8px 12px", background: "#fff5f5", borderRadius: 6, border: "1px solid #fecaca", fontSize: 12, fontWeight: 600, color: "#991b1b" }}>{s.criticalNote}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BottleneckAnalysis({ results, cfg }) {
  const sorted = [...results.stages].sort((a, b) => b.end - a.end);
  const P = results.P;
  const mitigations = [
    { title: "CBC/HbA1c: Equipment-Bound", severity: "critical", icon: "🔴", items: [
      { fix: "Add 3rd CBC + 3rd HbA1c", impact: `${(P/120).toFixed(1)}h → ${(P/180).toFixed(1)}h (-33%)`, effort: "High (capital)" },
      { fix: "High-throughput analyzer (120/hr)", impact: "Halves WB pipeline", effort: "High" },
      { fix: `Pre-batch ${results.MIN_BATCH} WB during accession`, impact: "Zero loading gap", effort: "Low (SOP)" },
    ]},
    { title: "Result Approval: Staff-Bound", severity: "critical", icon: "🔴", items: [
      { fix: "Auto-validate normals (LIS rules)", impact: `Skip ~${results.normalCount} reviews (${((results.normalCount/P)*100).toFixed(0)}%)`, effort: "Medium" },
      { fix: `+1 approver (${cfg.approvers}→${cfg.approvers+1})`, impact: `Saves ${Math.round((P*3/cfg.approvers)-(P*3/(cfg.approvers+1)))} min`, effort: "Low" },
      { fix: "Redeploy accessioners post-accession", impact: `+${Math.min(2,cfg.accessionStaff-1)} approvers at T+${Math.round(results.accEndMin)}m`, effort: "Free" },
    ]},
    { title: `Centrifugation: ${results.centCap}/run Batch`, severity: "moderate", icon: "🟡", items: [
      { fix: `${cfg.centrifuges}×${results.centCycles} cycles×15 min`, impact: `=${Math.round(results.centEndMin-results.centStartMin)} min`, effort: "Current" },
      { fix: "+1 centrifuge", impact: `Saves ~${Math.round((results.centEndMin-results.centStartMin)/cfg.centrifuges)} min`, effort: "Medium" },
    ]},
    { title: "Accession: Feed Gate", severity: "moderate", icon: "🟡", items: [
      { fix: `${cfg.accessionStaff} staff → ${Math.round(results.accEndMin)} min`, impact: "Gates downstream", effort: "Current" },
      { fix: "Rack barcode scanner", impact: "~5 sec/tube effective", effort: "Medium" },
    ]},
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          { label: "PRIMARY BOTTLENECK", data: sorted[0], bg: "#fef2f2", border: "#fecaca", labelColor: "#991b1b", valueColor: "#dc2626" },
          { label: "2ND LONGEST", data: sorted[1], bg: "#fefce8", border: "#fef08a", labelColor: "#854d0e", valueColor: "#a16207" },
          { label: "FASTEST", data: sorted[sorted.length-1], bg: "#f0fdf4", border: "#bbf7d0", labelColor: "#166534", valueColor: "#059669" },
        ].map((c, i) => (
          <div key={i} style={{ background: c.bg, borderRadius: 10, padding: 12, border: `1px solid ${c.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: c.labelColor, fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: c.valueColor, marginTop: 2 }}>{c.data?.name}</div>
            <div style={{ fontSize: 11, color: c.labelColor }}>{(c.data?.end / 60).toFixed(1)} hrs</div>
          </div>
        ))}
      </div>
      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #e2e8f0", marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 70px 70px", padding: "8px 10px", background: "#f1f5f9", fontSize: 10, fontWeight: 700, color: "#475569" }}>
          <div>#</div><div>Stage</div><div style={{ textAlign: "right" }}>End</div><div style={{ textAlign: "right" }}>Dur</div>
        </div>
        {sorted.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr 70px 70px", padding: "7px 10px", alignItems: "center", background: i===0 ? "#fef2f2" : i%2===0 ? "#f8fafc" : "#fff", borderTop: "1px solid #f1f5f9" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: i===0?"#dc2626":"#cbd5e1", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>{i+1}</div>
            <div style={{ fontSize: 11, fontWeight: i===0?700:500, color: i===0?"#991b1b":"#374151" }}>{s.name}{i===0&&<span style={{ fontSize: 8, color: "#dc2626" }}> ⚠</span>}</div>
            <div style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: i===0?"#dc2626":"#374151" }}>{(s.end/60).toFixed(1)}h</div>
            <div style={{ textAlign: "right", fontSize: 10, color: "#94a3b8" }}>{Math.round(s.duration)}m</div>
          </div>
        ))}
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", margin: "0 0 10px" }}>Mitigation Strategies</h3>
      {mitigations.map((m, i) => (
        <div key={i} style={{ marginBottom: 8, borderRadius: 10, overflow: "hidden", border: `1px solid ${m.severity==="critical"?"#fecaca":"#fef08a"}` }}>
          <div style={{ padding: "8px 14px", background: m.severity==="critical"?"#fef2f2":"#fefce8" }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: "#1e293b" }}>{m.icon} {m.title}</span>
          </div>
          <div style={{ padding: "0 14px 8px", background: "#fff" }}>
            {m.items.map((item, j) => (
              <div key={j} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", padding: "6px 0", borderBottom: j<m.items.length-1?"1px solid #f1f5f9":"none", fontSize: 11, gap: 6 }}>
                <div style={{ color: "#374151" }}>{item.fix}</div>
                <div style={{ color: "#059669", fontWeight: 600 }}>{item.impact}</div>
                <div style={{ color: "#94a3b8", fontSize: 10, textAlign: "right" }}>{item.effort}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StaffPlan({ cfg, results }) {
  const P = results.P;
  const roles = [
    { role: "Accessioners", count: cfg.accessionStaff, color: "#7c3aed", phases: [
      `0→${Math.round(results.accEndMin)}m: scan+sort ${results.totalTubes.toLocaleString()} tubes into 3 racks`,
      `Post: ${Math.min(2,cfg.accessionStaff-1)} → approval, 1 → centrifuge assist`] },
    { role: "Centrifuge Operator", count: cfg.centrifugeOps, color: "#ea580c", phases: [
      `T+${Math.round(results.centStartMin)}m→${Math.round(results.centEndMin)}m: ${cfg.centrifuges} centrifuges, ${results.centCycles} cycles`,
      "Sort output → plasma/serum racks → feed analyzers"] },
    { role: "Hematology Operator", count: 1, color: "#dc2626", phases: [
      "Manages 4 machines: 2× CBC + 2× HbA1c",
      `Load ${results.MIN_BATCH}-tube batches → CBC → transfer → HbA1c (continuous)`,
      "QC monitoring, rack sorting for WB stream"] },
    { role: "Chemistry + PSA Operator", count: 1, color: "#059669", phases: [
      "Manages 3 analyzers: Plasma + Serum + PSA immunoassay",
      "Loads 50-tube racks from centrifuge → both analyzers simultaneously",
      `Sorts ${results.psaSamples} PSA tubes → immunoassay during startup delay`,
      "Dilution reruns, reagent checks, rack sorting for chemistry stream"] },
    { role: "Result Approvers", count: cfg.approvers, color: "#4f46e5", phases: [
      `T+${Math.round(results.firstAllResultsMin)}m: begin (3 min/pt, ${Math.round(P/cfg.approvers)} each)`,
      "Priority: 🔴 Critical → 🟡 Issues → 🟢 Normal"] },
    { role: "Supervisor", count: 1, color: "#0f172a", phases: [
      "Pipeline orchestration, QC decisions, rerun auth",
      "Final rack verification sweep, archival"] },
  ];
  const total = roles.reduce((s, r) => s + r.count, 0);

  return (
    <div>
      {roles.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", background: i%2===0?"#f8fafc":"#fff", borderRadius: 8, marginBottom: 3, alignItems: "flex-start" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: r.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{r.count}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: r.color }}>{r.role}</div>
            {r.phases.map((p, j) => (
              <div key={j} style={{ fontSize: 11, color: "#64748b", marginTop: 2, paddingLeft: 10, borderLeft: `2px solid ${r.color}30` }}>{p}</div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "linear-gradient(135deg, #1e293b, #0f766e)", borderRadius: 10, marginTop: 8, color: "#fff" }}>
        <span style={{ fontWeight: 700 }}>Total Lab Staff</span>
        <span style={{ fontWeight: 800, fontSize: 24 }}>{total}</span>
      </div>
      <div style={{ marginTop: 10, padding: 12, background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd", fontSize: 11, color: "#164e63", lineHeight: 1.7 }}>
        <strong>Operator Consolidation:</strong> Hematology op manages 4 machines (CBC output directly feeds HbA1c — same bench, same tube). Chemistry+PSA op manages 3 analyzers (loads PSA during serum 15-min startup delay — zero idle time). Both operators also handle rack sorting for their streams during analyzer wait cycles.
        <br /><strong>Redeployment:</strong> Post-accession (~{Math.round(results.accEndMin)} min), {Math.min(2, cfg.accessionStaff-1)} accessioners → approval queue, 1 → centrifuge loading assist.
      </div>
    </div>
  );
}

// ═══ MAIN APP ═══
export default function App() {
  const [activePreset, setActivePreset] = useState("optimal");
  const [view, setView] = useState("workflow");
  const [custom, setCustom] = useState({ patients: 1000, accessionStaff: 5, centrifuges: 3, centrifugeOps: 1, approvers: 8 });
  const [isCustom, setIsCustom] = useState(false);

  const allRes = useMemo(() => {
    const r = {};
    presets.forEach(p => { r[p.id] = simulate(p.cfg); });
    r.custom = simulate(custom);
    return r;
  }, [custom]);

  const cfg = isCustom ? custom : presets.find(p => p.id === activePreset).cfg;
  const res = isCustom ? allRes.custom : allRes[activePreset];
  const views = [
    { id: "workflow", label: "⚡ Workflow" },
    { id: "gantt", label: "📊 Timeline" },
    { id: "racks", label: "🧪 Racks" },
    { id: "bottleneck", label: "🔍 Bottlenecks" },
    { id: "staff", label: "👥 Staff" },
  ];

  const params = [
    { key: "patients", label: "Patients", min: 100, max: 3000, step: 50 },
    { key: "accessionStaff", label: "Accessioners", min: 1, max: 12, step: 1 },
    { key: "centrifuges", label: "Centrifuges", min: 1, max: 6, step: 1 },
    { key: "centrifugeOps", label: "Cent. Ops", min: 1, max: 3, step: 1 },
    { key: "approvers", label: "Approvers", min: 1, max: 15, step: 1 },
  ];

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", maxWidth: 880, margin: "0 auto", padding: 16, background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f766e 100%)", borderRadius: 16, padding: "20px 18px", color: "#fff", marginBottom: 12 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2, opacity: 0.5 }}>Lab IQ Central Processing</div>
        <h1 style={{ margin: "2px 0 4px", fontSize: 20, fontWeight: 800 }}>Parallel Processing Pipeline</h1>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.65 }}>{res.P.toLocaleString()} patients · {res.totalTubes.toLocaleString()} tubes · 3 streams · Min batch {res.MIN_BATCH} · 2 combined operators</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, marginTop: 12 }}>
          <Stat label="Patients" value={res.P.toLocaleString()} small />
          <Stat label="Tubes" value={res.totalTubes.toLocaleString()} sub="3/pt" small />
          <Stat label="WB Stream" value={res.WB.toLocaleString()} sub="CBC→HbA1c" small />
          <Stat label="Centrifuge" value={res.totalCentTubes.toLocaleString()} sub="P+S" small />
          <Stat label="PSA" value={res.psaSamples} sub="M >50yr" small />
          <Stat label="Staff" value={res.totalStaff} sub="total" small />
          <Stat label="Time" value={`${res.totalEndHrs}h`} accent={parseFloat(res.totalEndHrs)<=8?"#22c55e":parseFloat(res.totalEndHrs)<=10?"#eab308":"#f97316"} small />
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {presets.map(p => {
          const r = allRes[p.id]; const active = !isCustom && activePreset === p.id;
          return (
            <button key={p.id} onClick={() => { setActivePreset(p.id); setIsCustom(false); }}
              style={{ flex: 1, minWidth: 85, padding: "8px 6px", borderRadius: 10, cursor: "pointer", border: active?`2px solid ${p.accent}`:"2px solid #e2e8f0", background: active?`${p.accent}08`:"#fff", textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: active?p.accent:"#475569" }}>{p.name}</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>{p.desc}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: p.accent, marginTop: 2 }}>{r.totalEndHrs}h</div>
              <div style={{ fontSize: 9, color: "#94a3b8" }}>{r.totalStaff} staff</div>
            </button>
          );
        })}
        <button onClick={() => setIsCustom(true)}
          style={{ flex: 1, minWidth: 85, padding: "8px 6px", borderRadius: 10, cursor: "pointer", border: isCustom?"2px solid #8b5cf6":"2px solid #e2e8f0", background: isCustom?"#8b5cf608":"#fff", textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: isCustom?"#8b5cf6":"#475569" }}>Custom</div>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>adjust all</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#8b5cf6", marginTop: 2 }}>{allRes.custom.totalEndHrs}h</div>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>{allRes.custom.totalStaff} staff · {allRes.custom.P.toLocaleString()} pts</div>
        </button>
      </div>

      {isCustom && (
        <div style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 10, border: "1px solid #d8b4fe" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {params.map(p => (
              <div key={p.key}>
                <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3, fontWeight: 600 }}>{p.label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <button onClick={() => setCustom(c => ({ ...c, [p.key]: Math.max(p.min, c[p.key] - p.step) }))}
                    style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#475569", flexShrink: 0 }}>−</button>
                  <span style={{ fontWeight: 800, fontSize: p.key==="patients"?13:15, color: "#1e293b", minWidth: 26, textAlign: "center" }}>
                    {p.key==="patients"?custom[p.key].toLocaleString():custom[p.key]}
                  </span>
                  <button onClick={() => setCustom(c => ({ ...c, [p.key]: Math.min(p.max, c[p.key] + p.step) }))}
                    style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#475569", flexShrink: 0 }}>+</button>
                </div>
                <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>{p.min.toLocaleString()}–{p.max.toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: "#64748b", padding: "6px 8px", background: "#f8fafc", borderRadius: 6 }}>
            <strong>Fixed:</strong> 2× CBC, 2× HbA1c, 1× Plasma chem, 1× Serum chem, 1× PSA immunoassay · Min batch = 50 · Centrifuge = 50/run, 15 min cycle · Accession = 20 sec/tube
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 3, marginBottom: 12, background: "#e2e8f0", borderRadius: 10, padding: 3 }}>
        {views.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            style={{ flex: 1, padding: "8px 3px", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 11, background: view===v.id?"#fff":"transparent", color: view===v.id?"#1e293b":"#64748b", boxShadow: view===v.id?"0 1px 3px rgba(0,0,0,0.1)":"none" }}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "workflow" && <WorkflowSequence results={res} cfg={cfg} />}

      {view === "gantt" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e2e8f0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: "0 0 4px" }}>Parallel Gantt — {res.P.toLocaleString()} patients</h3>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
            3 simultaneous streams · Batch ≥ {res.MIN_BATCH} · Bottleneck: <strong style={{ color: "#dc2626" }}>{res.bottleneck.name}</strong>
          </div>
          <GanttChart results={res} />
          <div style={{ marginTop: 14, padding: 12, background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd", fontSize: 12, color: "#164e63", lineHeight: 1.8 }}>
            <strong>T+0:</strong> Accession → sort 3 racks | <strong>T+{Math.round(res.MIN_BATCH/res.patientsPerMin)}m:</strong> Batch {res.MIN_BATCH} → streams fire |
            <strong> T+{Math.round(res.centFirstOutputMin)}m:</strong> First centrifuged → analyzers | <strong>T+{Math.round(res.firstAllResultsMin)}m:</strong> First approval |
            <strong> T+{Math.round(res.analyticalEndMin)}m:</strong> Analytics done → rack sweep | <strong>T+{Math.round(Math.max(...res.stages.map(s=>s.end)))}m:</strong> Complete
          </div>
        </div>
      )}

      {view === "racks" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e2e8f0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: "0 0 4px" }}>Post-Testing Rack Sorting System</h3>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>3-tier triage for {res.P.toLocaleString()} patients · Sorted during processing + 15-min verification sweep</div>
          <RackSortDiagram results={res} />
        </div>
      )}

      {view === "bottleneck" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e2e8f0" }}>
          <BottleneckAnalysis results={res} cfg={cfg} />
        </div>
      )}

      {view === "staff" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid #e2e8f0" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: "0 0 4px" }}>Staffing & Redeployment</h3>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>{res.totalStaff} staff · {res.totalEndHrs}h · {res.P.toLocaleString()} patients · 2 combined operators</div>
          <StaffPlan cfg={cfg} results={res} />
        </div>
      )}

      <div style={{ textAlign: "center", padding: "12px 0 4px", fontSize: 9, color: "#94a3b8" }}>Lab IQ — Pipeline Simulator v4.0</div>
    </div>
  );
}
