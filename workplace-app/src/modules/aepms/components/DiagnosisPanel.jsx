import React, { useState } from "react";

// ── Baseline interpolation ─────────────────────────────────────────────────
const interpolateBaseline = (baselineData, targetLoad, metric, xAxis = "load") => {
  if (!baselineData || !baselineData[metric]) return null;
  const series = baselineData[metric];
  if (!series || series.length === 0) return null;

  const xKey = xAxis === "load_percentage" ? "load_percentage" : "load";
  const sortedSeries = series.slice().sort((a, b) => a[xKey] - b[xKey]);

  const exactMatch = sortedSeries.find((point) => Math.abs(point[xKey] - targetLoad) < 0.01);
  if (exactMatch) return exactMatch.value;

  for (let i = 0; i < sortedSeries.length - 1; i++) {
    const current = sortedSeries[i];
    const next = sortedSeries[i + 1];
    if (current[xKey] <= targetLoad && targetLoad <= next[xKey]) {
      const t = (targetLoad - current[xKey]) / (next[xKey] - current[xKey]);
      return current.value + t * (next.value - current.value);
    }
  }
  return targetLoad <= sortedSeries[0][xKey]
    ? sortedSeries[0].value
    : sortedSeries[sortedSeries.length - 1].value;
};

// ── What each pattern "owns" so we don't double-report ────────────────────
const PATTERN_CONSUMES = {
  TC_FOULING:          ["Turbospeed", "ScavAir", "ScavAirPressure", "Exh_T/C_inlet", "Exh_T/C_outlet", "Exh_Cylinder_outlet"],
  SCAV_LOW:            ["ScavAir", "ScavAirPressure"],
  TURBO_LOW:           ["Turbospeed"],
  EXH_TC_IN_HIGH:      ["Exh_T/C_inlet"],
  EXH_CYL_OUT_HIGH:    ["Exh_Cylinder_outlet"],
  COMPRESSION_LOSS:    ["Pcomp", "Pmax"],
  RETARDED_INJECTION:  ["Pmax", "Pcomp"],
  EARLY_INJECTION:     ["Pmax"],
  PRESSURE_RISE:       ["Pmax", "Pcomp"],
  PRESSURE_RISE_LOW:   ["Pmax", "Pcomp"],
  FUEL_SYSTEM_WEAR:    ["FIPI"],
  CYL_PMAX_IMBALANCE:  ["Pmax"],
  CYL_PCOMP_IMBALANCE: ["Pcomp"],
  CYL_EXH_IMBALANCE:   ["Exh_Cylinder_outlet"],
  HULL_FOULING:        ["propeller_margin_percent"],
  SFOC_HIGH:           ["SFOC"],
  TREND_UNIFIED_AIR:   ["Turbospeed", "ScavAir", "ScavAirPressure", "Exh_T/C_inlet", "Exh_T/C_outlet", "Exh_Cylinder_outlet"],
  TREND_UNIFIED_COMB:  ["Pcomp", "Pmax"],
  TREND_FIPI:          ["FIPI"],
};

// ── MAIN DIAGNOSIS FUNCTION ───────────────────────────────────────────────
const getDetectedConcerns = (report, baseline, analysisMode) => {
  if (!report || !baseline || Object.keys(baseline).length === 0) return [];

  const isME  = analysisMode === "mainEngine";
  const load  = isME ? report.load : report.load_percentage;
  const xAxis = isME ? "load" : "load_percentage";

  const getBase  = (key) => interpolateBaseline(baseline, load, key, xAxis);
  const pctDev   = (actual, base) => {
    if (base == null || base === 0 || actual == null || isNaN(actual)) return null;
    return ((actual - base) / base) * 100;
  };
  const absDelta = (actual, base) => {
    if (actual == null || base == null || isNaN(actual)) return null;
    return actual - base;
  };

  // ── Raw values ────────────────────────────────────────────────────────
  const pcompAct        = Number(report.Pcomp);
  const pcompBase       = getBase("Pcomp");
  const pcompPct        = pctDev(pcompAct, pcompBase);
  const pcompIsLow      = pcompPct != null && pcompPct <= -3;
  const pcompIsCritical = pcompPct != null && pcompPct <= -5;

  const pmaxAct         = Number(report.Pmax);
  const pmaxBase        = getBase("Pmax");
  const pmaxPct         = pctDev(pmaxAct, pmaxBase);
  const pmaxIsLow       = pmaxPct != null && pmaxPct <= -3;
  const pmaxIsHigh      = pmaxPct != null && pmaxPct >= 3;
  const pmaxIsCritical  = pmaxPct != null && Math.abs(pmaxPct) > 5;

  const pressureRise =
    pmaxAct != null && pcompAct != null && !isNaN(pmaxAct) && !isNaN(pcompAct)
      ? pmaxAct - pcompAct
      : null;

  // Turbocharger — ME only
  const turboAct          = isME ? Number(report.Turbospeed) : null;
  const turboBase         = isME ? getBase("Turbospeed") : null;
  const turboDelta        = isME ? absDelta(turboAct, turboBase) : null;
  const turboIsLow        = turboDelta != null && turboDelta <= -500;
  const turboIsLowCritical = turboDelta != null && turboDelta <= -1000;

  // Scavenge air — key differs between ME and AE
  const scavKey           = isME ? "ScavAir" : "ScavAirPressure";
  const scavAct           = Number(isME ? report.ScavAir : report.ScavAirPressure);
  const scavBase          = getBase(scavKey);
  const scavPct           = pctDev(scavAct, scavBase);
  const scavIsLow         = scavPct != null && scavPct <= -5;
  const scavIsLowCritical = scavPct != null && scavPct <= -10;

  // Exhaust temperatures
  const tcInAct        = Number(report["Exh_T/C_inlet"]);
  const tcInBase       = getBase("Exh_T/C_inlet");
  const tcInDelta      = absDelta(tcInAct, tcInBase);
  const tcInIsHigh     = tcInDelta != null && tcInDelta >= 40;
  const tcInIsCritical = tcInDelta != null && tcInDelta >= 60;

  const tcOutAct        = Number(report["Exh_T/C_outlet"]);
  const tcOutBase       = getBase("Exh_T/C_outlet");
  const tcOutDelta      = absDelta(tcOutAct, tcOutBase);
  const tcOutIsHigh     = tcOutDelta != null && tcOutDelta >= 40;
  const tcOutIsCritical = tcOutDelta != null && tcOutDelta >= 60;

  const cylOutAct        = Number(report.Exh_Cylinder_outlet);
  const cylOutBase       = getBase("Exh_Cylinder_outlet");
  const cylOutDelta      = absDelta(cylOutAct, cylOutBase);
  const cylOutIsHigh     = cylOutDelta != null && cylOutDelta >= 40;
  const cylOutIsCritical = cylOutDelta != null && cylOutDelta >= 60;

  // FIPI
  const fipiAct           = Number(report.FIPI);
  const fipiBase          = getBase("FIPI");
  const fipiDelta         = absDelta(fipiAct, fipiBase);
  const fipiIsHigh        = fipiDelta != null && fipiDelta >= 2;
  const fipiIsHighCritical = fipiDelta != null && fipiDelta >= 4;
  const fipiPct           = pctDev(fipiAct, fipiBase);
  const fipiNeedsOverhaul = fipiPct != null && fipiPct >= 10;

  // Propeller margin
  const rawMargin = report.propeller_margin_percent;
  let propDev = null;
  if (rawMargin != null) {
    propDev = Math.abs(rawMargin) > 50 ? rawMargin - 100 : rawMargin;
  }
  const propIsHeavy         = propDev != null && propDev >= 0;
  const propIsHeavyCritical = propDev != null && propDev > 5;

  // ── Cylinder imbalance helper ─────────────────────────────────────────
  const checkCylinderImbalance = (cylKey, isoAvg, isPercent = false, noAmber = false) => {
    if (!report.cylinder_readings || !isoAvg) return null;
    const amberCyls = [];
    const redCyls   = [];
    Object.keys(report.cylinder_readings).forEach((cylNo) => {
      const val = Number(report.cylinder_readings[cylNo][cylKey] || 0);
      if (!val) return;
      const dev = isPercent
        ? Math.abs(((val - isoAvg) / isoAvg) * 100)
        : Math.abs(val - isoAvg);
      if (noAmber) {
        if (dev > 3) redCyls.push(`Cyl ${cylNo}`);
      } else {
        if (dev > 5) redCyls.push(`Cyl ${cylNo}`);
        else if (dev > 3) amberCyls.push(`Cyl ${cylNo}`);
      }
    });
    return {
      amber: amberCyls.length > 0 ? amberCyls.join(", ") : null,
      red:   redCyls.length   > 0 ? redCyls.join(", ")   : null,
    };
  };

  const concerns = [];

  // ====================================================================
  // QUESTION 1 — AIR SUPPLY
  // Decision tree:
  //   TC low + Scav low  → TC fouling (scav drop is the RESULT, not a
  //                         separate fault — report as ONE unified concern)
  //   Scav low, TC OK    → Air cooler or filter downstream of TC
  //   TC low, Scav OK    → Early-stage TC issue before scav pressure drops
  //
  // For AE: turboIsLow is always false (TC RPM not tracked for AE),
  //         so only the "scav low, TC OK" branch can fire for AE.
  // ====================================================================

  if (turboIsLow && scavIsLow) {
    const severity = (turboIsLowCritical || scavIsLowCritical) ? "critical" : "warning";

    // Build exhaust evidence note with actual deltas
    const exhaustEvidenceItems = [];
    if (tcInIsHigh)   exhaustEvidenceItems.push(`T/C inlet +${tcInDelta.toFixed(0)}°C`);
    if (tcOutIsHigh)  exhaustEvidenceItems.push(`T/C outlet +${tcOutDelta.toFixed(0)}°C`);
    if (cylOutIsHigh) exhaustEvidenceItems.push(`cyl outlet +${cylOutDelta.toFixed(0)}°C`);
    const exhaustNote = exhaustEvidenceItems.length > 0
      ? ` Exhaust temperatures are also elevated (${exhaustEvidenceItems.join(", ")}), consistent with air-starved combustion.`
      : "";

    const evidenceTags = ["Turbospeed", "Scav Air Pressure"];
    if (tcInIsHigh || tcOutIsHigh) evidenceTags.push("Exh T/C Temps");
    if (cylOutIsHigh)              evidenceTags.push("Exh Cyl Outlet");

    concerns.push({
      parameter: "Turbocharger Fouling",
      pattern: "TC_FOULING",
      severity,
      comparedAgainst: "Shop Trial",
      finding:
        `TC speed is ${turboDelta != null ? Math.abs(turboDelta).toFixed(0) : "N/A"} RPM below baseline ` +
        `and scavenge air pressure is ${scavPct != null ? Math.abs(scavPct).toFixed(1) : "N/A"}% below baseline. ` +
        `TC fouling reduces compressor efficiency, starving the engine of air.${exhaustNote}`,
      causes: [
        "TC compressor or turbine blade fouling reducing airflow",
        "Clogged or damaged nozzle ring restricting exhaust gas flow",
        "Air filter blockage reducing air intake to TC",
        "TC bearing wear increasing rotor friction",
      ],
      remedy:
        "Perform TC water washing on both air and exhaust sides. " +
        "Inspect and clean nozzle ring. Clean TC air filter. " +
        "Check TC bearing clearances. Monitor TC speed trend after washing.",
      evidence: evidenceTags,
    });

  } else if (scavIsLow && !turboIsLow) {
    const severity = scavIsLowCritical ? "critical" : "warning";
    concerns.push({
      parameter: "Scavenge Air Low — Air Cooler / Filter",
      pattern: "SCAV_LOW",
      severity,
      comparedAgainst: "Shop Trial",
      finding:
        `Scavenge air pressure is ${scavPct != null ? Math.abs(scavPct).toFixed(1) : "N/A"}% below baseline ` +
        `while TC speed is normal. The TC is running correctly so the restriction is ` +
        `downstream — fouled air cooler (air side) or blockage between TC and the scavenge manifold.`,
      causes: [
        "Fouled air cooler air side reducing charge air volume",
        "Air filter blockage between TC outlet and cooler inlet",
        "Scavenge air manifold leakage losing charge air",
        "Partially closed scavenge air valve or damper",
      ],
      remedy:
        "Clean air cooler air side. Inspect and clean air filter elements. " +
        "Check scavenge air manifold and associated flanges for leaks. " +
        "Verify all charge air inlet valves and dampers are fully open.",
      evidence: ["Scav Air Pressure"],
    });

  } else if (turboIsLow && !scavIsLow) {
    const severity = turboIsLowCritical ? "critical" : "warning";
    concerns.push({
      parameter: "Turbocharger Speed Low",
      pattern: "TURBO_LOW",
      severity,
      comparedAgainst: "Shop Trial",
      finding:
        `TC speed is ${turboDelta != null ? Math.abs(turboDelta).toFixed(0) : "N/A"} RPM below baseline. ` +
        `Scavenge air pressure is still within acceptable range, indicating early-stage fouling ` +
        `or a developing nozzle ring restriction before scav pressure is yet affected.`,
      causes: [
        "Early-stage TC blade fouling not yet severe enough to reduce scav pressure",
        "Partial nozzle ring blockage increasing back-pressure on turbine",
        "TC bearing wear increasing rotor friction",
      ],
      remedy:
        "Perform TC water washing (air and exhaust sides). " +
        "Inspect nozzle ring for deposits. " +
        "Monitor TC speed and scav air pressure closely at next report.",
      evidence: ["Turbospeed"],
    });
  }

  // ── Exhaust temperature concerns when TC fouling is NOT the root cause ──
  // If TC_FOULING fired, these temps are already captured as evidence inside it.
  // We only raise them independently when TC is healthy — meaning the hot
  // exhaust is caused by a combustion / fuel problem, not an air supply problem.
  const tcFoulingAlreadyRaised = concerns.some((c) => c.pattern === "TC_FOULING");

  if (!tcFoulingAlreadyRaised) {
    if (tcInIsCritical || tcInIsHigh) {
      concerns.push({
        parameter: "Exhaust T/C Inlet Temperature Elevated",
        pattern: "EXH_TC_IN_HIGH",
        severity: tcInIsCritical ? "critical" : "warning",
        comparedAgainst: "Shop Trial",
        finding:
          `Exhaust temperature at T/C inlet is +${tcInDelta != null ? tcInDelta.toFixed(0) : "N/A"}°C above baseline. ` +
          `TC speed is normal so this is not a TC fouling problem — elevated exhaust gas temperature ` +
          `entering the turbine points to a combustion or fuel delivery fault.`,
        causes: [
          "Retarded fuel injection causing late burn and high exhaust energy",
          "Worn or leaking injector nozzles producing poor atomisation",
          "High CCAI fuel causing slow ignition and prolonged combustion",
          "Leaking exhaust valve allowing hot gases to bypass at TDC",
        ],
        remedy:
          "Pressure test all fuel valves on affected cylinders. " +
          "Check fuel CCAI from BDN. " +
          "Verify injection timing (VIT index / HCU). " +
          "Inspect exhaust valve condition.",
        evidence: ["Exh T/C Inlet"],
      });
    }

    if (cylOutIsCritical || cylOutIsHigh) {
      concerns.push({
        parameter: "Exhaust Cylinder Outlet Temperature Elevated",
        pattern: "EXH_CYL_OUT_HIGH",
        severity: cylOutIsCritical ? "critical" : "warning",
        comparedAgainst: "Shop Trial",
        finding:
          `Average exhaust cylinder outlet temperature is +${cylOutDelta != null ? cylOutDelta.toFixed(0) : "N/A"}°C above baseline. ` +
          `Without a corresponding TC fault, this indicates engine-wide combustion deterioration ` +
          `rather than a single cylinder fault.`,
        causes: [
          "Engine-wide retarded injection timing",
          "Fuel quality degradation (low ignition quality / high CCAI)",
          "Gradual wear of multiple injector nozzles",
        ],
        remedy:
          "Check fuel CCAI from latest BDN. " +
          "Verify VIT index and fuel pump lead. " +
          "Pressure test fuel valves across all cylinders.",
        evidence: ["Exh Cyl Outlet"],
      });
    }
  }

  // ====================================================================
  // QUESTION 2 — COMBUSTION PRESSURES
  //   Pcomp = mechanical compression boundary (rings, liner, exhaust valve)
  //   Pmax  = ignition timing and fuel quality ON TOP of that compression
  //
  //   Both low together  → mechanical failure (injection cannot fix Pcomp)
  //   Only Pmax low      → timing / fuel issue (compression is intact)
  //   Only Pmax high     → early injection
  // ====================================================================

  if (pcompIsLow && pmaxIsLow) {
    const severity = (pcompIsCritical || pmaxIsCritical) ? "critical" : "warning";
    concerns.push({
      parameter: "Mechanical Compression Loss",
      pattern: "COMPRESSION_LOSS",
      severity,
      comparedAgainst: "Shop Trial",
      finding:
        `Both Pcomp (${pcompPct != null ? pcompPct.toFixed(1) : "N/A"}% from baseline) and ` +
        `Pmax (${pmaxPct != null ? pmaxPct.toFixed(1) : "N/A"}% from baseline) are below baseline together. ` +
        `Injection timing affects Pmax only — when Pcomp also falls, the compression boundary itself is failing mechanically.`,
      causes: [
        "Piston ring blow-by allowing gas escape during compression stroke",
        "Leaking or stuck exhaust valve — listen for hissing at reduced load",
        "Burnt or eroded piston crown reducing effective compression ratio",
        "Worn cylinder liner increasing ring-to-liner clearance",
      ],
      remedy:
        "Carry out scavenge port inspection on affected cylinders. " +
        "Perform exhaust valve drop test. " +
        "Check piston crown condition with template. " +
        "Measure cylinder liner wear at next opportunity. " +
        "Inspect stuffing box check funnel for air emission.",
      evidence: ["Pcomp", "Pmax"],
    });

  } else if (pmaxIsLow && !pcompIsLow) {
    const severity = pmaxIsCritical ? "critical" : "warning";
    concerns.push({
      parameter: "Retarded Injection / Poor Fuel Quality",
      pattern: "RETARDED_INJECTION",
      severity,
      comparedAgainst: "Shop Trial",
      finding:
        `Pmax is ${pmaxPct != null ? pmaxPct.toFixed(1) : "N/A"}% below baseline while Pcomp is normal. ` +
        `Compression is mechanically intact, so the cylinders are healthy. ` +
        `Fuel is igniting late or burning slowly — the fingerprint of retarded injection or poor ignition quality.`,
      causes: [
        "Retarded fuel injection timing (VIT index set late)",
        "Poor fuel ignition quality — high CCAI value causing delayed ignition",
        "Worn or leaking injector nozzles reducing fuel spray quality",
        "Fuel pump suction valve or puncture valve issue reducing effective delivery",
      ],
      remedy:
        "Check fuel CCAI value from BDN. " +
        "Verify VIT index calibration and fuel pump lead. " +
        "Pressure test all fuel valves. " +
        "If fuel quality confirmed poor, increase fuel pump lead to compensate.",
      evidence: ["Pmax", "Pcomp"],
    });

  } else if (pmaxIsHigh && !pcompIsLow) {
    const severity = pmaxIsCritical ? "critical" : "warning";
    concerns.push({
      parameter: "Early Injection Timing",
      pattern: "EARLY_INJECTION",
      severity,
      comparedAgainst: "Shop Trial",
      finding:
        `Pmax is ${pmaxPct != null ? pmaxPct.toFixed(1) : "N/A"}% above baseline while Pcomp is normal. ` +
        `This is the diagnostic fingerprint of early injection — fuel fires before TDC, ` +
        `creating excessive peak pressure while the compression boundary remains healthy.`,
      causes: [
        "VIT index set too early advancing injection point",
        "HCU timing fault in electronically controlled ME engines",
        "Incorrect fuel cam position on mechanically timed engines",
      ],
      remedy:
        "Check and correct VIT index calibration. " +
        "If HCU-controlled, verify HCU timing against manufacturer schedule. " +
        "Reduce fuel pump lead until Pmax returns to baseline.",
      evidence: ["Pmax", "Pcomp"],
    });
  }

  // ── Absolute pressure rise limit checks ────────────────────────────────
  if (pressureRise != null && pressureRise > 40) {
    concerns.push({
      parameter: "Pressure Rise Limit Exceeded",
      pattern: "PRESSURE_RISE",
      severity: "critical",
      comparedAgainst: "Fixed Engineering Limit (40 bar max)",
      finding:
        `Pressure rise (Pmax − Pcomp) is ${pressureRise.toFixed(1)} bar, exceeding the ` +
        `ME/ME-C design limit of 38–40 bar. Excessive pressure rise creates severe thermal ` +
        `and mechanical loading on the piston, connecting rod and main bearings.`,
      causes: [
        "Injection timing significantly advanced (VIT or HCU malfunction)",
        "Fuel pump lead set too high producing over-advanced injection",
      ],
      remedy:
        "Reduce fuel pump lead immediately. " +
        "Verify VIT calibration and HCU timing. " +
        "Do not increase load until pressure rise is within limits. " +
        "Monitor closely.",
      evidence: ["Pmax", "Pcomp"],
    });
  }

  if (pressureRise != null && load > 75 && pressureRise < 20) {
    concerns.push({
      parameter: "Pressure Rise Too Low at High Load",
      pattern: "PRESSURE_RISE_LOW",
      severity: "warning",
      comparedAgainst: "Fixed Engineering Limit (min 20 bar at >75% load)",
      finding:
        `Pressure rise (Pmax − Pcomp) is only ${pressureRise.toFixed(1)} bar at ${load != null ? load.toFixed(1) : "N/A"}% load. ` +
        `At loads above 75%, pressure rise must exceed 20 bar for efficient combustion. ` +
        `Poor energy release and elevated SFOC are expected.`,
      causes: [
        "Significantly delayed ignition (very high CCAI fuel)",
        "Retarded injection timing causing combustion to extend into expansion stroke",
      ],
      remedy:
        "Check fuel CCAI from BDN and compare against maker's recommendation. " +
        "Increase fuel pump lead to advance injection. " +
        "Monitor exhaust temperatures for signs of late combustion.",
      evidence: ["Pmax", "Pcomp"],
    });
  }

  // ====================================================================
  // QUESTION 3 — FUEL DELIVERY
  // ====================================================================
  if (fipiIsHigh) {
    const severity = fipiIsHighCritical ? "critical" : "warning";
    const overhaulNote = fipiNeedsOverhaul
      ? " FIPI has risen ≥10% above baseline — fuel pump overhaul is now recommended."
      : "";
    concerns.push({
      parameter: "Fuel System Wear — FIPI Elevated",
      pattern: "FUEL_SYSTEM_WEAR",
      severity,
      comparedAgainst: "Shop Trial",
      finding:
        `Fuel pump index is ${fipiDelta != null ? fipiDelta.toFixed(2) : "N/A"} mm above baseline ` +
        `(${fipiPct != null ? fipiPct.toFixed(1) : "N/A"}% increase). ` +
        `The engine requires more fuel index to produce the same power output, ` +
        `indicating a loss of fuel delivery efficiency.${overhaulNote}`,
      causes: [
        "Worn fuel pump plunger and barrel — higher index needed to displace same volume",
        "Leaking fuel injector nozzles wasting fuel mass without producing work",
        "Worn suction valves reducing effective pump stroke",
        "Elevated fuel viscosity increasing internal pump losses",
      ],
      remedy:
        "Pressure test all fuel valves. " +
        "Inspect fuel pump plunger and barrel condition on high-index cylinders. " +
        "Check fuel oil viscosity at engine inlet. " +
        "If FIPI is ≥10% above baseline, overhaul fuel pumps.",
      evidence: ["FIPI"],
    });
  }

  // ====================================================================
  // QUESTION 4 — CYLINDER IMBALANCE
  // ====================================================================
  if (report.cylinder_readings) {

    const pmaxImbal = checkCylinderImbalance("pmax", pmaxAct, false, true);
    if (pmaxImbal?.red || pmaxImbal?.amber) {
      const severity = pmaxImbal.red ? "critical" : "warning";
      let findingText = "";
      if (pmaxImbal.red && pmaxImbal.amber)
        findingText = `CRITICAL: ${pmaxImbal.red} deviate >±3 bar. WARNING: ${pmaxImbal.amber} deviate >±2 bar.`;
      else if (pmaxImbal.red)
        findingText = `${pmaxImbal.red} deviate more than ±3 bar from the average Pmax.`;
      else
        findingText = `${pmaxImbal.amber} deviate from average Pmax. Monitor closely.`;

      concerns.push({
        parameter: "Cylinder Injection Imbalance — Pmax",
        pattern: "CYL_PMAX_IMBALANCE",
        severity,
        comparedAgainst: "Average of all cylinders",
        finding:
          `${findingText} Average Pmax is ${pmaxAct != null ? pmaxAct.toFixed(1) : "N/A"} bar. ` +
          `Injection is imbalanced across cylinders, indicating individual cylinder-level faults.`,
        causes: [
          "Worn or blocked fuel injector on affected cylinders",
          "Injection timing drift on affected units",
          "Worn fuel pump elements on affected cylinders",
        ],
        remedy:
          "Pressure test and overhaul fuel injectors on the affected cylinders. " +
          "Verify fuel pump lead and VIT adjustment on those specific units.",
        evidence: ["Pmax (cylinder level)"],
      });
    }

    const pcompImbal = checkCylinderImbalance("pcomp", pcompAct, false, true);
    if (pcompImbal?.red || pcompImbal?.amber) {
      const severity = pcompImbal.red ? "critical" : "warning";
      let findingText = "";
      if (pcompImbal.red && pcompImbal.amber)
        findingText = `CRITICAL: ${pcompImbal.red} deviate >±3 bar. WARNING: ${pcompImbal.amber} deviate >±2 bar.`;
      else if (pcompImbal.red)
        findingText = `${pcompImbal.red} deviate more than ±3 bar from average Pcomp.`;
      else
        findingText = `${pcompImbal.amber} deviate from average Pcomp. Monitor closely.`;

      concerns.push({
        parameter: "Cylinder Compression Imbalance — Pcomp",
        pattern: "CYL_PCOMP_IMBALANCE",
        severity,
        comparedAgainst: "Average of all cylinders",
        finding:
          `${findingText} Average Pcomp is ${pcompAct != null ? pcompAct.toFixed(1) : "N/A"} bar. ` +
          `These specific cylinders have significantly worse compression than the rest of the engine.`,
        causes: [
          "Leaking piston rings on affected cylinders",
          "Leaking or stuck exhaust valve on affected cylinders",
          "Worn cylinder liner on affected units",
        ],
        remedy:
          "Carry out scavenge port inspection on affected cylinders. " +
          "Perform exhaust valve drop test. " +
          "Check piston crown with template. " +
          "Measure liner wear on affected units.",
        evidence: ["Pcomp (cylinder level)"],
      });
    }

    const exhImbal = checkCylinderImbalance("exhaust_temp", cylOutAct, true, false);
    if (exhImbal?.red || exhImbal?.amber) {
      const severity = exhImbal.red ? "critical" : "warning";
      let findingText = "";
      if (exhImbal.red && exhImbal.amber)
        findingText = `CRITICAL: ${exhImbal.red} deviate >±5% from average. WARNING: ${exhImbal.amber} deviate >±3%.`;
      else if (exhImbal.red)
        findingText = `${exhImbal.red} deviate more than ±5% from average exhaust temperature.`;
      else
        findingText = `${exhImbal.amber} deviate more than ±3% from average exhaust temperature. Monitor closely.`;

      concerns.push({
        parameter: "Individual Cylinder Exhaust Imbalance",
        pattern: "CYL_EXH_IMBALANCE",
        severity,
        comparedAgainst: "Average of all cylinders",
        finding:
          `${findingText} These cylinders are running significantly hotter or cooler than the rest. ` +
          `This indicates an individual cylinder combustion problem rather than an engine-wide issue.`,
        causes: [
          "Worn or stuck fuel injector on affected cylinders causing late or incomplete burn",
          "Exhaust valve leakage on affected cylinders",
          "Injection timing drift on those specific units",
        ],
        remedy:
          "Pressure test and overhaul fuel injectors on affected cylinders. " +
          "Check exhaust valve condition by drop test. " +
          "Inspect scavenge ports on affected units.",
        evidence: ["Exh Cyl Outlet (cylinder level)"],
      });
    }
  }

  // ====================================================================
  // QUESTION 5 — HULL / PROPELLER (ME only)
  // ====================================================================
  if (isME && propIsHeavy) {
    const severity = propIsHeavyCritical ? "critical" : "warning";
    concerns.push({
      parameter: "Heavy Running — Hull / Propeller Fouling",
      pattern: "HULL_FOULING",
      severity,
      comparedAgainst: "Service Propeller Curve",
      finding:
        `Engine is running ${propDev != null ? propDev.toFixed(1) : "N/A"}% above the service propeller curve. ` +
        `The engine is working harder than it should for the current speed, ` +
        `indicating external resistance from hull or propeller fouling.`,
      causes: [
        "Hull fouling increasing hull resistance",
        "Propeller fouling or damage reducing propeller efficiency",
        "Adverse weather or heavy sea conditions",
      ],
      remedy:
        "Review speed-power curve for a developing heavy running trend. " +
        "Plan hull cleaning and propeller inspection at next dry-dock. " +
        "Expected SFOC improvement after cleaning: 5–15%.",
      evidence: ["Propeller Margin"],
    });
  }

  // ====================================================================
  // SFOC — Result card (not a root cause)
  // ====================================================================
  const sfocAct  = Number(report.SFOC);
  const sfocBase = getBase("SFOC");
  const sfocPct  = sfocBase && sfocBase !== 0
    ? ((sfocAct - sfocBase) / sfocBase) * 100
    : null;

  if (sfocPct != null && sfocPct >= 5) {
    const isRed = sfocPct > 10;

    // Link using pattern codes — not fragile string matching
    const rootPatterns = concerns.map((c) => c.pattern);
    let contextNote = "";
    if      (rootPatterns.includes("TC_FOULING"))          contextNote = " SFOC elevation is consistent with TC fouling — air-starved combustion increases fuel consumption.";
    else if (rootPatterns.includes("COMPRESSION_LOSS"))    contextNote = " SFOC elevation is consistent with compression loss — gas blow-by wastes combustion energy.";
    else if (rootPatterns.includes("RETARDED_INJECTION"))  contextNote = " SFOC elevation is consistent with retarded injection — late combustion wastes energy in the exhaust stroke.";
    else if (rootPatterns.includes("HULL_FOULING"))        contextNote = " SFOC elevation is consistent with heavy running — engine works harder against increased resistance.";
    else if (rootPatterns.includes("FUEL_SYSTEM_WEAR"))    contextNote = " SFOC elevation is consistent with fuel system wear — more fuel injected for same power.";
    else if (rootPatterns.includes("SCAV_LOW"))            contextNote = " SFOC elevation is consistent with reduced scavenge air — incomplete combustion from air deficiency.";
    else if (rootPatterns.includes("EXH_TC_IN_HIGH") || rootPatterns.includes("EXH_CYL_OUT_HIGH"))
      contextNote = " SFOC elevation is consistent with elevated exhaust temperatures — late combustion is releasing energy into the exhaust rather than doing work.";

    concerns.push({
      parameter: "SFOC",
      pattern: "SFOC_HIGH",
      severity: isRed ? "critical" : "warning",
      comparedAgainst: "Shop Trial",
      finding:
        `SFOC has increased by +${sfocPct.toFixed(1)}% from baseline. ` +
        `Baseline: ${sfocBase != null ? sfocBase.toFixed(1) : "N/A"} g/kWh, ` +
        `Actual: ${sfocAct.toFixed(1)} g/kWh. ` +
        `SFOC is the overall efficiency result — it is a consequence of the root causes above, not a root cause in itself.${contextNote}`,
      causes: [
        "TC fouling causing air starvation and incomplete combustion",
        "Retarded injection timing causing late energy release",
        "Worn fuel pumps or injectors wasting fuel delivery",
        "Low LCV fuel oil requiring more mass to achieve same energy",
        "Hull or propeller fouling making engine work harder",
        "Compression loss from ring or valve blow-by",
      ],
      remedy:
        "Address the root cause findings above first. " +
        "Check fuel oil calorific value from BDN. " +
        "Perform TC water washing. " +
        "Pressure test fuel valves.",
      evidence: ["SFOC"],
    });
  }

  return concerns;
};

// ── Trend diagnosis ────────────────────────────────────────────────────────
const getTrendDiagnosisFindings = (availableReports, baseline, analysisMode) => {
  if (!availableReports || availableReports.length < 2) return [];
  if (!baseline || Object.keys(baseline).length === 0) return [];

  const isME  = analysisMode === "mainEngine";
  const xAxis = isME ? "load" : "load_percentage";

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const sorted = [...availableReports]
    .filter((r) => r.report_date && new Date(r.report_date) >= oneYearAgo)
    .sort((a, b) => new Date(a.report_date) - new Date(b.report_date));

  if (sorted.length < 2) return [];

  const baseTime = new Date(sorted[0].report_date).getTime();
  const getMonthsSinceStart = (dateStr) => {
    const ms = new Date(dateStr).getTime() - baseTime;
    return ms / (1000 * 3600 * 24 * 30.44);
  };

  const TREND_PARAMS = isME
    ? [
        { key: "Turbospeed",          label: "Turbocharger Speed", group: "AIR_SUPPLY",    isAbs: true,  amber: 500, red: 1000, lowerOnly: true  },
        { key: "ScavAir",             label: "Scavenge Air Press", group: "AIR_SUPPLY",    isAbs: false, amber: 5,   red: 10,   lowerOnly: true  },
        { key: "Exh_T/C_inlet",       label: "Exh T/C Inlet",      group: "AIR_SUPPLY",    isAbs: true,  amber: 40,  red: 60,   lowerOnly: false },
        { key: "Exh_T/C_outlet",      label: "Exh T/C Outlet",     group: "AIR_SUPPLY",    isAbs: true,  amber: 40,  red: 60,   lowerOnly: false },
        { key: "Pcomp",               label: "Pcomp",              group: "COMBUSTION",    isAbs: false, amber: 3,   red: 5,    lowerOnly: true  },
        { key: "Pmax",                label: "Pmax",               group: "COMBUSTION",    isAbs: false, amber: 3,   red: 5,    lowerOnly: false },
        { key: "Exh_Cylinder_outlet", label: "Exh Cyl Outlet",     group: "COMBUSTION",    isAbs: true,  amber: 40,  red: 60,   lowerOnly: false },
        { key: "FIPI",                label: "Fuel Index (FIPI)",  group: "FUEL_DELIVERY", isAbs: false, amber: 5,   red: 10,   upperOnly: true  },
      ]
    : [
        { key: "Pmax",                label: "Pmax",               group: "COMBUSTION",    isAbs: false, amber: 3,   red: 5,    lowerOnly: false },
        { key: "ScavAirPressure",     label: "Scavenge Air Press", group: "AIR_SUPPLY",    isAbs: false, amber: 5,   red: 10,   lowerOnly: true  },
        { key: "Exh_T/C_inlet",       label: "Exh T/C Inlet",      group: "AIR_SUPPLY",    isAbs: true,  amber: 40,  red: 60,   lowerOnly: false },
        { key: "Exh_T/C_outlet",      label: "Exh T/C Outlet",     group: "AIR_SUPPLY",    isAbs: true,  amber: 40,  red: 60,   lowerOnly: false },
        { key: "FIPI",                label: "Fuel Index (FIPI)",  group: "FUEL_DELIVERY", isAbs: false, amber: 5,   red: 10,   upperOnly: true  },
        { key: "Exh_Cylinder_outlet", label: "Exh Cyl Outlet",     group: "COMBUSTION",    isAbs: true,  amber: 40,  red: 60,   lowerOnly: false },
      ];

  const devSeries = {};
  TREND_PARAMS.forEach(({ key, isAbs }) => {
    const series = sorted.map((report) => {
      const load   = isME ? report.load : report.load_percentage;
      const actual = report[key];
      const base   = interpolateBaseline(baseline, load, key, xAxis);
      const xVal   = getMonthsSinceStart(report.report_date);
      if (actual == null || base == null || base === 0)
        return { xVal, date: report.displayName, val: null };
      const devValue = isAbs ? actual - base : ((actual - base) / base) * 100;
      return { xVal, date: report.displayName, val: devValue };
    });
    if (series.filter((p) => p.val != null).length >= 2) devSeries[key] = series;
  });

  const detectedDrifts = {};
  TREND_PARAMS.forEach(({ key, label, group, isAbs, amber, red, lowerOnly, upperOnly }) => {
    const series = devSeries[key];
    if (!series) return;

    const validPts = series.filter((p) => p.val != null).map((p) => ({ x: p.xVal, v: p.val }));
    if (validPts.length < 2) return;

    let trendLatest = validPts[validPts.length - 1].v;
    let trendPrev   = validPts[validPts.length - 2].v;

    if (validPts.length >= 3) {
      const n = validPts.length;
      const x = validPts.map((p) => p.x);
      const y = validPts.map((p) => p.v);
      const allSameX = x.every((v) => v === x[0]);
      if (!allSameX) {
        let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0, sumY = 0, sumXY = 0, sumX2Y = 0;
        for (let i = 0; i < n; i++) {
          sumX += x[i]; sumX2 += x[i] ** 2; sumX3 += x[i] ** 3; sumX4 += x[i] ** 4;
          sumY += y[i]; sumXY += x[i] * y[i]; sumX2Y += x[i] ** 2 * y[i];
        }
        const A = [[n, sumX, sumX2], [sumX, sumX2, sumX3], [sumX2, sumX3, sumX4]];
        const B = [sumY, sumXY, sumX2Y];
        for (let i = 0; i < 3; i++) {
          for (let j = i + 1; j < 3; j++) {
            const r = A[j][i] / A[i][i];
            for (let k = i; k < 3; k++) A[j][k] -= r * A[i][k];
            B[j] -= r * B[i];
          }
        }
        const c = [0, 0, 0];
        for (let i = 2; i >= 0; i--) {
          c[i] = B[i];
          for (let j = i + 1; j < 3; j++) c[i] -= A[i][j] * c[j];
          c[i] /= A[i][i];
        }
        const lastX = validPts[validPts.length - 1].x;
        const prevX = validPts[validPts.length - 2].x;
        const cL = c[0] + c[1] * lastX + c[2] * lastX ** 2;
        const cP = c[0] + c[1] * prevX + c[2] * prevX ** 2;
        if (Number.isFinite(cL) && Number.isFinite(cP)) {
          trendLatest = cL;
          trendPrev   = cP;
        }
      }
    }

    const getFaultMag = (v) => {
      if (v == null) return 0;
      if (lowerOnly) return v < 0 ? Math.abs(v) : 0;
      if (upperOnly) return v > 0 ? v : 0;
      return Math.abs(v);
    };

    const latestMag = getFaultMag(trendLatest);
    const prevMag   = getFaultMag(trendPrev);

    if (latestMag >= amber) {
      detectedDrifts[key] = {
        label,
        group,
        isAbs,
        latest: trendLatest,
        isCritical: latestMag >= red,
        isSudden: prevMag < amber && latestMag >= red,
        unit: isAbs ? (key === "Turbospeed" ? " RPM" : " °C") : "%",
      };
    }
  });

  const trendFindings = [];

  // AIR SUPPLY GROUP
  const airGroupKeys = TREND_PARAMS
    .filter((p) => p.group === "AIR_SUPPLY" || p.key === "Exh_Cylinder_outlet")
    .map((p) => p.key);
  const activeAirDrifts = airGroupKeys.filter((k) => detectedDrifts[k]);

  if (activeAirDrifts.length > 0) {
    const isCritical    = activeAirDrifts.some((k) => detectedDrifts[k].isCritical);
    const isSudden      = activeAirDrifts.some((k) => detectedDrifts[k].isSudden);
    const evidenceLabels = activeAirDrifts.map((k) => detectedDrifts[k].label);
    const details = activeAirDrifts
      .map((k) => {
        const d = detectedDrifts[k];
        return `${d.label} (${d.latest > 0 ? "+" : ""}${d.latest.toFixed(1)}${d.unit})`;
      })
      .join(", ");

    trendFindings.push({
      parameter: "Progressive Air System Degradation",
      pattern: "TREND_UNIFIED_AIR",
      trendGroup: "AIR_SUPPLY",
      severity: isCritical ? "critical" : "warning",
      comparedAgainst: "Trend Regression",
      finding:
        `${isSudden ? "Sudden" : "Progressive"} deterioration detected in the air/exhaust system. ` +
        `Drifting parameters: ${details}. ` +
        `This combination strongly suggests fouling in the air path (Turbocharger or Air Cooler) ` +
        `leading to air-starved combustion and elevated exhaust temperatures.`,
      causes: [
        "Turbocharger compressor/turbine blade fouling",
        "Air cooler air-side fouling",
        "Air filter blockage",
      ],
      remedy:
        "Schedule TC water washing (air and exhaust side). " +
        "Inspect and clean air cooler. " +
        "Clean TC air filters.",
      evidence: evidenceLabels,
    });
  }

  // COMBUSTION GROUP
  const combGroupKeys  = ["Pmax", "Pcomp"];
  const activeCombDrifts = combGroupKeys.filter((k) => detectedDrifts[k]);

  if (activeCombDrifts.length > 0) {
    const isCritical     = activeCombDrifts.some((k) => detectedDrifts[k].isCritical);
    const evidenceLabels = activeCombDrifts.map((k) => detectedDrifts[k].label);
    const details = activeCombDrifts
      .map((k) => {
        const d = detectedDrifts[k];
        return `${d.label} (${d.latest > 0 ? "+" : ""}${d.latest.toFixed(1)}${d.unit})`;
      })
      .join(", ");

    const pcompDrift = detectedDrifts["Pcomp"];
    const pmaxDrift  = detectedDrifts["Pmax"];

    let diagnosisText = "";
    let causes = [];
    let remedy = "";

    if (pcompDrift && pmaxDrift && pcompDrift.latest < 0 && pmaxDrift.latest < 0) {
      diagnosisText = "Both Pcomp and Pmax are drifting downward together — progressive mechanical compression loss.";
      causes = ["Piston ring blow-by", "Progressive liner wear", "Exhaust valve leakage"];
      remedy = "Plan scavenge port inspection. Measure liner wear. Perform exhaust valve drop test.";
    } else if (pmaxDrift && pmaxDrift.latest < 0) {
      diagnosisText = "Pmax drifting downward while Pcomp remains stable — injection timing or fuel quality issue developing over time.";
      causes = ["Fuel injection timing retarding", "Worn fuel injector nozzles", "Varying fuel quality (CCAI)"];
      remedy = "Check fuel pump lead and VIT settings. Pressure test injectors.";
    } else if (pmaxDrift && pmaxDrift.latest > 0) {
      diagnosisText = "Pmax drifting upward while Pcomp remains stable — early injection timing trend.";
      causes = ["Fuel injection timing advancing over time", "VIT or HCU timing drift"];
      remedy = "Check fuel pump lead and VIT settings. Verify HCU timing.";
    } else {
      diagnosisText = `Progressive deterioration in combustion pressures: ${details}.`;
      causes = ["Piston ring blow-by", "Exhaust valve leakage"];
      remedy = "Inspect piston rings via scavenge ports.";
    }

    trendFindings.push({
      parameter: "Progressive Combustion Deviation",
      pattern: "TREND_UNIFIED_COMB",
      trendGroup: "COMBUSTION",
      severity: isCritical ? "critical" : "warning",
      comparedAgainst: "Trend Regression",
      finding: diagnosisText + ` Current drift: ${details}.`,
      causes,
      remedy,
      evidence: evidenceLabels,
    });
  }

  // FUEL DELIVERY trend
  if (detectedDrifts["FIPI"]) {
    const d = detectedDrifts["FIPI"];
    trendFindings.push({
      parameter: "Progressive Fuel System Wear",
      pattern: "TREND_FIPI",
      trendGroup: "FUEL_DELIVERY",
      severity: d.isCritical ? "critical" : "warning",
      comparedAgainst: "Trend Regression",
      finding:
        `Fuel Pump Index (FIPI) shows a progressive upward drift (+${d.latest.toFixed(1)}%). ` +
        `The engine requires more fuel index to achieve the same power output, ` +
        `indicating developing wear in the fuel delivery system.`,
      causes: [
        "Worn fuel pump plungers/barrels",
        "Internal fuel pump leakage",
        "Leaking injector nozzles",
      ],
      remedy:
        "Monitor fuel pump performance. " +
        "Overhaul fuel pumps if index exceeds +10% from baseline.",
      evidence: ["Fuel Index (FIPI)"],
    });
  }

  return trendFindings;
};

// ── groupIntoVerdicts ─────────────────────────────────────────────────────
// Rules:
// 1. All current-report findings are always shown.
// 2. A trend finding is shown ONLY if it adds information about a parameter
//    NOT already consumed by a current-report finding.
const groupIntoVerdicts = (findings) => {
  const currentFindings = findings.filter((f) => !f.pattern?.startsWith("TREND_"));
  const trendFindings   = findings.filter((f) =>  f.pattern?.startsWith("TREND_"));

  const consumedByCurrentReport = new Set();
  currentFindings.forEach((f) => {
    const consumed = PATTERN_CONSUMES[f.pattern] || [];
    consumed.forEach((k) => consumedByCurrentReport.add(k));
  });

  const verdicts = currentFindings.map((f) => ({
    ...f,
    evidence: f.evidence || [f.parameter],
  }));

  trendFindings.forEach((f) => {
    const consumed = PATTERN_CONSUMES[f.pattern] || [];
    const isNewInformation = consumed.some((k) => !consumedByCurrentReport.has(k));
    if (isNewInformation) {
      verdicts.push({ ...f, evidence: f.evidence || [f.parameter] });
    }
  });

  return verdicts;
};

// ── OverallEngineHealthCard ───────────────────────────────────────────────
const OverallEngineHealthCard = ({ findings, report }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(null);

  const verdicts     = groupIntoVerdicts(findings);
  const selectedItem = selectedIdx !== null ? verdicts[selectedIdx] : null;

  const getTileColors = (item) => {
    if (item.severity === "critical")
      return {
        bg: "#1a0a0a", border: "#7f1d1d", titleColor: "#fecaca",
        subColor: "#f87171", badgeBg: "#7f1d1d", badgeText: "#ffd0d0", badgeLabel: "CRITICAL",
      };
    return {
      bg: "#1a1400", border: "#713f12", titleColor: "#fef08a",
      subColor: "#fbbf24", badgeBg: "#713f12", badgeText: "#fef08a", badgeLabel: "WARNING",
    };
  };

  if (verdicts.length === 0) return null;

  return (
    <div style={{ marginBottom: "24px", borderRadius: "14px", overflow: "hidden", border: "1.5px solid #1e293b", backgroundColor: "#0f172a", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ backgroundColor: "#1e293b", borderBottom: isExpanded ? "1.5px solid #334155" : "none", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
      >
        <h3 style={{ margin: 0, color: "#f1f5f9", fontWeight: "800", fontSize: "1rem", display: "flex", alignItems: "center", gap: "10px" }}>
          🔧 Overall Engine Health
          <span style={{ backgroundColor: "#334155", color: "#94a3b8", fontSize: "0.7rem", fontWeight: "700", padding: "2px 10px", borderRadius: "20px", border: "1px solid #475569" }}>
            {verdicts.length} Issue{verdicts.length !== 1 ? "s" : ""} Found
          </span>
          {verdicts.some((v) => v.severity === "critical") && (
            <span style={{ backgroundColor: "#7f1d1d22", color: "#f87171", fontSize: "0.65rem", fontWeight: "800", padding: "2px 10px", borderRadius: "20px", border: "1px solid #ef444455" }}>
              ACTION REQUIRED
            </span>
          )}
        </h3>
        <span style={{ fontSize: "1.1rem", color: "#94a3b8", transition: "transform 0.3s ease", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▼</span>
      </div>

      {isExpanded && (
        <div style={{ padding: "20px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "10px", marginBottom: selectedItem ? "16px" : "0" }}>
            {verdicts.map((item, idx) => {
              const c          = getTileColors(item);
              const isSelected = selectedIdx === idx;
              return (
                <div
                  key={idx}
                  onClick={() => setSelectedIdx(isSelected ? null : idx)}
                  style={{ backgroundColor: c.bg, border: `1.5px solid ${isSelected ? "#ffffff44" : c.border}`, borderRadius: "10px", padding: "12px", cursor: "pointer", userSelect: "none", position: "relative", height: "130px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", outline: isSelected ? `2px solid ${c.border}` : "none", outlineOffset: "2px", transition: "all 0.15s ease", boxShadow: isSelected ? `0 0 0 2px ${c.border}` : "none" }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.filter = "brightness(1.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = "brightness(1)"; }}
                >
                  <div style={{ position: "absolute", top: "8px", right: "8px", backgroundColor: c.badgeBg, color: c.badgeText, fontSize: "0.5rem", fontWeight: "700", padding: "2px 6px", borderRadius: "4px", textTransform: "uppercase" }}>
                    {c.badgeLabel}
                  </div>
                  <div style={{ color: c.titleColor, fontWeight: "800", fontSize: "0.85rem", lineHeight: "1.3", paddingRight: "60px", marginTop: "4px" }}>
                    {item.parameter}
                  </div>
                  {item.evidence && item.evidence.length > 1 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginTop: "4px" }}>
                      {item.evidence.slice(0, 3).map((ev, i) => (
                        <span key={i} style={{ fontSize: "0.5rem", fontWeight: "700", backgroundColor: `${c.border}55`, color: c.subColor, padding: "1px 5px", borderRadius: "3px" }}>
                          {ev.replace(" (Average)", "").replace("Exh. ", "")}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", color: c.subColor, fontSize: "0.65rem", fontWeight: "700", marginTop: "8px" }}>
                    <span style={{ transition: "transform 0.2s", transform: isSelected ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
                    {isSelected ? "Hide details" : "View details"}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedItem && (() => {
            const c = getTileColors(selectedItem);
            return (
              <div style={{ border: `1.5px solid ${c.border}`, borderRadius: "10px", overflow: "hidden", backgroundColor: c.bg }}>
                <div style={{ padding: "12px 20px", backgroundColor: "#0d0d1a", borderBottom: `1px solid ${c.border}44`, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}>
                  <span style={{ color: c.titleColor, fontWeight: "800", fontSize: "0.9rem" }}>{selectedItem.parameter}</span>
                  <span style={{ color: c.subColor, fontSize: "0.7rem", fontWeight: "700", textTransform: "uppercase", opacity: 0.85, textAlign: "center" }}>
                    {selectedItem.comparedAgainst ? `vs ${selectedItem.comparedAgainst}` : ""}
                  </span>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setSelectedIdx(null)} style={{ background: "none", border: "none", color: c.subColor, cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>✕</button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr" }}>
                  <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", backgroundColor: "#0d0d1a", borderBottom: `1px solid ${c.border}44` }}>
                    {["Observation", "Possible Causes", "Diagnosis & Remedy"].map((h, i) => (
                      <div key={h} style={{ padding: "8px 16px", fontSize: "0.65rem", fontWeight: "800", color: c.subColor, textTransform: "uppercase", letterSpacing: "0.08em", borderLeft: i > 0 ? `1px solid ${c.border}44` : "none" }}>{h}</div>
                    ))}
                  </div>
                  <div style={{ padding: "16px", fontSize: "0.85rem", fontWeight: "600", color: c.titleColor, lineHeight: "1.5" }}>
                    {selectedItem.finding}
                  </div>
                  <div style={{ padding: "16px", borderLeft: `1px solid ${c.border}44` }}>
                    <ul style={{ margin: 0, paddingLeft: "14px", color: c.subColor, fontSize: "0.82rem", fontWeight: "500", lineHeight: "1.7" }}>
                      {selectedItem.causes.map((cause, i) => <li key={i}>{cause}</li>)}
                    </ul>
                  </div>
                  <div style={{ padding: "16px", borderLeft: `1px solid ${c.border}44`, backgroundColor: "#0f1e2a" }}>
                    <ul style={{ margin: 0, paddingLeft: "14px", color: "#a8d8f0", fontSize: "0.82rem", fontWeight: "600", lineHeight: "1.7" }}>
                      {selectedItem.remedy
                        .split(".")
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0)
                        .map((point, i) => <li key={i}>{point}.</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

// ── SFOCInsightCard ───────────────────────────────────────────────────────
const SFOCInsightCard = ({ findings, report, baseline, analysisMode }) => {
  const [isExpanded, setIsExpanded]   = useState(true);
  const [bunkerPrice, setBunkerPrice] = useState(600);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput]   = useState("600");

  if (!findings || findings.length === 0) return null;

  const sfocFinding = findings[0];
  const isME   = analysisMode === "mainEngine";
  const xAxis  = isME ? "load" : "load_percentage";
  const load   = isME ? report?.load : report?.load_percentage;

  const sfocActual = Number(report?.SFOC);
  const sfocBase   = interpolateBaseline(baseline, load, "SFOC", xAxis);
  const sfocDev    = sfocBase != null && sfocBase !== 0
    ? ((sfocActual - sfocBase) / sfocBase) * 100
    : null;

  const powerKW = report?.shaft_power_kw || report?.effective_power_kw || 0;

  const extraSFOC = sfocBase != null && sfocActual != null && !isNaN(sfocActual)
    ? sfocActual - sfocBase
    : null;
  const extraFuelPerDay   = extraSFOC != null && powerKW ? (extraSFOC * powerKW * 24) / 1_000_000 : null;
  const extraFuelPerMonth = extraFuelPerDay != null ? extraFuelPerDay * 30 : null;
  const costPerMonth      = extraFuelPerMonth != null ? extraFuelPerMonth * bunkerPrice : null;
  const co2PerMonth       = extraFuelPerMonth != null ? extraFuelPerMonth * 3.114 : null;

  const isRed   = sfocDev != null && sfocDev > 10;
  const isAmber = sfocDev != null && sfocDev > 5 && sfocDev <= 10;
  const headerBg    = isRed ? "#1a0800" : "#1a1200";
  const accentColor = isRed ? "#fb923c" : "#fbbf24";
  const borderColor = isRed ? "#7c2d12" : "#78350f";
  const badgeColor  = isRed ? "#dc2626" : "#d97706";

  // Use pattern codes to identify linked root causes (not string matching)
  const rootCausesFound = [];
  if (sfocFinding.finding?.includes("TC fouling"))    rootCausesFound.push("TC Fouling");
  if (sfocFinding.finding?.includes("compression"))   rootCausesFound.push("Compression Loss");
  if (sfocFinding.finding?.includes("injection"))     rootCausesFound.push("Injection Issue");
  if (sfocFinding.finding?.includes("hull") || sfocFinding.finding?.includes("heavy")) rootCausesFound.push("Hull Fouling");
  if (sfocFinding.finding?.includes("fuel system") || sfocFinding.finding?.includes("pump")) rootCausesFound.push("Fuel System Wear");
  if (sfocFinding.finding?.includes("scavenge") || sfocFinding.finding?.includes("air deficiency")) rootCausesFound.push("Air Deficiency");
  if (sfocFinding.finding?.includes("exhaust temperatures")) rootCausesFound.push("Late Combustion");

  const savingsMetrics = [
    { label: "Extra Fuel / Day",   value: extraFuelPerDay   != null ? `${extraFuelPerDay.toFixed(2)} t`   : "N/A", sub: "vs shop trial baseline",          icon: "⛽", color: accentColor },
    { label: "Extra Fuel / Month", value: extraFuelPerMonth != null ? `${extraFuelPerMonth.toFixed(1)} t` : "N/A", sub: "recoverable if SFOC restored",     icon: "📦", color: accentColor },
    { label: "Cost Impact / Month",value: costPerMonth      != null ? `$${costPerMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "N/A", sub: `@ $${bunkerPrice}/tonne bunker`, icon: "💰", color: isRed ? "#f87171" : "#fcd34d" },
    { label: "CO₂ Excess / Month", value: co2PerMonth       != null ? `${co2PerMonth.toFixed(1)} t`       : "N/A", sub: "HFO emission factor 3.114",         icon: "🌿", color: "#86efac" },
  ];

  return (
    <div style={{ marginBottom: "24px", borderRadius: "14px", overflow: "hidden", border: `1.5px solid ${borderColor}`, backgroundColor: "#12100a", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ backgroundColor: headerBg, borderBottom: isExpanded ? `1.5px solid ${borderColor}` : "none", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
      >
        <h3 style={{ margin: 0, color: "#fff7ed", fontWeight: "800", fontSize: "1rem", display: "flex", alignItems: "center", gap: "10px" }}>
          ⚡ SFOC Analysis & Savings Impact
          <span style={{ backgroundColor: `${badgeColor}22`, color: badgeColor, fontSize: "0.7rem", fontWeight: "700", padding: "2px 10px", borderRadius: "20px", border: `1px solid ${badgeColor}55` }}>
            {sfocDev != null ? `+${sfocDev.toFixed(1)}% from baseline` : "Elevated"}
          </span>
          <span style={{ backgroundColor: "#ff8c0022", color: "#ff8c00", fontSize: "0.65rem", fontWeight: "800", padding: "2px 10px", borderRadius: "20px", border: "1px solid #ff8c0055", letterSpacing: "0.05em" }}>
            PRIORITY
          </span>
        </h3>
        <span style={{ fontSize: "1.1rem", color: accentColor, transition: "transform 0.3s ease", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▼</span>
      </div>

      {isExpanded && (
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {/* SFOC Status */}
            <div style={{ backgroundColor: "#1a1200", borderRadius: "10px", border: `1px solid ${borderColor}`, padding: "16px" }}>
              <div style={{ fontSize: "0.65rem", fontWeight: "800", color: "#92400e", textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.08em" }}>SFOC Status</div>
              <div style={{ display: "flex", gap: "24px", alignItems: "center", marginBottom: "10px" }}>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "#78716c", marginBottom: "2px" }}>Baseline (Shop)</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: "800", color: "#d6d3d1" }}>
                    {sfocBase != null ? `${sfocBase.toFixed(1)}` : "N/A"}
                    <span style={{ fontSize: "0.7rem", color: "#78716c", marginLeft: "3px" }}>g/kWh</span>
                  </div>
                </div>
                <div style={{ fontSize: "1.4rem", color: "#78716c" }}>→</div>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "#78716c", marginBottom: "2px" }}>Actual</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: "800", color: accentColor }}>
                    {sfocActual ? `${sfocActual.toFixed(1)}` : "N/A"}
                    <span style={{ fontSize: "0.7rem", color: "#78716c", marginLeft: "3px" }}>g/kWh</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "#78716c", marginBottom: "2px" }}>Deviation</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: "800", color: isRed ? "#f87171" : "#fcd34d" }}>
                    {sfocDev != null ? `+${sfocDev.toFixed(1)}%` : "N/A"}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#a8a29e", lineHeight: "1.6" }}>
                {sfocFinding.finding?.split(".")[0]}.
              </div>
            </div>

            {/* Linked Root Causes */}
            <div style={{ backgroundColor: "#0f1a10", borderRadius: "10px", border: "1px solid #14532d", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ fontSize: "0.65rem", fontWeight: "800", color: "#15803d", textTransform: "uppercase", letterSpacing: "0.08em" }}>Linked Root Causes</div>
              {rootCausesFound.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {rootCausesFound.map((rc, i) => (
                    <span key={i} style={{ backgroundColor: "#14532d44", color: "#86efac", fontSize: "0.72rem", fontWeight: "700", padding: "3px 10px", borderRadius: "20px", border: "1px solid #16a34a55" }}>
                      ↑ {rc}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>See Overall Engine Health card above for root causes.</div>
              )}
              <div style={{ marginTop: "auto", borderTop: "1px solid #14532d33", paddingTop: "10px" }}>
                <div style={{ fontSize: "0.65rem", fontWeight: "800", color: "#15803d", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                  Bunker Price (USD/tonne)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {editingPrice ? (
                    <>
                      <input
                        type="number"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        style={{ width: "80px", padding: "4px 8px", borderRadius: "6px", border: "1px solid #16a34a", backgroundColor: "#0f2a14", color: "#86efac", fontSize: "0.85rem", fontWeight: "700", outline: "none" }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = Number(priceInput);
                            if (v > 0) { setBunkerPrice(v); setPriceInput(String(v)); }
                            setEditingPrice(false);
                          }
                        }}
                      />
                      <button
                        onClick={() => { const v = Number(priceInput); if (v > 0) { setBunkerPrice(v); setPriceInput(String(v)); } setEditingPrice(false); }}
                        style={{ padding: "4px 10px", borderRadius: "6px", border: "none", backgroundColor: "#16a34a", color: "white", fontSize: "0.72rem", fontWeight: "700", cursor: "pointer" }}
                      >
                        Apply
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: "1rem", fontWeight: "800", color: "#86efac" }}>${bunkerPrice.toLocaleString()}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingPrice(true); }}
                        style={{ padding: "3px 8px", borderRadius: "5px", border: "1px solid #16a34a55", backgroundColor: "transparent", color: "#4ade80", fontSize: "0.65rem", fontWeight: "700", cursor: "pointer" }}
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Savings metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
            {savingsMetrics.map((m, i) => (
              <div key={i} style={{ backgroundColor: "#1a1000", borderRadius: "10px", border: `1px solid ${borderColor}`, padding: "14px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "1.2rem" }}>{m.icon}</div>
                <div style={{ fontSize: "0.6rem", fontWeight: "700", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</div>
                <div style={{ fontSize: "1.15rem", fontWeight: "800", color: m.color }}>{m.value}</div>
                <div style={{ fontSize: "0.62rem", color: "#57534e" }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Remedy */}
          <div style={{ backgroundColor: "#0f1e2a", borderRadius: "10px", border: "1px solid #0c4a6e", padding: "14px 16px" }}>
            <div style={{ fontSize: "0.65rem", fontWeight: "800", color: "#0284c7", textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.08em" }}>Diagnosis & Remedy</div>
            <ul style={{ margin: 0, paddingLeft: "16px", color: "#a8d8f0", fontSize: "0.85rem", fontWeight: "600", lineHeight: "1.8" }}>
              {sfocFinding.remedy
                .split(".")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .map((point, i) => <li key={i}>{point}.</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

// ── DiagnosisPanel ────────────────────────────────────────────────────────
const DiagnosisPanel = ({ report, baseline, analysisMode, availableReports }) => {
  const rawConcerns = getDetectedConcerns(report, baseline, analysisMode);

  const trendFindings =
    availableReports && availableReports.length >= 2
      ? getTrendDiagnosisFindings(availableReports, baseline, analysisMode)
      : [];

  const allRaw = [...rawConcerns, ...trendFindings];

  const isSFOC = (item) =>
    item.pattern === "SFOC_HIGH" ||
    item.parameter === "SFOC" ||
    item.parameter?.toLowerCase().includes("sfoc");

  const sfocFindings    = allRaw.filter(isSFOC);
  const nonSfocFindings = allRaw.filter((f) => !isSFOC(f));

  const verdicts = groupIntoVerdicts(nonSfocFindings);

  if (sfocFindings.length === 0 && verdicts.length === 0) {
    return (
      <div
        className="enhanced-card"
        style={{ marginBottom: "32px", borderLeft: "8px solid #16a34a", backgroundColor: "#f0fdf4", padding: "20px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "1.5rem" }}>✅</span>
          <span style={{ fontWeight: "700", color: "#166534" }}>
            No significant deviations detected. Engine parameters are within operational limits compared to shop trial baseline.
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {sfocFindings.length > 0 && (
        <SFOCInsightCard
          findings={sfocFindings}
          report={report}
          baseline={baseline}
          analysisMode={analysisMode}
        />
      )}
      {verdicts.length > 0 && (
        <OverallEngineHealthCard findings={verdicts} report={report} />
      )}
    </>
  );
};

export {
  getDetectedConcerns,
  getTrendDiagnosisFindings,
  groupIntoVerdicts,
  OverallEngineHealthCard,
  SFOCInsightCard,
  DiagnosisPanel,
  PATTERN_CONSUMES,
};

export default DiagnosisPanel;