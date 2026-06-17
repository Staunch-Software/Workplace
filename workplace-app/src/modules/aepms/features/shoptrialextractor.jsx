import { useState, useRef } from "react";
import axiosAepms from "../api/axiosAepms";
import AppHeader from "../components/AppHeader";

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: "100vh", background: "#f1f5f9", fontFamily: "Inter, sans-serif" },
  body: { maxWidth: 720, margin: "0 auto", padding: "32px 16px 48px" },
  heading: { fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  sub: { fontSize: 13, color: "#64748b", margin: "0 0 28px" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  label: { fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 },
  input: { width: "100%", padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#0f172a", outline: "none", boxSizing: "border-box", background: "#f8fafc" },
  select: { width: "100%", padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, color: "#0f172a", outline: "none", boxSizing: "border-box", background: "#f8fafc", appearance: "none", cursor: "pointer" },
  uploadBox: (hasFile) => ({ border: `2px dashed ${hasFile ? "#0ea5e9" : "#cbd5e1"}`, borderRadius: 10, padding: "28px 20px", textAlign: "center", cursor: "pointer", background: hasFile ? "#f0f9ff" : "#f8fafc", transition: "all 0.2s", position: "relative" }),
  hint: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 14 },
  error: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14, display: "flex", gap: 8 },
  btn: (color, disabled) => ({ padding: "11px 20px", background: disabled ? "#94a3b8" : color, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", transition: "background 0.15s" }),
  resetBtn: { background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 18px", fontSize: 13, color: "#64748b", cursor: "pointer", fontFamily: "Inter, sans-serif", marginTop: 12, width: "100%" },

  // Progress overlay
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" },
  progressCard: { background: "#fff", borderRadius: 16, padding: "36px 40px", maxWidth: 420, width: "90%", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" },
  spinner: { width: 48, height: 48, border: "4px solid #e2e8f0", borderTop: "4px solid #0ea5e9", borderRadius: "50%", margin: "0 auto 20px", animation: "spin 0.9s linear infinite" },
  progressStep: (active) => ({ fontSize: 13, color: active ? "#0ea5e9" : "#94a3b8", fontWeight: active ? 700 : 400, margin: "6px 0", transition: "all 0.3s" }),

  // Modal
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.3)" },
  modalHeader: { padding: "20px 24px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: 17, fontWeight: 700, color: "#0f172a", margin: 0 },
  modalBody: { padding: "20px 24px" },
  modalFooter: { padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end", gap: 10 },
  closeBtn: { background: "none", border: "none", fontSize: 22, color: "#94a3b8", cursor: "pointer", lineHeight: 1 },

  // Table
  tableWrap: { overflowX: "auto", borderRadius: 10, border: "1px solid #e2e8f0", marginBottom: 16 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { background: "#f8fafc", padding: "10px 14px", fontWeight: 700, color: "#374151", textAlign: "left", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  td: { padding: "9px 14px", borderBottom: "1px solid #f1f5f9", color: "#0f172a", whiteSpace: "nowrap" },
  tdNull: { padding: "9px 14px", borderBottom: "1px solid #f1f5f9", color: "#cbd5e1", fontStyle: "italic" },
  editInput: { width: 80, padding: "4px 8px", border: "1px solid #0ea5e9", borderRadius: 6, fontSize: 12, textAlign: "right", outline: "none" },

  // Confidence badge
  badge: (conf) => ({ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: conf === "high" ? "#dcfce7" : conf === "medium" ? "#fef9c3" : "#fee2e2", color: conf === "high" ? "#15803d" : conf === "medium" ? "#92400e" : "#dc2626" }),

  successBanner: { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "20px 24px", textAlign: "center", marginBottom: 16 },
};

const DESIGNATION_OPTIONS = ["Aux Engine No.1", "Aux Engine No.2", "Aux Engine No.3", "Aux Engine No.4"];

const STEPS = [
  "Loading OCR engines (PaddleOCR + EasyOCR + TrOCR + Tesseract)...",
  "Preprocessing scanned PDF pages...",
  "Running ensemble OCR extraction...",
  "Training RAG with ground truth...",
  "Matching parameters via RAG...",
  "Finalising extracted values...",
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function ShopTrialExtractor() {
  const [imoNumber, setImoNumber]     = useState("");
  const [designation, setDesignation] = useState("");
  const [file, setFile]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [stepIdx, setStepIdx]         = useState(0);
  const [result, setResult]           = useState(null);  // extraction result
  const [showModal, setShowModal]     = useState(false); // preview modal
  const [editedParams, setEditedParams] = useState({});  // user-edited values
  const [syncing, setSyncing]         = useState(false);
  const [synced, setSynced]           = useState(false);
  const [error, setError]             = useState("");
  const fileInputRef = useRef();
  const stepTimer    = useRef(null);

  // ── File handler ─────────────────────────────────────────────────────────
  const handleFile = (e) => {
    const selected = e.target.files[0];
    if (selected?.name.toLowerCase().endsWith(".pdf")) {
      setFile(selected);
      setError("");
    } else {
      setError("Only PDF files are accepted.");
    }
  };

  // ── Simulate step progress ────────────────────────────────────────────────
  const startSteps = () => {
    setStepIdx(0);
    let i = 0;
    stepTimer.current = setInterval(() => {
      i++;
      if (i < STEPS.length) setStepIdx(i);
      else clearInterval(stepTimer.current);
    }, 3500);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!imoNumber.trim() || !/^\d{7}$/.test(imoNumber.trim())) { setError("Valid 7-digit IMO required."); return; }
    if (!designation)  { setError("Select a designation."); return; }
    if (!file)         { setError("Upload a PDF file."); return; }

    setLoading(true);
    setError("");
    setResult(null);
    setSynced(false);
    startSteps();

    try {
      // Call the pre-existing extraction method in your API client
      const data = await axiosAepms.extractAEShopTrialPDF(
        file,
        imoNumber.trim(),
        designation
      );

      clearInterval(stepTimer.current);
      setStepIdx(STEPS.length - 1);
      setResult(data);
      setEditedParams(JSON.parse(JSON.stringify(data.parameters || {})));
      setShowModal(true);
    } catch (err) {
      clearInterval(stepTimer.current);
      setError(err?.message || "Extraction failed.");
    } finally {
      setLoading(false);
    }
  };

  // ── Edit cell ─────────────────────────────────────────────────────────────
  const handleEdit = (param, colIdx, value) => {
    setEditedParams(prev => {
      const updated = { ...prev };
      const arr     = [...(updated[param] || [])];
      arr[colIdx]   = value === "" ? null : parseFloat(value);
      updated[param] = arr;
      return updated;
    });
  };

  // ── Sync to DB ────────────────────────────────────────────────────────────
  // ── Sync to DB ────────────────────────────────────────────────────────────
  const handleSync = async () => {
    setSyncing(true);
    setError("");
    try {
      // Call the pre-existing sync method in your API client
      await axiosAepms.syncAEShopTrial({
        generator_id : result.generator_id,
        imo_number   : result.imo_number,
        load_columns : result.load_columns,
        parameters   : editedParams,
      });
      setSynced(true);
      setShowModal(false);
    } catch (err) {
      setError(err?.message || "Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setFile(null); setResult(null); setError(""); setSynced(false);
    setImoNumber(""); setDesignation(""); setEditedParams({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <AppHeader />

      <div style={S.body}>
        <h1 style={S.heading}>Shop Trial PDF Sync</h1>
        <p style={S.sub}>Upload a shop trial PDF — our OCR + RAG engine extracts parameter values. Review then sync to database.</p>

        {/* ── Success banner ── */}
        {synced && (
          <div style={S.successBanner}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#15803d", marginBottom: 4 }}>Baseline Data Saved Successfully</div>
            <div style={{ fontSize: 13, color: "#166534" }}>Shop trial values have been synced to the database for <strong>{result?.generator_designation}</strong>.</div>
            <button style={{ ...S.resetBtn, marginTop: 16, width: "auto", padding: "8px 24px" }} onClick={handleReset}>← Upload Another PDF</button>
          </div>
        )}

        {/* ── Upload form ── */}
        {!synced && (
          <>
            <div style={S.card}>
              <p style={S.sectionTitle}>Engine Details</p>
              <div style={{ marginBottom: 16 }}>
                <label style={S.label}>IMO Number</label>
                <input style={S.input} placeholder="e.g. 9481697" value={imoNumber} maxLength={7}
                  onChange={(e) => setImoNumber(e.target.value.replace(/\D/g, ""))} />
                <span style={S.hint}>7-digit vessel IMO number</span>
              </div>
              <div>
                <label style={S.label}>Engine Designation</label>
                <select style={S.select} value={designation} onChange={(e) => setDesignation(e.target.value)}>
                  <option value="">— Select designation —</option>
                  {DESIGNATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span style={S.hint}>Must match the generator registered in the system</span>
              </div>
            </div>

            <div style={S.card}>
              <p style={S.sectionTitle}>Shop Trial PDF</p>
              <div style={S.uploadBox(!!file)} onClick={() => fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" accept=".pdf"
                  style={{ position: "absolute", opacity: 0, inset: 0, cursor: "pointer" }}
                  onChange={handleFile} />
                <span style={{ fontSize: 28, display: "block", marginBottom: 8 }}>📄</span>
                {file ? (
                  <>
                    <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>Selected file:</p>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#0ea5e9", margin: "4px 0 0" }}>{file.name}</p>
                    <p style={{ ...S.hint, marginTop: 6 }}>{(file.size / 1024).toFixed(1)} KB — click to change</p>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>Click to select a PDF file</p>
                    <p style={S.hint}>Supports scanned shop trial PDFs</p>
                  </>
                )}
              </div>
            </div>

            {error && <div style={S.error}><span>⚠️</span><span>{error}</span></div>}

            <button
              style={{ ...S.btn("#0ea5e9", loading || !file || !imoNumber || !designation), width: "100%", padding: 12 }}
              onClick={handleSubmit}
              disabled={loading || !file || !imoNumber || !designation}
            >
              {loading ? "⏳ Extracting..." : "⚙️ Extract Parameters"}
            </button>
          </>
        )}
      </div>

      {/* ── Loading overlay with steps ── */}
      {loading && (
        <div style={S.overlay}>
          <div style={S.progressCard}>
            <div style={S.spinner} />
            <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>Processing PDF...</p>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 20px" }}>This may take 2–5 minutes on first run. Please wait.</p>
            {STEPS.map((step, i) => (
              <p key={i} style={S.progressStep(i === stepIdx)}>
                {i < stepIdx ? "✓ " : i === stepIdx ? "→ " : "  "}{step}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ── Preview modal ── */}
      {showModal && result && (
        <div style={S.modalOverlay}>
          <div style={S.modal}>
            {/* Header */}
            <div style={S.modalHeader}>
              <div>
                <p style={S.modalTitle}>Review Extracted Parameters</p>
                <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
                  {result.generator_designation} &nbsp;|&nbsp; Engine: {result.engine_no} &nbsp;|&nbsp;
                  Confidence: <span style={S.badge(result.confidence)}>{result.confidence?.toUpperCase()}</span>
                </p>
              </div>
              <button style={S.closeBtn} onClick={() => setShowModal(false)}>×</button>
            </div>

            {/* Body — editable table */}
            <div style={S.modalBody}>
              <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px" }}>
                Review the extracted values below. Click any cell to edit before syncing to the database.
              </p>

              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Parameter</th>
                      {result.load_columns.map(col => (
                        <th key={col} style={{ ...S.th, textAlign: "right" }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(editedParams).map(([param, values]) => (
                      <tr key={param}>
                        <td style={{ ...S.td, fontWeight: 600, color: "#374151" }}>{param}</td>
                        {(values || []).map((val, colIdx) => (
                          <td key={colIdx} style={{ padding: "6px 14px", borderBottom: "1px solid #f1f5f9" }}>
                            <input
                              style={S.editInput}
                              type="number"
                              step="any"
                              value={val === null || val === undefined ? "" : val}
                              placeholder="—"
                              onChange={(e) => handleEdit(param, colIdx, e.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && <div style={S.error}><span>⚠️</span><span>{error}</span></div>}

              {result.confidence !== "high" && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e", marginBottom: 8 }}>
                  ⚠️ Extraction confidence is <strong>{result.confidence}</strong>. Please verify all values against the original PDF before syncing.
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={S.modalFooter}>
              <button style={S.btn("#94a3b8", false)} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={S.btn("#0ea5e9", syncing)} onClick={handleSync} disabled={syncing}>
                {syncing ? "⏳ Syncing..." : "💾 Sync to Database"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}