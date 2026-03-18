
export function generateBaseline() {
  const points = [];
  for (let load = 10; load <= 100; load += 10) {
    const l = load / 100;
    points.push({
      load,
      SFOC: Math.round(200 - 40 * l + 10 * (1 - Math.cos(Math.PI * l))),
      Turbospeed: Math.round(8000 + 2000 * l),
      Pmax: Math.round(80 * l + 5),
      EngSpeed: Math.round(120 + 30 * l),
      ScavAir: Math.round(1.5 + 0.8 * l),
      "Exh_T/C_inlet": Math.round(250 + 200 * l),
      "Exh_Cylinder_outlet": Math.round(300 + 150 * l),
      "Exh_T/C_outlet": Math.round(200 + 100 * l),
      FIPI: Math.round(10 + 5 * l),
      FOC: Math.round(500 + 300 * l)
    });
  }
  return points;
}

export const fleet = [
  { id: "ATHENA", name: "MV Athena", imo: "9876543", class: "Handymax", status: "Healthy", lastReport: "2025-09-01" },
  { id: "POSEIDON", name: "MV Poseidon", imo: "9234567", class: "Panamax", status: "Watch", lastReport: "2025-09-10" },
  { id: "ODYSSEY", name: "MV Odyssey", imo: "9345678", class: "Aframax", status: "Healthy", lastReport: "2025-09-05" },
  { id: "TRIDENT", name: "MV Trident", imo: "9456789", class: "Kamsarmax", status: "Alert", lastReport: "2025-08-29" },
  { id: "NEREUS", name: "MV Nereus", imo: "9567890", class: "Suezmax", status: "Healthy", lastReport: "2025-09-02" },
  { id: "HERMES", name: "MV Hermes", imo: "9678901", class: "LR2 Tanker", status: "Healthy", lastReport: "2025-09-12" },
  { id: "APOLLO", name: "MV Apollo", imo: "9789012", class: "Capesize", status: "Watch", lastReport: "2025-09-06" },
  { id: "ZEUS", name: "MV Zeus", imo: "9890123", class: "ULCV", status: "Healthy", lastReport: "2025-09-03" },
];

export function interpolateBaseline(baseline, load, key) {
  if (load < 0 || load > 100) return null;
  const sorted = [...baseline].sort((a, b) => a.load - b.load);
  let i = 0;
  while (i < sorted.length && sorted[i].load < load) i++;
  if (i === 0) return sorted[0][key];
  if (i >= sorted.length) return sorted[sorted.length - 1][key];
  const p1 = sorted[i - 1];
  const p2 = sorted[i];
  const t = (load - p1.load) / (p2.load - p1.load);
  const v1 = p1[key];
  const v2 = p2[key];
  return v1 + (v2 - v1) * t;
}

export function getBaselineSeries(key) {
  return generateBaseline().map((p) => ({ x: p.load, y: p[key] }));
}