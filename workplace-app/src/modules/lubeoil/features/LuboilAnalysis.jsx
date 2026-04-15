import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";
import Button from "../components/ui/button";
import { useAuth } from "@/context/AuthContext";
import axiosLub from "../api/axiosLub";
import OzellarHeader from "./OzellarHeader";
import {
  Upload,
  Bell,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Filter,
  Droplet,
  Activity,
  Clock,
  AlertOctagon,
  TrendingUp,
  Calendar,
  ChevronUp,
  ChevronDown,
  History,
  MessageSquareText,
  Download,
  FileText,
  Image as ImageIcon,
  Eye,
  SendHorizontal,
  X,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "../styles/dashboard.css"; // Reusing dashboard styles
import "../styles/luboil.css"; // Specific styles for luboil page
import "../styles/luboil-responsive.css";

const OverdueVesselRow = ({
  v,
  modalType,
  onViewClick,
  amIShore,
  user,
  onUpload,
  canApprove,
  isOverdueModal,
  onVesselAction,
  canAddJustification  // 🔥 Newly added prop for workflow
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  // 🔥 NEW STATE for the chat input
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [vesselRemark, setVesselRemark] = React.useState("");

  // Check if this is the "Configured" modal to determine which layout to show
  const isConfiguredView = modalType === "Configured";

  // 🔥 MAKER-CHECKER LOGIC: Map the 2 Columns to the 3 States
  const activeItem = v.overdueItems?.find(i => i.report_overdue_remarks);
  const hasRemarks = !!activeItem?.report_overdue_remarks;
  const isAccepted = activeItem?.report_is_overdue_accepted === true;
  const isDeclined = activeItem?.report_is_overdue_accepted === false;
  // Pending means it has remarks, but hasn't been accepted or declined yet (it is null)
  const isPending = hasRemarks && activeItem?.report_is_overdue_accepted === null;

  const allRemarks = activeItem?.report_overdue_remarks || "";
  const displayRemark = allRemarks.split('\n').filter(r => r.trim()).pop() || "";

  const handleSubmitRemark = (e) => {
    e.stopPropagation(); // prevent row expansion
    if (vesselRemark.length < 5) return alert("Please enter a valid justification.");
    onVesselAction(v.imo, "SUBMIT", vesselRemark);
    setIsChatOpen(false);
    setVesselRemark("");
  };

  return (
    <div
      className="lub-list-row-container"
      style={{
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
        backgroundColor: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        transition: "all 0.2s ease",
      }}
    >
      {/* Header Area - Clickable to Toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="lub-list-row-header-left"
          style={{
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            flex: 1,
          }}
        >
          {/* Status Dot - Logic Preserved from Source */}
          <div
            className="lub-list-status-dot"
            style={{
              borderRadius: "50%",
              backgroundColor: (() => {
                if (modalType.includes("Over30")) return "#ef4444";
                if (modalType.includes("Under30")) return "#f59e0b";
                if (v.overdueItems?.some((i) => i.state === "danger"))
                  return "#ef4444";
                if (v.overdueItems?.some((i) => i.state === "warning"))
                  return "#f59e0b";
                if (v.overdueItems?.some((i) => i.state === "info"))
                  return "#3b82f6";
                return "#22c55e";
              })(),
            }}
          />
          <div>
            <div
              className="lub-list-vessel-name"
              style={{
                fontWeight: "700",
                color: "#1e293b",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span>{v.name}</span>

              {/* 🔥 NEW: "+" BUTTON TO ADD REMARK (Hidden if pending or accepted) */}
              {!isConfiguredView && !isPending && isOverdueModal && canAddJustification &&
                (!isAccepted || v.overdueItems?.some(i => !i.report_overdue_remarks)) && (
                  <button
                    className="lub-vessel-just-btn"
                    onClick={(e) => {
                      e.stopPropagation(); // prevent row expansion
                      setIsChatOpen(!isChatOpen);
                    }}
                    title={isDeclined ? "Resubmit Overdue Justification" : "Add Vessel Overdue Justification"}
                    style={{
                      backgroundColor: "#eff6ff", color: "#2563eb", border: "1px dashed #2563eb",
                      borderRadius: "50%", display: "flex",
                      alignItems: "center", justifyContent: "center", cursor: "pointer"
                    }}
                  >
                    <span className="plus-icon" >+</span>
                  </button>
                )}

              {/* 🔥 NEW: STATUS INDICATORS */}
              {isPending && (
                <span className="lub-vessel-status-badge badge-pending">⏳ PENDING APPROVAL</span>
              )}
              {isAccepted && (
                <span className="lub-vessel-status-badge badge-accepted">✅ JUSTIFICATION ACCEPTED</span>
              )}
              {isDeclined && (
                <span className="lub-vessel-status-badge badge-declined">❌ DECLINED - RESUBMIT</span>
              )}
            </div>

            <div className="lub-list-imo-text" style={{ color: "#64748b", fontFamily: "monospace" }}>
              IMO: {v.imo}
            </div>
          </div>
        </div>

        {/* ðŸ”¥ ONLY FOR CONFIGURED MODAL - UPLOAD & VIEW ICONS */}
        {isConfiguredView && (
          <div className="lub-list-icon-actions" style={{ display: "flex", alignItems: "center" }}>
            {/* 1. VIEW FILE ICON (Updated with await) */}
            {v.reportUrl ? (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  // ðŸ”¥ CRITICAL: You must await the promise to get the actual URL string
                  const signedUrl = (
                    await axiosLub.get(
                      `/api/blob/freshen-url?blob_url=${encodeURIComponent(v.reportUrl)}`,
                    )
                  ).data.signed_url;

                  if (signedUrl) {
                    window.open(signedUrl, "_blank");
                  } else {
                    alert("â Œ Could not generate secure access link.");
                  }
                }}
                className="lub-list-file-btn"
                style={{ background: "none", border: "none", color: "#10b981", cursor: "pointer", padding: 0 }}
                title="View Vessel Config Report"
              >
                <FileText size={20} />
              </button>
            ) : (
              <FileText
                size={20}
                style={{ color: "#e2e8f0" }}
                title="No report uploaded"
              />
            )}

            {/* 2. UPLOAD ICON (Only visible and usable by Shore users) */}
            {amIShore && (
              <div style={{ display: "flex", alignItems: "center" }}>
                <input
                  type="file"
                  id={`vessel-manual-up-${v.imo}`}
                  style={{ display: "none" }}
                  accept=".pdf"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) onUpload(v.name, v.imo, file);
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    document
                      .getElementById(`vessel-manual-up-${v.imo}`)
                      .click();
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#64748b",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Upload Vessel Report"
                >
                  <Upload size={18} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Right Side: Item Count and Chevron - Logic Preserved */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#64748b",
            cursor: "pointer",
          }}
        >
          {v.overdueItems?.length > 0 && (
            <span className="lub-list-count-badge" style={{ fontWeight: "600", backgroundColor: "#f1f5f9" }}>
              {v.overdueItems.length}{" "}
              {v.overdueItems.length === 1 ? "Item" : "Items"}
            </span>
          )}
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {/* 🔥 NEW: CHAT INPUT BOX FOR VESSEL JUSTIFICATION */}
      {isChatOpen && !isPending && !isAccepted && isOverdueModal && (
        <div className="lub-vessel-remark-box">
          <label className="lub-vessel-remark-label">Vessel Overdue Remarks:</label>
          <div className="lub-vessel-remark-input-row">
            <input
              type="text"
              className="lub-vessel-remark-field"
              value={vesselRemark}
              onChange={(e) => setVesselRemark(e.target.value)}
              placeholder="E.g., Vessel at anchorage awaiting fresh oil supply..."
              autoFocus
            />
            <button
              onClick={handleSubmitRemark}
              className="lub-vessel-remark-send"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* 🔥 NEW: MAKER-CHECKER SHORE APPROVAL UI */}
      {(isPending || isAccepted || isDeclined) && (
        <div className={`lub-vessel-status-box ${isAccepted ? 'status-accepted' : isDeclined ? 'status-declined' : 'status-pending'}`}>
          <p className="lub-vessel-status-quote">
            "{displayRemark}"
          </p>
          {isPending && canApprove && (
            <div className="lub-vessel-approval-actions">
              <button
                onClick={() => onVesselAction(v.imo, "ACCEPT")}
                className="lub-approval-btn btn-accept"
              >
                ACCEPT
              </button>
              <button
                onClick={() => onVesselAction(v.imo, "DECLINE")}
                className="lub-approval-btn btn-decline"
              >
                DECLINE
              </button>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Content: Overdue Machinery List - Source Preserved */}
      {isExpanded && v.overdueItems && v.overdueItems.length > 0 && (
        <div className="lub-list-expanded-content">
          <p className="lub-list-detail-label">Equipment Detail:</p>
          <div className="lub-list-equip-stack">
            {v.overdueItems.map((item, i) => (
              <div
                key={i}
                className="lub-list-equip-card"
              >
                {/* Text Content Area */}
                <div className="lub-list-equip-info">
                  <span className="lub-list-equip-name">
                    {item.fullName} {item.overdueText || ""}
                  </span>

                  {/* ðŸ”¥ ONLY SHOW REPORT DATE LINE IF NOT CONFIGURED MODAL */}
                  {!isConfiguredView && (
                    <span className="lub-list-report-date">
                      Report Date:{" "}
                      {item.reportDate
                        ? new Date(item.reportDate).toLocaleDateString(
                          "en-GB",
                          { day: "2-digit", month: "short", year: "numeric" },
                        )
                        : "N/A"}
                    </span>
                  )}
                </div>

                {/* Right Side Action/Status Area */}
                <div className="lub-list-equip-actions">
                  {isConfiguredView ? (
                    /* ðŸ”¥ REVERTED LOOK FOR CONFIGURED: JUST THE ORIGINAL LABEL */
                    <span className="lub-list-shortcode">
                      {item.shortCode}
                    </span>
                  ) : (
                    /* ðŸ”¥ NEW LOOK FOR OVERDUE/UNRESOLVED: ICON + VIEW BUTTON */
                    <>
                      <div
                        title={`Status: ${item.status || "N/A"}`}
                        className="lub-list-status-icon-wrapper"
                      >
                        <ShellStatusIcon status={item.status} size={22} />
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewClick(v.name, item);
                        }}
                        className="lub-list-view-btn"
                      >
                        <Eye size={14} /> VIEW
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
const ShellStatusIcon = ({ status, size = 20 }) => {
  const s = status?.toLowerCase() || "";

  // Color Logic: Preserving all original colors and synonyms.
  let color = "#cbd5e1";
  if (s === "normal") color = "#22c55e"; // Green
  if (s === "warning" || s === "attention") color = "#f59e0b"; // Orange
  if (s === "critical" || s === "action") color = "#ef4444"; // Red

  // Check if we are in a "Missing State"
  const isPlaceholder = s === "" || s === "none";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* 
         BASE CIRCLE: 
         - If Placeholder: Reduced radius (r=6) and no border (strokeWidth=0) to make it a small dot.
         - If Icon: Full radius (r=10) and thick border (strokeWidth=2.5).
      */}
      <circle
        cx="12"
        cy="12"
        r={isPlaceholder ? "6" : "10"}
        fill={isPlaceholder ? color : "white"}
        stroke={color}
        strokeWidth={isPlaceholder ? "0" : "2.5"}
      />

      {/* SYMBOLS: Only rendered if status is a valid alert type */}

      {/* Normal Symbol (Checkmark) */}
      {s === "normal" && (
        <path
          d="M8 12L11 15L16 9"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Warning/Attention Symbol (Exclamation) */}
      {(s === "warning" || s === "attention") && (
        <>
          <rect x="11.2" y="7" width="1.6" height="6.5" rx="0.5" fill={color} />
          <circle cx="12" cy="16.5" r="1.2" fill={color} />
        </>
      )}

      {/* Critical/Action Symbol (X-Mark) */}
      {(s === "critical" || s === "action") && (
        <path
          d="M8.5 8.5L15.5 15.5M15.5 8.5L8.5 15.5"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
};
const LuboilAnalysis = () => {
  const { user } = useAuth();
  console.log("DEBUG USER OBJECT:", user);
  const userData = user?.user || user;
  const userAccess = (
    userData?.access_type ||
    userData?.accessType ||
    ""
  ).toUpperCase();
  const userRole = (userData?.role || "").toUpperCase();

  const amIShore =
    userAccess === "SHORE" ||
    userRole === "ADMIN" ||
    userRole === "SUPERUSER" ||
    userRole === "SHORE";
  const [matrixData, setMatrixData] = useState(null);
  const [normalizedTable, setNormalizedTable] = useState({
    headers: [],
    rows: {},
  }); // <--- ADD THIS
  const hasInitiallySelected = useRef(false);
  const [loading, setLoading] = useState(true);
  const [freshGalleryUrls, setFreshGalleryUrls] = useState({});
  const [uploading, setUploading] = useState(false);
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [chatMode, setChatMode] = useState("external"); // 'external' or 'internal'
  const [internalDraft, setInternalDraft] = useState("");
  const [mentionList, setMentionList] = useState([]);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [uploadProgress, setUploadProgress] = useState({
    current: 0,
    total: 0,
    currentFile: ""
  });

  const [machineryStats, setMachineryStats] = useState({
    normal: 0,
    warning: 0,
    critical: 0,
  });
  const [overdueStats, setOverdueStats] = useState({
    configured: 0,
    overdueUnder30: 0,
    overdueOver30: 0,
  });
  const [trendModal, setTrendModal] = useState({
    isOpen: false,
    data: [],
    title: "",
  });
  // const [hiddenNotifIds, setHiddenNotifIds] = useState(() => {
  //   const saved = localStorage.getItem("hidden_notifications");
  //   return saved ? JSON.parse(saved) : [];
  // });
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [isDiagCollapsed, setIsDiagCollapsed] = useState(false);
  const [activeVesselInModal, setActiveVesselInModal] = useState(null);
  const [isReportCollapsed, setIsReportCollapsed] = useState(false);
  const [isCommCollapsed, setIsCommCollapsed] = useState(false);
  const [tableColumns, setTableColumns] = useState([]);
  const [feedReadFilter, setFeedReadFilter] = useState("ALL"); // ALL, READ, UNREAD
  const [feedVesselFilter, setFeedVesselFilter] = useState("ALL");
  const [feedFromDate, setFeedFromDate] = useState("");
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeRemarksText, setCloseRemarksText] = useState("");
  const [selectedCloseFile, setSelectedCloseFile] = useState(null);
  const [isSubmittingClose, setIsSubmittingClose] = useState(false);
  const [feedToDate, setFeedToDate] = useState("");
  // const [hiddenNotifIds, setHiddenNotifIds] = useState([]);
  const [columnLabels, setColumnLabels] = useState({});
  const [activeTab, setActiveTab] = useState("dashboard"); // or 'feed'
  const [isMachineryStatsOpen, setIsMachineryStatsOpen] = useState(false);
  const [isTableOpen, setIsTableOpen] = useState(true);
  const [selectedCell, setSelectedCell] = useState(null); // Tracks { vessel, machinery, data }
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDiagExpanded, setIsDiagExpanded] = useState(false);
  const [selectedGalleryItems, setSelectedGalleryItems] = useState([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [viewMode, setViewMode] = useState("matrix"); // 'matrix' or 'liveFeed'
  const [feedMode, setFeedMode] = useState("FLEET");
  const [feedData, setFeedData] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [footerReportVessel, setFooterReportVessel] = useState(null);
  const [selectedFooterReports, setSelectedFooterReports] = useState([]);
  const [footerReports, setFooterReports] = useState([]);
  const [isFooterLoading, setIsFooterLoading] = useState(false);
  const [isFooterDownloading, setIsFooterDownloading] = useState(false);
  const footerRef = useRef(null);
  const chatInputRef = useRef(null);
  const [feedSearch, setFeedSearch] = useState("");
  const [feedFilter, setFeedFilter] = useState("ALL");
  const [isResamplingActive, setIsResamplingActive] = useState(false);
  const [compareIds, setCompareIds] = useState([]); // Will store exactly 2 IDs
  const [selectedLubReports, setSelectedLubReports] = useState([]);
  const authToken =
    localStorage.getItem("token") || localStorage.getItem("access_token");
  const [remarksData, setRemarksData] = useState({
    officer: "",
    office: "",
    status: "",
  });
  const [existingRemarks, setExistingRemarks] = useState({
    officer: "",
    office: "",
    internal: "",
  });
  const getImageUrl = (message) => {
    if (!message) return null;
    // This regex finds the URL starting with http/https after the ATTACHED_IMAGE tag
    const match = message.match(/ATTACHED_IMAGE:\s*(https?:\/\/[^\s]+)/);
    return match ? match[1] : null;
  };
  const [showHistory, setShowHistory] = useState(false);
  const chatEndRef = useRef(null);
  const [selectedVesselName, setSelectedVesselName] = useState(null);
  const [vesselReports, setVesselReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const reportsSectionRef = useRef(null);
  const [rightPanelMode, setRightPanelMode] = useState("report");
  const [isLinkGenerated, setIsLinkGenerated] = useState(false);
  const [isActionsCollapsed, setIsActionsCollapsed] = useState(false);
  const [listModal, setListModal] = useState({
    isOpen: false,
    type: "",
    vessels: [],
  });
  const [selectedVesselsFilter, setSelectedVesselsFilter] = useState([]);
  const [isVesselDropdownOpen, setIsVesselDropdownOpen] = useState(false);
  const vesselDropdownRef = useRef(null);
  const rawJobTitle = (
    user?.job_title ||
    user?.user?.job_title ||
    ""
  ).toLowerCase().replace(/\s+/g, "");

  const isTechManager = rawJobTitle.includes("techmanager") || rawJobTitle.includes("technicalmanager");
  const isTechDirector = rawJobTitle.includes("techdirector") || rawJobTitle.includes("technicaldirector");
  const canApprove = isTechManager || isTechDirector;
  const canAddJustification =
    isTechManager ||
    isTechDirector ||
    rawJobTitle.includes("vesselmanager") ||
    rawJobTitle.includes("assistantvesselmanager") ||
    rawJobTitle.includes("assistanttechnicalmanager") ||
    userRole === "ADMIN";
  const fetchFeed = async () => {
    setFeedLoading(true);
    try {
      // You MUST pass feedMode here so the backend knows which filter to apply
      const data = (
        await axiosLub.get(`/api/luboil/live-feed?feed_mode=${feedMode}`)
      ).data;
      setFeedData(Array.isArray(data) ? data : data?.items || data?.feed || data?.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setFeedLoading(false);
    }
  };
  useEffect(() => {
    const handleClickOutsideFooter = (event) => {
      // If the popover is open AND the click is NOT inside the footerRef container
      if (
        footerReportVessel &&
        footerRef.current &&
        !footerRef.current.contains(event.target)
      ) {
        setFooterReportVessel(null);
        setSelectedFooterReports([]); // Clear selection when closing
      }
    };

    // Only add the listener if a popover is actually open
    if (footerReportVessel) {
      document.addEventListener("mousedown", handleClickOutsideFooter);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutsideFooter);
    };
  }, [footerReportVessel]);

  useEffect(() => {
    if (viewMode === "liveFeed") {
      fetchFeed();
    }
  }, [feedMode, viewMode]);

  const handleMarkAllRead = async () => {
    try {
      await axiosLub.post("/api/luboil/live-feed/read-all");
      fetchFeed();
    } catch (err) {
      console.error(err);
    }
  };
  const getPriorityColor = (priority) => {
    switch (priority?.toUpperCase()) {
      case "CRITICAL":
        return "#ef4444";
      case "WARNING":
        return "#f59e0b";
      case "SUCCESS":
        return "#22c55e";
      default:
        return "#3b82f6";
    }
  };
  const handleVesselManualReportUpload = async (vesselName, imo, file) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("imo", imo);

      // Calls the FastAPI endpoint created in Step 1
      (
        await axiosLub.post("/api/luboil/vessel/manual-upload", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        })
      ).data;

      alert(`âœ… Successfully uploaded config report for ${vesselName}`);
      loadData(); // Reload matrix to update the modal icons
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };
  const handleVesselOverdueAction = async (imo, action, remark = "") => {
    try {
      await axiosLub.post("/api/luboil/vessel/overdue-workflow", {
        imo: imo,
        action: action,
        remarks: remark
      });
      alert(action === "SUBMIT" ? "Vessel justification submitted for approval." : `Justification ${action.toLowerCase()} successfully.`);

      await loadData(); // Reload matrix to update states visually
      setListModal((prev) => ({ ...prev, isOpen: false })); // Close modal on success
    } catch (err) {
      alert("Failed to process action: " + (err.response?.data?.detail || err.message));
    }
  };

  const handleReopenIssue = async () => {
    if (
      !window.confirm(
        "Are you sure you want to REOPEN this issue? This will be logged in the Live Feed.",
      )
    )
      return;

    setIsSubmittingClose(true);
    try {
      const payload = {
        sample_id: selectedCell.data.sample_id,
        vessel_name: selectedCell.vessel,
        machinery_name: selectedCell.data.code || selectedCell.machinery,
        sample_date: selectedCell.data.last_sample,
        is_resolved: false, // Tells backend to unset resolved status
      };

      const response = (
        await axiosLub.post("/api/luboil/remarks/update", payload)
      ).data;

      // Update Modal UI state immediately to "Unlocked"
      setSelectedCell((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          is_resolved: false,
          is_approval_pending: false,
          conversation: response.updated_conversation,
        },
      }));

      // Update tracking state for current session
      setExistingRemarks((prev) => ({
        ...prev,
        office: response.updated_conversation, // Syncing to latest history
      }));

      // Refresh matrix and counters
      await loadData();
      alert("Issue has been reopened.");
    } catch (err) {
      alert("Failed to reopen: " + err.message);
    } finally {
      setIsSubmittingClose(false);
    }
  };
  const handleFooterBatchDownload = async (vesselName) => {
    if (selectedFooterReports.length === 0) return;
    setIsFooterDownloading(true);
    try {
      // Reusing your existing batch download service
      const blob = (
        await axiosLub.post(
          "/api/performance/batch-download-zip",
          {
            report_ids: selectedFooterReports,
            engine_type: "lubeOil",
          },
          { responseType: "blob" },
        )
      ).data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${vesselName}_Selected_Reports.zip`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Batch download failed:", error);
      alert("Failed to generate ZIP file.");
    } finally {
      setIsFooterDownloading(false);
    }
  };
  const handleFooterReportClick = async (vesselName, imo) => {
    if (footerReportVessel === vesselName) {
      setFooterReportVessel(null);
      return;
    }
    setFooterReportVessel(vesselName);
    setIsFooterLoading(true);
    try {
      const res = (await axiosLub.get(`/api/luboil/reports/${imo}`)).data;
      setFooterReports(res || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFooterLoading(false);
    }
  };

  const downloadSingleReport = (report) => {
    if (!report.report_url) {
      alert("No report URL available.");
      return;
    }
    window.open(report.report_url, "_blank");
  };
  const availableVessels = useMemo(() => {
    if (!normalizedTable.rows) return [];
    return Object.keys(normalizedTable.rows)
      .filter((name) => {
        // Only return vessels where at least one machinery has an actual report
        const machineries = normalizedTable.rows[name];
        return Object.values(machineries).some((m) => m.has_report === true);
      })
      .map((name) => ({
        vessel_name: name,
        imo: matrixData?.data?.[name]?.imo,
      }))
      .sort((a, b) => a.vessel_name.localeCompare(b.vessel_name));
  }, [normalizedTable.rows, matrixData]);

  // PLACE THIS NEW ONE HERE:
  useEffect(() => {
    // Only auto-select if we haven't done it yet and we have vessels
    if (availableVessels.length > 0 && !hasInitiallySelected.current) {
      const myAssignedShips = availableVessels.map((v) => v.vessel_name);
      setSelectedVesselsFilter(myAssignedShips);
      setIsTableOpen(true);

      // ðŸ”¥ Mark as done so the user can manually change things later
      hasInitiallySelected.current = true;
    }
  }, [availableVessels]); // Remove selectedVesselsFilter.length from here!
  // Add this to LuboilAnalysis.js to auto-refresh the modal content when matrix data changes
  useEffect(() => {
    if (
      listModal.isOpen &&
      listModal.type === "Configured" &&
      matrixData?.data
    ) {
      const updatedVessels = listModal.vessels.map((v) => {
        const liveData = matrixData.data[v.name];
        return {
          ...v,
          reportUrl: liveData?.vessel_report_url, // Sync the new URL into the open modal
        };
      });

      // Only update if something actually changed to prevent infinite loops
      if (
        JSON.stringify(updatedVessels) !== JSON.stringify(listModal.vessels)
      ) {
        setListModal((prev) => ({ ...prev, vessels: updatedVessels }));
      }
    }
  }, [matrixData, listModal.isOpen]);
  const uniqueFeedVessels = useMemo(() => {
    // We pull names from availableVessels (which contains every ship in your system)
    // instead of only ships currently appearing in the feed.
    const allNames = availableVessels.map((v) => v.vessel_name);

    // Prepend "ALL" for the default filter option.
    // No need to sort or use 'Set' here because availableVessels is already unique and sorted.
    return ["ALL", ...allNames];
  }, [availableVessels]);

  const handleShoreApproval = async (action) => {
    // action will be 'ACCEPT' or 'DECLINE'
    setIsSubmittingClose(true);

    try {
      const now = new Date();
      const timestamp = `${now.toLocaleDateString("en-GB", { timeZone: "UTC" })} ${now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;

      /**
       * ðŸ”¥ WORKFLOW LOGIC:
       * We only construct the final 'Closed' chat card if Shore clicks ACCEPT.
       * We pull the text from 'resolution_remarks' which the vessel submitted.
       */
      const vesselRemarks =
        selectedCell.data.resolution_remarks || "Resolution details provided.";
      const resolutionMsg = `[${timestamp}]  RESOLUTION ACCEPTED & CLOSED BY ${user.full_name}: ${vesselRemarks}`;

      const payload = {
        sample_id: selectedCell.data.sample_id,
        vessel_name: selectedCell.vessel,
        machinery_name: selectedCell.data.code || selectedCell.machinery,
        sample_date: selectedCell.data.last_sample,
        approval_action: action, // This tells the backend what to do

        // If accepting, we officially append the resolution card to the chat history
        office_remarks:
          action === "ACCEPT"
            ? existingRemarks.office
              ? existingRemarks.office + "\n" + resolutionMsg
              : resolutionMsg
            : existingRemarks.office,
        officer_remarks: existingRemarks.officer,
      };

      const response = (
        await axiosLub.post("/api/luboil/remarks/update", payload)
      ).data;

      // Update Local UI state immediately
      setSelectedCell((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          is_resolved: action === "ACCEPT",
          is_approval_pending: false,
          // Update the actual remarks strings so state remains consistent
          office_remarks: payload.office_remarks,
          conversation: response.updated_conversation,
        },
      }));

      // Update tracking state for any subsequent messages in the same session
      setExistingRemarks((prev) => ({
        ...prev,
        office: payload.office_remarks,
      }));

      loadData(); // Refresh matrix to update ticks

      const successMsg =
        action === "ACCEPT"
          ? "Resolution Accepted. Issue is now CLOSED."
          : "Resolution Declined. Issue remains OPEN for vessel action.";
      alert(successMsg);
    } catch (err) {
      alert("Action failed: " + err.message);
    } finally {
      setIsSubmittingClose(false);
    }
  };

  // Filtering logic for the feed
  const groupedFeed = useMemo(() => {
    // 1. Apply your existing filters + Updated Tab Filtering
    const filtered = (feedData || []).filter((item) => {
      // --- NEW: TAB MODE FILTERING (RECIPIENT_ID BASED) ---
      // MY_FEED: Show items where recipient_id is NOT null (these are mentions/private)
      // FLEET: Show items where recipient_id IS null (these are general fleet actions)
      const matchesTab =
        feedMode === "MY_FEED"
          ? item.recipient_id !== null
          : item.recipient_id === null;

      if (!matchesTab) return false;

      // --- EXISTING: KEYWORD SEARCH ---
      const matchesSearch =
        item.message.toLowerCase().includes(feedSearch.toLowerCase()) ||
        item.vessel_name.toLowerCase().includes(feedSearch.toLowerCase()) ||
        (item.machinery_name &&
          item.machinery_name
            .toLowerCase()
            .includes(feedSearch.toLowerCase())) ||
        (item.equipment_code &&
          item.equipment_code.toLowerCase().includes(feedSearch.toLowerCase()));

      // --- UPDATED: EVENT TYPE FILTER ---
      // In MY_FEED mode, everything is a personal alert/mention, so we skip the 'All Actions' dropdown.
      const matchesType =
        feedMode === "MY_FEED"
          ? true
          : feedFilter === "ALL" || item.event_type === feedFilter;

      // --- EXISTING: READ/UNREAD STATUS ---
      const matchesReadStatus =
        feedReadFilter === "ALL" ||
        (feedReadFilter === "READ" && item.is_read === true) ||
        (feedReadFilter === "UNREAD" && item.is_read === false);

      // --- EXISTING: VESSEL FILTER ---
      const matchesVessel =
        feedVesselFilter === "ALL" || item.vessel_name === feedVesselFilter;

      // --- EXISTING: DATE RANGE ---
      // Normalizing to midnight for accurate day comparison
      const itemDate = new Date(item.created_at).setHours(0, 0, 0, 0);
      const from = feedFromDate
        ? new Date(feedFromDate).setHours(0, 0, 0, 0)
        : null;
      const to = feedToDate ? new Date(feedToDate).setHours(0, 0, 0, 0) : null;

      let matchesDateRange = true;
      if (from && itemDate < from) matchesDateRange = false;
      if (to && itemDate > to) matchesDateRange = false;

      return (
        matchesSearch &&
        matchesType &&
        matchesReadStatus &&
        matchesVessel &&
        matchesDateRange
      );
    });

    // 2. Group by Today, Earlier, and Read
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const groups = { today: [], earlier: [], read: [] };

    filtered.forEach((item) => {
      // We use UTC conversion 'Z' to match the backend ISO format if necessary
      const itemDateOnly = new Date(item.created_at).setHours(0, 0, 0, 0);

      if (item.is_read) {
        groups.read.push(item);
      } else if (itemDateOnly === todayStart) {
        groups.today.push(item);
      } else {
        groups.earlier.push(item);
      }
    });

    // 3. Sort all groups newest first (Chronological)
    const sortByTime = (a, b) =>
      new Date(b.created_at) - new Date(a.created_at);
    groups.today.sort(sortByTime);
    groups.earlier.sort(sortByTime);
    groups.read.sort(sortByTime);

    return groups;
  }, [
    feedData,
    feedSearch,
    feedFilter,
    feedReadFilter,
    feedVesselFilter,
    feedFromDate,
    feedToDate,
    feedMode,
  ]);
  const handleResolutionSubmit = async () => {
    // 1. Basic Validation
    if (closeRemarksText.length < 50) {
      alert("Please enter at least 50 characters for the resolution remarks.");
      return;
    }

    // Prevent double submissions while processing
    setIsSubmittingClose(true);

    try {
      const now = new Date();
      const timestamp = `${now.toLocaleDateString("en-GB", { timeZone: "UTC" })} ${now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;

      // This is the formatted string for the Chat History
      const resolutionMsg = `[${timestamp}]  ISSUE CLOSED BY ${user.full_name}: ${closeRemarksText}`;

      // 2. Upload file if one was selected
      if (selectedCloseFile) {
        const formData = new FormData();
        formData.append("file", selectedCloseFile);
        formData.append("imo", selectedCell.data.imo);
        formData.append("equipment_code", selectedCell.data.code);
        formData.append("sample_date", selectedCell.data.last_sample);
        formData.append("sample_id", selectedCell.data.sample_id);
        (
          await axiosLub.post("/api/luboil/upload-attachment", formData, {
            headers: { "Content-Type": "multipart/form-data" },
          })
        ).data;
      }

      // 3. Prepare Payload
      const payload = {
        sample_id: selectedCell.data.sample_id,
        vessel_name: selectedCell.vessel,
        machinery_name: selectedCell.data.code || selectedCell.machinery,
        sample_date: selectedCell.data.last_sample,
        is_resolved: true,
        resolution_remarks: closeRemarksText,

        /**
         * ðŸ”¥ WORKFLOW LOGIC:
         * If Shore submits: Append the 'Closed' message to chat history immediately.
         * If Vessel submits: Do NOT append to chat history yet.
         * The text stays in 'resolution_remarks' for Shore to see in the amber card.
         */
        office_remarks: amIShore
          ? existingRemarks.office
            ? existingRemarks.office + "\n" + resolutionMsg
            : resolutionMsg
          : existingRemarks.office,
        officer_remarks: existingRemarks.officer, // Vessel remarks are not added to chat history until ACCEPTED
      };

      const response = (
        await axiosLub.post("/api/luboil/remarks/update", payload)
      ).data;

      // 4. Update Local UI State immediately
      setSelectedCell((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          // If user is Shore, it's CLOSED. If user is Vessel, it's PENDING APPROVAL.
          is_resolved: amIShore ? true : false,
          is_approval_pending: !amIShore ? true : false,

          resolution_remarks: closeRemarksText,
          conversation: response.updated_conversation,
        },
      }));

      // 5. UI Cleanup
      setIsCloseModalOpen(false);
      setCloseRemarksText("");
      setSelectedCloseFile(null);

      // Refresh the main list to show 'Resolved' status across the app
      await loadData();

      // Personalized alert based on role
      const successMsg = amIShore
        ? "Issue closed and verified successfully. "
        : "Resolution submitted. Awaiting Shore approval.";
      alert(successMsg);
    } catch (err) {
      console.error("Resolution Submit Error:", err);
      alert("Failed to submit resolution: " + err.message);
    } finally {
      setIsSubmittingClose(false);
    }
  };

  const handleMarkSingleRead = async (eventId) => {
    try {
      await axiosLub.patch(`/api/luboil/live-feed/${eventId}/read`);
      fetchFeed(); // Refresh the list to show it as read
    } catch (err) {
      console.error("Failed to mark as read", err);
    }
  };
  // const [hiddenNotifIds, setHiddenNotifIds] = useState([]);

  const handleHideNotification = async (id) => {
    // 1. OPTIMISTIC UPDATE: Hide it from the UI list immediately
    setNotifications((prev) => prev.filter((n) => n.id !== id));

    // 2. OPTIMISTIC UPDATE: Reduce the badge count immediately
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      // 3. Tell the backend to hide it permanently
      await axiosLub.patch(`/api/notifications/${id}/hide`);

      // 4. Background sync (just to be 100% sure)
      fetchNotifs();
    } catch (err) {
      console.error("Failed to hide notification", err);
      // If it fails, refresh to bring it back so the user isn't confused
      fetchNotifs();
    }
  };
  // --- NEW: Handle Shore Requesting Resample ---
  const handleRequestResamplingAction = async () => {
    const isShore =
      userAccess === "SHORE" ||
      userRole === "ADMIN" ||
      userRole === "SUPERUSER" ||
      userRole === "SHORE";
    if (!isShore) return;

    const isCurrentlyRequired = selectedCell.data.is_resampling_required;
    const targetState = !isCurrentlyRequired;

    const now = new Date();
    const timestamp = `${now.toLocaleDateString("en-GB", { timeZone: "UTC" })} ${now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;

    // This message triggers the Live Feed
    const systemMsg = targetState
      ? `[${timestamp}]  <b>${user.full_name}</b> Requested a MANDATORY RESAMPLE for this equipment.`
      : `[${timestamp}]  <b>${user.full_name}</b> Cancelled the mandatory resampling request.`;

    try {
      const payload = {
        vessel_name: selectedCell.vessel,
        sample_id: selectedCell.data.sample_id,
        machinery_name: selectedCell.machinery,
        sample_date: selectedCell.data.last_sample,
        status_change_msg: systemMsg,
        is_resampling_required: targetState,
      };

      const response = (
        await axiosLub.post("/api/luboil/remarks/update", payload)
      ).data;

      // Update Modal UI state
      setSelectedCell((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          is_resampling_required: targetState,
          conversation: response.updated_conversation || prev.data.conversation,
        },
      }));

      // Surgical update to background Matrix
      setNormalizedTable((prev) => {
        const updatedRows = { ...prev.rows };
        const vName = selectedCell.vessel;
        const mCode = selectedCell.data.code;
        if (updatedRows[vName]?.[mCode]) {
          updatedRows[vName][mCode] = {
            ...updatedRows[vName][mCode],
            is_resampling_required: targetState,
            conversation:
              response.updated_conversation ||
              updatedRows[vName][mCode].conversation,
          };
        }
        return { ...prev, rows: updatedRows };
      });

      setRightPanelMode("history");
      setShowHistory(true);
      loadData();
    } catch (err) {
      alert("Failed to update resampling requirement.");
    }
  };
  // Deep navigation handler
  const handleFeedItemClick = async (event) => {
    // Handle vessel-wide overdue events (no specific equipment_code)
    if (!event.equipment_code || event.machinery_name === "Vessel-Wide") {
      // Just open the overdue modal for this vessel instead
      if (matrixData?.data) {
        const vesselEntry = Object.entries(matrixData.data).find(
          ([, vData]) => String(vData.imo) === String(event.imo)
        );
        if (vesselEntry) {
          handleCardClick("CriticalOver30"); // or "WarningUnder30" based on priority
        }
      }
      return;
    }

    const vesselName = Object.keys(normalizedTable.rows).find(
      (name) =>
        String(normalizedTable.rows[name][event.equipment_code]?.imo) ===
        String(event.imo),
    );

    if (vesselName) {
      const cell = normalizedTable.rows[vesselName][event.equipment_code];
      const specificSample =
        cell.history.find((h) => h.sample_id === event.sample_id) ||
        cell.history[0];

      handleSelectSample(vesselName, cell, specificSample);
      if (
        event.event_type === "MENTION" ||
        event.event_type === "COMMUNICATION"
      ) {
        setRightPanelMode("history");
        setShowHistory(true);
      }
    }
  };
  const handleSelectSample = (vesselName, cellData, specificSample) => {
    // 1. Reset Chat Modes & Drafts (Preserving your existing logic)
    setChatMode("external");
    setInternalDraft("");
    setIsDiagCollapsed(false);
    setIsReportCollapsed(false);
    setIsCommCollapsed(false);
    setIsActionsCollapsed(false);

    /**
     * ðŸ”¥ SYNC INPUT BOXES
     * This is the fix for the "Empty Box" issue. We must update the "memory"
     * of the remarks state to match the specific strings found in this dot's row.
     */
    setExistingRemarks({
      officer: specificSample.officer_remarks || "",
      office: specificSample.office_remarks || "",
      internal: specificSample.internal_remarks || "",
    });

    /**
     * ðŸ”¥ UNIQUE CONVERSATION BUILDER
     * This logic ignores the shared "cellData.conversation" and instead
     * builds a list specifically from the remarks found in this dot's row.
     */
    const buildSampleSpecificConversation = (s) => {
      const list = [];
      const uniqueTracker = new Set(); // Prevents duplicate messages from appearing

      // ðŸ”¥ HELPER: Standardizes DD/MM/YYYY to YYYY-MM-DD for perfect sorting
      const getSortableDate = (dateStr) => {
        if (!dateStr || dateStr === "Unknown") return "0000-00-00";
        const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)/);
        if (match) {
          return `${match[3]}-${match[2]}-${match[1]}${match[4]}`;
        }
        return dateStr;
      };

      const extractMessages = (rawText, role, isInternal = false) => {
        if (!rawText) return;
        rawText.split("\n").forEach((line) => {
          const clean = line.trim();
          if (!clean) return;

          let msgText = clean;
          let msgDate = s.date || s.sample_date || "Unknown";

          // Regex to extract [DD/MM/YYYY HH:MM] from the start of the line
          const match = clean.match(/^\[(.*?)\]\s*(.*)/);
          if (match) {
            msgDate = match[1];
            msgText = match[2];
          }

          // Create a unique key to prevent duplicate entries
          const key = `${msgDate}|${role}|${msgText}|${isInternal}`;
          if (!uniqueTracker.has(key)) {
            uniqueTracker.add(key);
            list.push({
              date: msgDate,
              sortDate: getSortableDate(msgDate), // Used only for the .sort() below
              role: role,
              message: msgText,
              is_internal: isInternal,
            });
          }
        });
      };

      // 1. Extracting specifically from THIS dot's data fields
      extractMessages(s.officer_remarks, "Vessel");
      extractMessages(s.office_remarks, "Office");
      extractMessages(s.internal_remarks, "Office", true);
      extractMessages(s.status_change_log, "System");

      // 2. ðŸ”¥ ISOLATE ATTACHMENTS (Images/PDFs) specifically for this dot
      if (s.attachment_url) {
        const files = s.attachment_url.split("|").filter(f => f && f.trim());
        files.forEach((fileUrl) => {
          if (!fileUrl) return;

          // Clean URL check for file type (ignores SAS tokens)
          const isPdf = fileUrl.toLowerCase().split("?")[0].endsWith(".pdf");
          const prefix = isPdf ? "ATTACHED_PDF" : "ATTACHED_IMAGE";

          // Identify the uploader from status log (Bold name logic)
          const uploaderMatch = s.status_change_log?.match(
            /\] (?:<b>)?(.*?)(?:<\/b>)?\s+has successfully uploaded/,
          );
          const uploaderName = uploaderMatch ? uploaderMatch[1] : "System";
          const uploadTime = s.date || s.sample_date || "Unknown";

          // Construct message so UI Regex match(/\] (.*?):/) picks it up
          const formattedMessage = `[${uploadTime}] ${uploaderName}: ${prefix}: ${fileUrl}`;

          const key = `file|${fileUrl}`;
          if (!uniqueTracker.has(key)) {
            uniqueTracker.add(key);
            list.push({
              date: uploadTime,
              sortDate: getSortableDate(uploadTime),
              role: "System",
              message: formattedMessage,
              is_internal: false,
            });
          }
        });
      }

      // 3. Sort messages chronologically using the sortDate helper
      return list.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
    };

    // 2. Generate the unique targeted conversation for this dot
    const specificConversation =
      buildSampleSpecificConversation(specificSample);

    // 3. UI Navigation Logic
    const hasPriorComm = specificConversation.length > 0;

    if (hasPriorComm) {
      setRightPanelMode("report"); // Default to Lab Diagnosis
      setShowHistory(true); // Open chat panel
    } else {
      setRightPanelMode("report");
      setShowHistory(false); // Close chat panel if dot is new
    }

    // 4. Update the Selected Cell with specific TECHNICAL and CHAT data
    setSelectedCell({
      vessel: vesselName,
      machinery: cellData.raw_machinery_name,
      data: {
        ...cellData, // Keep IMO, Vessel Name, etc.
        ...specificSample,
        diagnosis: specificSample.diagnosis || null,
        summary_error: specificSample.summary_error || null,
        pdf_page_index: specificSample.pdf_page_index,
        report_url: specificSample.report_url || cellData.report_url,
        is_image_required: specificSample.is_image_required || false,
        is_resolved: specificSample.is_resolved || false,
        attachment_url: specificSample.attachment_url || "", // Tech results (Iron, Water, Status, Diagnosis)
        conversation: specificConversation, // ðŸ”¥ The separate chat history for this dot
        // Store siblings for the Switcher logic
        allSamplesAtDate: cellData.history.filter(
          (h) => h.date === (specificSample.date || specificSample.sample_date),
        ),
      },
    });

    // 5. Open Modal
    setIsModalOpen(true);
  };
  useEffect(() => {
    const handleClickOutside = (event) => {
      // If the dropdown is open and we click outside the container, close it
      if (
        showNotifDropdown &&
        notifRef.current &&
        !notifRef.current.contains(event.target)
      ) {
        setShowNotifDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNotifDropdown]); // Re-run when dropdown state changes
  // 1. Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        vesselDropdownRef.current &&
        !vesselDropdownRef.current.contains(event.target)
      ) {
        setIsVesselDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const handleOpenTrend = async (vesselName, imo, code, description) => {
    setLoadingTrend(true);
    setTrendModal({
      isOpen: true,
      data: [],
      title: `${vesselName} - ${description}`,
    });
    try {
      const response = await axiosLub.get(
        `/api/v1/luboil/trend/${imo}/${code}`,
      );
      const rawData = response.data || [];

      const processedData = rawData.map((item) => {
        const dateObj = new Date(item.date);
        return {
          ...item,
          // Numeric timestamp for vertical stacking
          timestamp: dateObj.getTime(),
          // Readable string for the Tooltip (e.g., "25 Oct 2025")
          dateLabel: item.date,
          viscosity_40c: parseFloat(item.viscosity_40c) || 0,
          iron: parseFloat(item.iron) || 0,
          water: parseFloat(item.water) || 0,
          tan: parseFloat(item.tan) || 0,
          tbn: parseFloat(item.tbn) || 0,
          copper: parseFloat(item.copper) || 0,
          aluminium: parseFloat(item.aluminium) || 0,
          sodium: parseFloat(item.sodium) || 0,
          silicon: parseFloat(item.silicon) || 0,
          calcium: parseFloat(item.calcium) || 0,
          magnesium: parseFloat(item.magnesium) || 0,
          zinc: parseFloat(item.zinc) || 0,
        };
      });

      processedData.sort((a, b) => a.timestamp - b.timestamp);
      setTrendModal((prev) => ({ ...prev, data: processedData }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTrend(false);
    }
  };
  const handleTextareaChange = async (val) => {
    // Determine which buffer to update
    if (chatMode === "internal") {
      setInternalDraft(val);
    } else {
      const isShore = user?.role === "SHORE" || user?.role === "ADMIN";
      setRemarksData((prev) => ({
        ...prev,
        [isShore ? "office" : "officer"]: val,
      }));
    }

    // Mention Logic
    const lastChar = val.slice(-1);
    const words = val.split(/\s/);
    const lastWord = words[words.length - 1];

    if (lastWord.startsWith("@")) {
      const query = lastWord.slice(1);
      setMentionFilter(query);

      // Fetch if not already fetched or if list is empty
      try {
        const users = (
          await axiosLub.get(
            `/api/luboil/mentions/${selectedCell.data.imo}?chat_mode=${chatMode}`,
          )
        ).data;
        setMentionList(Array.isArray(users) ? users : []);
        setShowMentionDropdown(true);
      } catch (err) {
        console.error("Mention fetch failed", err);
      }
    } else {
      setShowMentionDropdown(false);
    }
  };
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef(null);
  //   useEffect(() => {
  //   localStorage.setItem("hidden_notifications", JSON.stringify(hiddenNotifIds));
  // }, [hiddenNotifIds]);

  // 1. Fetch from Backend
  const fetchNotifs = async () => {
    try {
      const data = (await axiosLub.get("/api/notifications")).data;
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch (err) {
      console.error("Notif fetch failed", err);
    }
  };

  // 2. Set up Polling (Live updates)
  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 45000); // 45 seconds
    return () => clearInterval(interval);
  }, []);

  // 3. Handle Notification Click (Redirection + Auto-Open Modal)
  // 3. Handle Notification Click (Redirection + Auto-Open Modal)
  const handleNotifClick = async (n) => {
    if (!n || !normalizedTable?.rows) return; // Safety check: exit if data isn't ready

    await axiosLub.patch(`/api/notifications/${n.id}/read`);
    setShowNotifDropdown(false);
    fetchNotifs();

    // Logic to find the vessel/machinery in your current table
    // Added extra safety checks [name] and [n.equipment_code]
    const vesselName = Object.keys(normalizedTable.rows).find((name) => {
      const vesselRow = normalizedTable.rows[name];
      // Ensure the vessel exists and has this specific machinery before checking IMO
      return (
        vesselRow && String(vesselRow[n.equipment_code]?.imo) === String(n.imo)
      );
    });

    if (vesselName && normalizedTable.rows[vesselName][n.equipment_code]) {
      const cell = normalizedTable.rows[vesselName][n.equipment_code];

      // Find the specific sample if available, else default to latest
      const specificSample =
        cell.history?.find((h) => h.sample_id === n.sample_id) ||
        cell.history?.[0] ||
        cell;

      // Use your existing select sample logic to trigger the modal correctly
      handleSelectSample(vesselName, cell, specificSample);

      setRightPanelMode("history"); // Take them straight to the chat
      setShowHistory(true);
      setIsModalOpen(true);
    } else {
      console.warn(
        "Could not find matching vessel/machinery in the current matrix for this notification.",
      );
    }
  };
  const selectUser = (userName) => {
    const currentDraft =
      chatMode === "internal"
        ? internalDraft
        : amIShore
          ? remarksData.office
          : remarksData.officer;
    const words = currentDraft.split(/\s/);
    words[words.length - 1] = `@${userName} `; // Replace @query with @FullName
    const newText = words.join(" ");

    if (chatMode === "internal") {
      setInternalDraft(newText);
    } else {
      setRemarksData((prev) => ({
        ...prev,
        [amIShore ? "office" : "officer"]: newText,
      }));
    }
    setShowMentionDropdown(false);
  };
  const formatDiagnosisAsList = (text) => {
    if (!text) return null;

    // This Regex looks for markers like (a), (b), (c) or a), b), c)
    // It splits the text but keeps the markers
    const parts = text.split(/(?=\([a-z]\))/g);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {parts.map((part, index) => {
          const trimmedPart = part.trim();
          if (!trimmedPart) return null;

          // If it starts with a marker like (a), render as a list item
          if (/^\([a-z]\)/.test(trimmedPart)) {
            return (
              <div
                key={index}
                style={{ display: "flex", gap: "12px", paddingLeft: "10px" }}
              >
                <span
                  style={{
                    color: "#2563eb",
                    fontWeight: "bold",
                    minWidth: "20px",
                  }}
                ></span>
                <span style={{ color: "#475569", lineHeight: "1.6" }}>
                  {trimmedPart}
                </span>
              </div>
            );
          }

          // Otherwise render as a normal introductory paragraph
          return (
            <p
              key={index}
              style={{
                margin: 0,
                fontWeight: "500",
                color: "#1e293b",
                marginBottom: "8px",
              }}
            >
              {trimmedPart}
            </p>
          );
        })}
      </div>
    );
  };
  const handleBulkDelete = async () => {
    if (selectedGalleryItems.length === 0) return;

    if (
      !window.confirm(
        `Are you sure you want to delete ${selectedGalleryItems.length} item(s)?`,
      )
    )
      return;

    const now = new Date();
    const timestamp = `${now.toLocaleDateString("en-GB", { timeZone: "UTC" })} ${now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;

    // ðŸ”¥ CRITICAL: Backend uses this message to trigger the Live Feed "Evidence Deleted" event
    const deleteSysMsg = `[${timestamp}] <b>${user.full_name}</b> has deleted ${selectedGalleryItems.length} piece(s) of evidence.`;

    // 1. Get current raw paths from the database
    let currentAttachments = selectedCell.data.attachment_url || "";
    let attachmentArray = currentAttachments
      .split("|")
      .filter((url) => url !== "");

    // 2. Identify the raw paths to delete by stripping the SAS tokens
    const rawPathsToDelete = selectedGalleryItems.map((item) => {
      return item.url.split("?")[0];
    });

    // 3. Filter: Keep only the files NOT in our delete list
    const updatedArray = attachmentArray.filter((dbPath) => {
      return !rawPathsToDelete.some((toDelete) => toDelete.includes(dbPath));
    });

    const finalAttachmentString = updatedArray.join("|");

    try {
      const response = (
        await axiosLub.post("/api/luboil/remarks/update", {
          sample_id: selectedCell.data.sample_id, // ðŸ”¥ Targeted ID prevents "Meshing" error
          vessel_name: selectedCell.vessel,
          machinery_name: selectedCell.data.code || selectedCell.machinery,
          sample_date: selectedCell.data.last_sample,
          attachment_url: finalAttachmentString,
          status_change_msg: deleteSysMsg,
        })
      ).data;

      // 4. Update the Active Modal View (Communication Window)
      setSelectedCell((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          attachment_url: finalAttachmentString,
          conversation: response.updated_conversation,
        },
      }));

      // 5. ðŸ”¥ SURGICAL FIX: Update the Background Matrix (normalizedTable)
      // This ensures that if you click another dot and return, the deleted evidence stays gone.
      setNormalizedTable((prev) => {
        const updatedRows = { ...prev.rows };
        const vessel = selectedCell.vessel;
        const machineryCode = selectedCell.data.code;

        if (updatedRows[vessel] && updatedRows[vessel][machineryCode]) {
          const targetCell = updatedRows[vessel][machineryCode];

          // Update the specific sample inside the history array for this equipment
          if (targetCell.history) {
            targetCell.history = targetCell.history.map((h) => {
              if (h.sample_id === selectedCell.data.sample_id) {
                return {
                  ...h,
                  attachment_url: finalAttachmentString,
                };
              }
              return h;
            });
          }

          // If the dot we are editing is currently the "Latest" one displayed on the matrix
          if (targetCell.sample_id === selectedCell.data.sample_id) {
            targetCell.attachment_url = finalAttachmentString;
            targetCell.conversation = response.updated_conversation;
          }
        }
        return { ...prev, rows: updatedRows };
      });

      // 6. UI Cleanup
      setPreviewImage(null);
      setSelectedGalleryItems([]);

      // Optional: Full refresh to sync all counters (like Machinery Stats)
      loadData();

      alert("âœ… Evidence deleted successfully.");
    } catch (err) {
      console.error("Delete failed", err);
      alert("Failed to delete items.");
    }
  };

  const handleLubBatchDownload = async () => {
    if (selectedLubReports.length === 0) return;
    setIsDownloading(true);
    try {
      // Calling the API service (make sure 'lubeOil' case is added to your backend api.py)
      const blob = (
        await axiosLub.post(
          "/api/performance/batch-download-zip",
          {
            report_ids: selectedLubReports,
            engine_type: "lubeOil",
          },
          { responseType: "blob" },
        )
      ).data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `${selectedVesselName}_Lube_Reports_${new Date().getTime()}.zip`,
      );
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (error) {
      console.error("Batch download failed:", error);
      alert("Failed to generate ZIP file.");
    } finally {
      setIsDownloading(false);
    }
  };
  // 1. Shore Requesting Image
  const handleRequestImageAction = async () => {
    const isShore =
      user?.role === "SHORE" ||
      user?.role === "ADMIN" ||
      user?.role === "SUPERUSER";
    if (!isShore) return;

    // 1. Determine current state and target state (Undo/Toggle logic)
    const isCurrentlyRequired = selectedCell.data.is_image_required;
    const targetState = !isCurrentlyRequired;

    const now = new Date();
    const timestamp = `${now.toLocaleDateString("en-GB", { timeZone: "UTC" })} ${now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;

    // 2. Dynamic message based on whether we are enabling or disabling
    const systemMsg = targetState
      ? `[${timestamp}]  <b>${user.full_name}</b> Made the image/file mandatory.`
      : `[${timestamp}]  <b>${user.full_name}</b> Made the image/file optional(no need)`;

    try {
      const payload = {
        vessel_name: selectedCell.vessel,
        sample_id: selectedCell.data.sample_id,
        machinery_name: selectedCell.machinery,
        sample_date: selectedCell.data.last_sample,
        sample_number: selectedCell.data.sample_number,
        status_change_msg: systemMsg,
        is_image_required: targetState, // Changed from hardcoded 'true' to targetState
      };

      // Send to Backend
      const response = (
        await axiosLub.post("/api/luboil/remarks/update", payload)
      ).data;

      // 2. UPDATE MODAL STATE (Immediate visual change)
      setSelectedCell((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          is_image_required: targetState,
          conversation: response.updated_conversation || prev.data.conversation,
        },
      }));

      // 3. ðŸ”¥ CRITICAL FIX PRESERVED: UPDATE THE BACKGROUND MATRIX STATE
      setNormalizedTable((prev) => {
        const updatedRows = { ...prev.rows };
        const vesselName = selectedCell.vessel;
        const machineryCode = selectedCell.data.code;

        if (updatedRows[vesselName] && updatedRows[vesselName][machineryCode]) {
          updatedRows[vesselName][machineryCode] = {
            ...updatedRows[vesselName][machineryCode],
            is_image_required: targetState,
            // Sync the conversation history to the background table too
            conversation:
              response.updated_conversation ||
              updatedRows[vesselName][machineryCode].conversation,
          };
        }
        return { ...prev, rows: updatedRows };
      });

      // 4. UI Navigation
      setRightPanelMode("history");
      setShowHistory(true);

      // 5. Final sync with server
      loadData();
    } catch (err) {
      console.error("Request failed:", err);
      alert("Failed to update requirement.");
    }
  };

  const handleSidebarUpload = async (file) => {
    if (!file) return;

    if (file.size > 1024 * 1024) {
      alert("âŒ File too large. Maximum allowed size is 1MB.");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("imo", selectedCell.data.imo);
      formData.append("equipment_code", selectedCell.data.code);
      formData.append("sample_date", selectedCell.data.last_sample);
      formData.append("sample_id", selectedCell.data.sample_id);

      // 1. Upload the physical file to storage
      // This backend call stores the URL in the 'attachment_url' column automatically
      const uploadData = (
        await axiosLub.post("/api/luboil/upload-attachment", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        })
      ).data;

      const now = new Date();
      const timestamp = `${now.toLocaleDateString("en-GB", { timeZone: "UTC" })} ${now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;

      // This remains to show in the system log WHO uploaded the image
      const systemUploadMsg = `[${timestamp}] <b>${user.full_name}</b> has successfully uploaded the Image/File.`;

      // 2. Update the Database record
      const response = (
        await axiosLub.post("/api/luboil/remarks/update", {
          vessel_name: selectedCell.vessel,
          machinery_name: selectedCell.machinery,
          sample_date: selectedCell.data.last_sample,
          sample_id: selectedCell.data.sample_id,
          sample_number: selectedCell.data.sample_number,
          status_change_msg: systemUploadMsg,
          // is_image_required: false,

          // âœ… UPDATED: We no longer append the 'ATTACHED_IMAGE' string here.
          // We simply pass the existing remarks history so they remain unchanged.
          office_remarks: existingRemarks.office,
          officer_remarks: existingRemarks.officer,
          internal_remarks: existingRemarks.internal,
        })
      ).data;

      // 3. UPDATE MODAL STATE IMMEDIATELY
      setSelectedCell((prev) => {
        const existingUrls = prev.data.attachment_url
          ? prev.data.attachment_url.split('|').filter(Boolean)
          : [];
        const rawNewUrl = uploadData.url ? uploadData.url.split('?')[0] : '';
        const updatedAttachmentUrl = rawNewUrl
          ? [...existingUrls, rawNewUrl].join('|')
          : prev.data.attachment_url;

        return {
          ...prev,
          data: {
            ...prev.data,
            attachment_url: updatedAttachmentUrl,
            conversation: response.updated_conversation || prev.data.conversation,
          },
        };
      });

      // 4. ðŸ”¥ SURGICAL FIX: Update the background table state immediately
      setNormalizedTable((prev) => {
        const updatedRows = { ...prev.rows };
        const vName = selectedCell.vessel;
        const mCode = selectedCell.data.code;

        if (updatedRows[vName] && updatedRows[vName][mCode]) {
          updatedRows[vName][mCode] = {
            ...updatedRows[vName][mCode],
            // is_image_required: false,
            conversation:
              response.updated_conversation ||
              updatedRows[vName][mCode].conversation,
          };
        }
        return { ...prev, rows: updatedRows };
      });

      // 5. Sync with server for total accuracy
      loadData();
      alert("âœ… Evidence uploaded successfully.");
    } catch (err) {
      console.error("Upload failed", err);
      alert("Upload failed.");
    }
  };

  const handleSendMessage = async () => {
    // 1. Robust User Identification (The "Seenu" Fix preserved)
    const userData = user?.user || user;
    const userAccess = (userData?.role || "").toUpperCase();
    const userRole = (userData?.role || "").toUpperCase();
    const currentUserName = userData?.full_name || "User";

    // Identify if the sender is Shore staff
    const isShore =
      userAccess === "SHORE" ||
      userRole === "ADMIN" ||
      userRole === "SUPERUSER" ||
      userRole === "SHORE" ||
      userRole === "SUPERINTENDENT";

    // 2. Select the correct input buffer based on mode and identified role
    let currentInput = "";
    if (chatMode === "internal") {
      currentInput = internalDraft;
    } else {
      currentInput = isShore ? remarksData.office : remarksData.officer;
    }

    // Validation: Don't send empty messages
    if (!currentInput || !currentInput.trim()) return;

    try {
      // 3. Generate standard timestamp [DD/MM/YYYY HH:MM]
      const now = new Date();
      const timestamp = `${now.toLocaleDateString("en-GB", { timeZone: "UTC" })} ${now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;

      // 4. Prepare updated remark strings
      // Using existingRemarks ensures we append to the history of the SPECIFIC dot selected
      let updatedOfficerRemarks = existingRemarks.officer || "";
      let updatedOfficeRemarks = existingRemarks.office || "";
      let updatedInternalRemarks = existingRemarks.internal || "";

      const messageLine = `[${timestamp}] ${currentUserName}: ${currentInput}`;

      if (chatMode === "internal") {
        updatedInternalRemarks +=
          (updatedInternalRemarks ? "\n" : "") + messageLine;
      } else if (isShore) {
        updatedOfficeRemarks +=
          (updatedOfficeRemarks ? "\n" : "") + messageLine;
      } else {
        updatedOfficerRemarks +=
          (updatedOfficerRemarks ? "\n" : "") + messageLine;
      }

      // 5. Construct Payload for the Backend
      const payload = {
        vessel_name: selectedCell.vessel,
        machinery_name: selectedCell.machinery,
        sample_date: selectedCell.data.last_sample,
        sample_number: selectedCell.data.sample_number,
        sample_id: selectedCell.data.sample_id, // This is crucial for your isolated backend logic
        officer_remarks: updatedOfficerRemarks,
        office_remarks: updatedOfficeRemarks,
        internal_remarks: updatedInternalRemarks,
        status: remarksData.status,
        user_name: currentUserName,
      };

      // 6. Call API
      const response = (
        await axiosLub.post("/api/luboil/remarks/update", payload)
      ).data;

      // 7. SYNC ALL STATES IMMEDIATELY (Fixes the "Meshing" and "Not Showing" bugs)
      if (response.updated_conversation) {
        // A. Update the Modal Window (Immediate Visual Feedback)
        setSelectedCell((prev) => ({
          ...prev,
          data: {
            ...prev.data,
            conversation: response.updated_conversation,
            officer_remarks: updatedOfficerRemarks,
            office_remarks: updatedOfficeRemarks,
            internal_remarks: updatedInternalRemarks,
          },
        }));

        // B. SURGICAL FIX: Update the background table (normalizedTable)
        // This prevents Dot 1 from seeing Dot 2's data when clicking between them
        setNormalizedTable((prev) => {
          const newRows = { ...prev.rows };
          const vessel = selectedCell.vessel;
          const machinery = selectedCell.machinery;

          if (newRows[vessel] && newRows[vessel][machinery]) {
            const targetCell = newRows[vessel][machinery];

            // Update the remarks in the history array for this specific sample_id
            if (targetCell.history) {
              targetCell.history = targetCell.history.map((h) => {
                if (h.sample_id === selectedCell.data.sample_id) {
                  return {
                    ...h,
                    officer_remarks: updatedOfficerRemarks,
                    office_remarks: updatedOfficeRemarks,
                    internal_remarks: updatedInternalRemarks,
                  };
                }
                return h;
              });
            }

            // If the dot we just updated is the "Latest" one, update the cell-level strings too
            if (targetCell.sample_id === selectedCell.data.sample_id) {
              targetCell.officer_remarks = updatedOfficerRemarks;
              targetCell.office_remarks = updatedOfficeRemarks;
              targetCell.internal_remarks = updatedInternalRemarks;
              targetCell.conversation = response.updated_conversation;
            }
          }
          return { ...prev, rows: newRows };
        });

        // C. Update tracking state for next message
        setExistingRemarks({
          officer: updatedOfficerRemarks,
          office: updatedOfficeRemarks,
          internal: updatedInternalRemarks,
        });
      }

      // 8. Clear input buffers
      if (chatMode === "internal") {
        setInternalDraft("");
      } else {
        setRemarksData((prev) => ({
          ...prev,
          officer: "",
          office: "",
        }));
      }

      // 9. Final refresh to sync everything with the backend
      loadData();
    } catch (error) {
      console.error("Luboil Chat Send Error:", error);
      alert(
        "âŒ Failed to send: " + (error.response?.data?.detail || error.message),
      );
    }
  };
  // 2. Logic to extract unique vessels from your data

  const filteredVessels = useMemo(() => {
    const allNames = availableVessels.map((v) => v.vessel_name);
    // If no filter selected, show all vessels that have rows in the table
    return selectedVesselsFilter.length > 0 ? selectedVesselsFilter : allNames;
  }, [availableVessels, selectedVesselsFilter]);

  // 3. Selection Handlers
  const handleVesselToggle = (vesselName) => {
    setSelectedVesselsFilter((prev) => {
      if (prev.includes(vesselName)) {
        return prev.filter((v) => v !== vesselName);
      } else {
        return [...prev, vesselName];
      }
    });
  };

  const handleSelectAllVessels = () => {
    // Use .every() to check if everything is already selected
    const allSelected = availableVessels.every((v) =>
      selectedVesselsFilter.includes(v.vessel_name),
    );

    if (allSelected) {
      // If all are on, turn them all off
      setSelectedVesselsFilter([]);
    } else {
      // If some/none are on, turn them all on
      setSelectedVesselsFilter(availableVessels.map((v) => v.vessel_name));
    }
  };
  // Add this effect to lock background scroll when any modal is open
  useEffect(() => {
    const isAnyModalOpen = isModalOpen || listModal.isOpen || trendModal.isOpen;

    if (isAnyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    // Cleanup: ensure scroll is restored if the component is unmounted
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isModalOpen, listModal.isOpen, trendModal.isOpen]);
  useEffect(() => {
    if (selectedCell && selectedCell.data) {
      const data = selectedCell.data;

      // 1. Reset input buffers for the new selection
      setRemarksData({
        officer: "",
        office: "",
        status: data.status || "Normal",
      });

      // 2. Extract all three types of remarks
      // This ensures we have a reference to append new messages to
      const rawOfficer =
        data.officer_remarks || (data.remarks && data.remarks.officer) || "";
      const rawOffice =
        data.office_remarks || (data.remarks && data.remarks.office) || "";

      // ðŸ”¥ NEW: Handle Internal Remarks
      const rawInternal =
        data.internal_remarks || (data.remarks && data.remarks.internal) || "";

      // 3. Update the tracking state
      setExistingRemarks({
        officer: rawOfficer,
        office: rawOffice,
        internal: rawInternal, // Store the private notes history
      });

      // 4. Default to External Chat every time a new machinery is clicked
      // setChatMode("external");
      // setInternalDraft("");
      setShowMentionDropdown(false);
      setMentionFilter("");
    }
  }, [selectedCell]);
  useEffect(() => {
    if (showHistory && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [showHistory, selectedCell]);
  useEffect(() => {
    if (selectedVesselName && reportsSectionRef.current) {
      reportsSectionRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [selectedVesselName]);
  useEffect(() => {
    const fetchAllVesselUsers = async () => {
      if (selectedCell?.data?.imo) {
        try {
          // ðŸ”¥ CHANGE: Fetch BOTH lists so all names are recognized for highlighting
          const [extUsers, intUsers] = await Promise.all([
            axiosLub
              .get(
                `/api/luboil/mentions/${selectedCell.data.imo}?chat_mode=external`,
              )
              .then((r) => r.data),
            axiosLub
              .get(
                `/api/luboil/mentions/${selectedCell.data.imo}?chat_mode=internal`,
              )
              .then((r) => r.data),
          ]);

          // Merge them and remove duplicates
          const combined = [...(extUsers || []), ...(intUsers || [])].reduce(
            (acc, current) => {
              const x = acc.find((item) => item.name === current.name);
              if (!x) return acc.concat([current]);
              else return acc;
            },
            [],
          );

          setMentionList(combined);
        } catch (err) {
          console.error("Highlighting list fetch failed", err);
        }
      }
    };
    fetchAllVesselUsers();
  }, [selectedCell]);

  const calculateMachineryStats = (data) => {
    if (!data || !data.data) return;

    const today = new Date();
    let vNormal = 0,
      vWarning = 0,
      vCritical = 0;
    let mNormal = 0,
      mWarning = 0,
      mCritical = 0;
    let totalConfigured = 0;  // 🔥 RENAME THIS
    let configuredVesselCount = 0;
    // --- COUNTERS ---
    // let totalConfigured = Object.keys(data.data).length;
    let ovUnder30Count = 0;
    let ovOver30Count = 0;
    let pendingUnresolvedCount = 0; // Tracks vessels needing attention (Action/Approval/Resample)

    Object.values(data.data).forEach((vessel) => {
      let vesselHasReport = false;
      let vesselWorstStatus = "Normal";
      let vesselIsOverdueUnder30 = false;
      let vesselIsOverdueOver30 = false;
      let vesselHasActiveIssue = false; // Flag to see if vessel has pending actions

      const hasConfiguredMachinery = Object.values(vessel.machineries || {}).some(m => m.is_configured === true);
      if (hasConfiguredMachinery) {
        configuredVesselCount++; // Only increment if configured
      }

      Object.values(vessel.machineries || {}).forEach((m) => {
        if (!m.is_configured) return;

        // --- UPDATED ACTION-BASED LOGIC ---
        // If it's resolved, it's NO LONGER an active issue.
        if (m.has_report && !m.is_resolved) {
          const isPendingApproval = m.is_approval_pending === true;
          const isResamplingRequired = m.is_resampling_required === true;
          const isBadStatus =
            m.status &&
            m.status.toLowerCase() !== "normal" &&
            m.status.toLowerCase() !== "none";

          // UPDATE: Vessel is flagged ONLY if the status is Warning or Critical (isBadStatus).
          // This ensures that "Normal" status items do not trigger the "Active Issue" counter
          // even if they are pending approval or resampling.
          if (isBadStatus) {
            vesselHasActiveIssue = true;
          }
        }

        // --- EXISTING HEALTH & OVERDUE LOGIC (Time Based - PRESERVED) ---
        if (!m.has_report || !m.last_sample) return;
        vesselHasReport = true;

        const intervalMonths =
          typeof m.interval === "number" && m.interval > 0 ? m.interval : 3;
        const sampleDate = new Date(m.last_sample);
        const dueDate = new Date(sampleDate);
        dueDate.setMonth(dueDate.getMonth() + intervalMonths);
        const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));

        // Health Logic
        if (daysOverdue > 30) {
          mCritical++;
          vesselWorstStatus = "Critical";
        } else if (daysOverdue > 0) {
          mWarning++;
          if (vesselWorstStatus !== "Critical") vesselWorstStatus = "Warning";
        } else {
          mNormal++;
        }

        // Overdue Logic
        if (daysOverdue > 30) vesselIsOverdueOver30 = true;
        else if (daysOverdue > 0) vesselIsOverdueUnder30 = true;
      });

      // Vessel Level Health Updates (Preserved)
      if (vesselHasReport) {
        if (vesselWorstStatus === "Critical") vCritical++;
        else if (vesselWorstStatus === "Warning") vWarning++;
        else vNormal++;
      }

      // Vessel Level Overdue Updates (Preserved)
      if (vesselIsOverdueOver30) ovOver30Count++;
      else if (vesselIsOverdueUnder30) ovUnder30Count++;

      // Vessel Level Pending/Unresolved Updates (Action Card)
      if (vesselHasActiveIssue) {
        pendingUnresolvedCount++;
      }
    });

    // Update all states
    setStats({ normal: vNormal, warning: vWarning, critical: vCritical });
    setMachineryStats({
      normal: mNormal,
      warning: mWarning,
      critical: mCritical,
    });
    setOverdueStats({
      configured: configuredVesselCount,
      pendingUnresolved: pendingUnresolvedCount, // Updated for new UI card
      overdueUnder30: ovUnder30Count,
      overdueOver30: ovOver30Count
    });
  };

  // ... existing imports

  const GridStatusIcon = ({ color, bgColor = "transparent", size = 16 }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color} // The lines represent the CURRENT status (e.g., Normal/Green)
      strokeWidth="2" // Made slightly thicker for better visibility against colored bg
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        backgroundColor: bgColor, // The background represents the PREVIOUS status (e.g., Critical/Red)
        borderRadius: "50%",
        padding: "2px", // Add padding so the grid doesn't touch the edges of the background
      }}
    >
      {/* Outer Circle */}
      <circle cx="12" cy="12" r="10" />

      {/* Vertical Grid Lines */}
      <path d="M12 2v20" />
      <path d="M7 3.5v17" />
      <path d="M17 3.5v17" />

      {/* Horizontal Grid Lines */}
      <path d="M2 12h20" />
      <path d="M3.5 7h17" />
      <path d="M3.5 17h17" />
    </svg>
  );
  const getShortName = (name) => {
    if (!name) return "";
    const n = name.toUpperCase();

    if (n.includes("AUX") && n.includes("NO.1")) return "AE #1";
    if (n.includes("AUX") && n.includes("NO.2")) return "AE #2";
    if (n.includes("AUX") && n.includes("NO.3")) return "AE #3";
    if (n.includes("AUX") && n.includes("ENGINE")) return "AE"; // Fallback for generic AE
    if (n.includes("MAIN") && n.includes("SYSTEM")) return "ME Sys";
    if (n.includes("MAIN") && n.includes("NO.1")) return "ME #1";
    if (n.includes("MAIN") && n.includes("NO.2")) return "ME #2";
    if (n.includes("HATCH")) return "Hatch";
    if (n.includes("STEERING")) return "Steering";
    if (n.includes("STERN") && n.includes("AFT")) return "Stern Aft";
    if (n.includes("STERN") && n.includes("FWD")) return "Stern Fwd";
    if (n.includes("STERN")) return "Stern Tube";
    if (n.includes("WINDLASS") && n.includes("FWD")) return "Winch Fwd";
    if (n.includes("WINDLASS") && n.includes("AFT")) return "Winch Aft";
    if (n.includes("REMOTE")) return "RC Valve";
    if (n.includes("STEERING")) return "Str. Gear";
    if (n.includes("DECK") && n.includes("CRANE")) return "D.Crane";
    if (n.includes("PROVISION") && n.includes("CRANE")) return "Prov.Crane";
    if (n.includes("CARGO") && n.includes("PUMP")) return "COP";
    if (n.includes("HOSE") && n.includes("CRANE")) return "Hose Crane";
    if (n.includes("WINDLASS") || n.includes("WINCH")) {
      if (n.includes("FWD")) return "Winch FWD";
      if (n.includes("AFT")) return "Winch AFT";
      return "Winch";
    }

    // If no match, just take the first 3 letters of the first 2 words
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w.substring(0, 4))
      .join(" ");
  };

  const processTableData = (data) => {
    if (!data || !data.data) return;
    const headers = new Set();
    const rows = {};

    Object.entries(data.data).forEach(([vessel, vData]) => {
      rows[vessel] = {};
      if (vData.machineries) {
        Object.entries(vData.machineries).forEach(([rawName, mData]) => {
          const cleanName = rawName;
          headers.add(cleanName);

          // 1. Prepare History
          const currentHistoryItem = {
            date: mData.last_sample,
            status: mData.status,
          };
          const inboundHistory =
            Array.isArray(mData.history) && mData.history.length > 0
              ? mData.history
              : [currentHistoryItem];

          // 2. Prepare Conversation Logic
          // ðŸ”¥ FIX: Trust the backend conversation first (it contains the evidence/images)
          // Only run manual extraction if the backend conversation is empty
          let conversationList = mData.conversation || [];

          if (conversationList.length === 0) {
            const uniqueTracker = new Set();
            const extract_messages = (raw_text, role, default_date) => {
              if (!raw_text) return;
              const lines = raw_text.split("\n");
              for (const line of lines) {
                const clean = line.trim();
                if (!clean) continue;

                let msg_date_str = default_date || "1970-01-01 00:00";
                let msg_text = clean;
                const match = clean.match(/^\[(.*?)\]\s*(.*)/);

                if (match) {
                  const [_, datePart, textPart] = match;
                  msg_text = textPart;
                  try {
                    const [dPart, tPart] = datePart.split(" ");
                    const [day, month, year] = dPart.split("/");
                    msg_date_str = `${year}-${month}-${day} ${tPart || "00:00"}`;
                  } catch (e) {
                    msg_date_str = datePart;
                  }
                }

                const uniqueKey = `${msg_date_str}|${role}|${msg_text}`;
                if (!uniqueTracker.has(uniqueKey)) {
                  uniqueTracker.add(uniqueKey);
                  conversationList.push({
                    date: msg_date_str,
                    role: role,
                    message: msg_text,
                  });
                }
              }
            };

            const officerText =
              mData.officer_remarks || (mData.remarks && mData.remarks.officer);
            const officeText =
              mData.office_remarks || (mData.remarks && mData.remarks.office);
            extract_messages(officerText, "Vessel", mData.last_sample);
            extract_messages(officeText, "Office", mData.last_sample);
            extract_messages(
              mData.status_change_log,
              "System",
              mData.last_sample,
            );
            conversationList.sort((a, b) => a.date.localeCompare(b.date));
          }

          // 3. Extract Previous Status from Change Log (Keep existing logic)
          let previousStatus = null;
          if (mData.status_change_log) {
            const matches = [
              ...mData.status_change_log.matchAll(
                /from\s+(\w+)\s+to\s+(\w+)/gi,
              ),
            ];
            if (matches.length > 0) {
              const lastMatch = matches[matches.length - 1];
              const oldVal = lastMatch[1];
              const newVal = lastMatch[2];
              if (
                oldVal &&
                newVal &&
                oldVal.toLowerCase() !== newVal.toLowerCase()
              ) {
                previousStatus = oldVal;
              }
            }
          }

          // 4. Merge/Create Entry
          const entryData = {
            ...mData,
            raw_machinery_name: rawName,
            conversation: conversationList,
            report_url: mData.report_url,
            previous_status: previousStatus,
            diagnosis: mData.diagnosis || mData.lab_diagnosis,
            imo: String(vData.imo ?? ""),
          };

          if (rows[vessel][cleanName]) {
            const existingEntry = rows[vessel][cleanName];
            const mergedHistory = [
              ...(existingEntry.history || []),
              ...inboundHistory,
            ];

            // Merge existing conversation with new data, maintaining uniqueness
            const mergedConversation = [
              ...(existingEntry.conversation || []),
              ...conversationList,
            ]
              .filter(
                (v, i, a) =>
                  a.findIndex(
                    (t) => t.date === v.date && t.message === v.message,
                  ) === i,
              )
              .sort((a, b) => a.date.localeCompare(b.date));

            const existingDate = new Date(
              existingEntry.last_sample?.replace(/-/g, "/"),
            );
            const newDate = new Date(mData.last_sample?.replace(/-/g, "/"));

            if (newDate >= existingDate) {
              rows[vessel][cleanName] = {
                ...entryData,
                history: mergedHistory,
                conversation: mergedConversation,
              };
            } else {
              rows[vessel][cleanName].history = mergedHistory;
              rows[vessel][cleanName].conversation = mergedConversation;
            }
          } else {
            rows[vessel][cleanName] = {
              ...entryData,
              history: inboundHistory,
              conversation: conversationList, // Ensure initial entry has the evidence
            };
          }
        });
      }
    });

    setNormalizedTable({ headers: Array.from(headers).sort(), rows: rows });
  };
  const handleCardClick = (statusType) => {
    if (!matrixData || !matrixData.data) return;

    const today = new Date();
    const matchingVessels = [];

    Object.entries(matrixData.data).forEach(([vesselName, vesselData]) => {
      // --- CASE 1: Configured Vessels ---
      if (statusType === "Configured") {
        const configuredItems = Object.values(vesselData.machineries || {})
          .filter((m) => m.is_configured)
          .map((m) => ({
            fullName: m.description || m.code,
            shortCode: m.analyst_code || m.code,
          }));

        if (configuredItems.length > 0) {
          matchingVessels.push({
            name: vesselName,
            imo: vesselData.imo || "N/A",
            reportUrl: vesselData.vessel_report_url,
            overdueItems: configuredItems,
          });
        }
        // matchingVessels.push({
        //   name: vesselName,
        //   imo: vesselData.imo || "N/A",
        //   reportUrl: vesselData.vessel_report_url,
        //   overdueItems: Object.values(vesselData.machineries || {})
        //     .filter((m) => m.is_configured)
        //     .map((m) => ({
        //       fullName: m.description || m.code,
        //       shortCode: m.analyst_code || m.code,
        //     })),
        // });
        return;
      }

      // --- CASE 2: Pending / Unresolved ---
      if (statusType === "PendingUnresolved") {
        const items = Object.values(vesselData.machineries || {})
          .filter((m) => {
            const hasReport = m.has_report === true;
            const isNotResolved = !m.is_resolved;
            const isBadStatus =
              m.status?.toLowerCase() !== "normal" &&
              m.status?.toLowerCase() !== "none";

            // UPDATE: isBadStatus is now mandatory (using && instead of || for that group)
            // This ensures Normal items are excluded even if they are pending approval.
            return hasReport && isNotResolved && isBadStatus;
          })
          .map((m) => {
            // Logic for dot priority (We keep this so you don't lose the color coding)
            let state = "danger";
            if (m.is_approval_pending) state = "warning";
            else if (m.is_resampling_required) state = "info";

            return {
              fullName: m.description || m.code,
              code: m.code,
              reportDate: m.report_date,
              status: m.status,
              rawData: m,
              state: state,
            };
          });

        if (items.length > 0) {
          matchingVessels.push({
            name: vesselName,
            imo: vesselData.imo || "N/A",
            overdueItems: items,
          });
        }
        return;
      }

      // --- CASE 3: Overdue and Health Status Cards ---
      let vesselWorstHealthStatus = "Normal";
      let vesselMatchedOverdueItems = [];
      let hasReport = false;
      let vesselIsOverdueOver30 = false;
      let vesselIsOverdueUnder30 = false;

      Object.values(vesselData.machineries || {}).forEach((m) => {
        if (!m.is_configured || !m.has_report || !m.last_sample) return;
        hasReport = true;

        const interval =
          typeof m.interval === "number" && m.interval > 0 ? m.interval : 3;
        const sampleDate = new Date(m.last_sample);
        const dueDate = new Date(sampleDate);
        dueDate.setMonth(dueDate.getMonth() + interval);
        const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));

        // 1. Health Status Logic
        if (daysOverdue > 30) {
          vesselWorstHealthStatus = "Critical";
        } else if (daysOverdue > 0 && vesselWorstHealthStatus !== "Critical") {
          vesselWorstHealthStatus = "Warning";
        }

        // 2. Overdue Logic
        const itemData = {
          fullName: m.description || m.code,
          code: m.code,
          status: m.status,
          reportDate: m.report_date,
          rawData: m,
          overdueText: `(Overdue by ${daysOverdue} days)`,
          state: daysOverdue > 30 ? "danger" : "warning",
          // 🔥 ADDED THESE TWO LINES
          report_overdue_remarks: m.report_overdue_remarks,
          report_is_overdue_accepted: m.report_is_overdue_accepted
        };

        if (daysOverdue > 30) {
          vesselIsOverdueOver30 = true;
          if (statusType === "CriticalOver30" || statusType === "WarningUnder30") {
            vesselMatchedOverdueItems.push(itemData);
          }
        } else if (daysOverdue > 0) {
          vesselIsOverdueUnder30 = true;
          if (statusType === "WarningUnder30") {
            vesselMatchedOverdueItems.push(itemData);
          }
        }
      });

      // Matching Logic for Overdue/Health Status
      if (hasReport) {
        if (statusType === "CriticalOver30" && vesselIsOverdueOver30) {
          matchingVessels.push({
            name: vesselName,
            imo: vesselData.imo || "N/A",
            overdueItems: vesselMatchedOverdueItems,
          });
        } else if (statusType === "WarningUnder30" && vesselIsOverdueUnder30 && !vesselIsOverdueOver30) {
          matchingVessels.push({
            name: vesselName,
            imo: vesselData.imo || "N/A",
            overdueItems: vesselMatchedOverdueItems,
          });
        } else if (vesselWorstHealthStatus === statusType && !["WarningUnder30", "CriticalOver30"].includes(statusType)) {
          matchingVessels.push({
            name: vesselName,
            imo: vesselData.imo || "N/A",
            overdueItems: [],
          });
        }
      }
    });

    // Alphabetical sort preserved
    matchingVessels.sort((a, b) => a.name.localeCompare(b.name));

    let modalTitle = statusType;
    if (statusType === "WarningUnder30") modalTitle = "Overdue < 30 Days";
    if (statusType === "CriticalOver30") modalTitle = "Overdue > 30 Days";
    if (statusType === "PendingUnresolved")
      modalTitle = "Pending Unresolved Cases";

    setListModal({
      isOpen: true,
      type: modalTitle,
      vessels: matchingVessels,
    });
  };
  const loadData = async () => {
    setLoading(true);
    try {
      const res = (await axiosLub.get("/api/v1/fleet/luboil-overview")).data;

      // 1. Store the Matrix Data directly
      setMatrixData(res);

      // 2. Store the Master Column List from Backend
      setTableColumns(res.columns || []);
      setColumnLabels(res.column_labels || {});
      processTableData(res);
      // 3. Calculate Stats (using the new logic below)
      calculateMachineryStats(res);
    } catch (err) {
      console.error("Failed to load luboil data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFileUpload = async (e) => {
    // 1. Convert FileList to an Array
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: files.length, currentFile: "" });

    // 2. Initialize tracking for the summary report
    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    let detailedSummary = [];

    try {
      // 3. Process files sequentially using for...of
      // This ensures we don't overwhelm the parser and processed data is saved correctly
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // 🔥 Live progress update
        setUploadProgress({
          current: i + 1,
          total: files.length,
          currentFile: file.name,
        });

        try {
          const res = (
            await axiosLub.post(
              "/api/upload-luboil-report/",
              (() => {
                const fd = new FormData();
                fd.append("file", file);
                return fd;
              })(),
              { headers: { "Content-Type": "multipart/form-data" } },
            )
          ).data;

          if (res.is_duplicate) {
            duplicateCount++;
          } else {
            successCount++;
          }

          // 4. Preserve all original data points for the summary
          detailedSummary.push({
            status: res.is_duplicate ? "dup" : "new",
            filename: file.name,
            vessel: res.vessel,
            date: res.report_date,
            summary: res.alert_summary,
            count: res.sample_count,
          });

        } catch (fileError) {
          errorCount++;
          detailedSummary.push({
            status: "error",
            filename: file.name,
            error: fileError.message,
          });
        }

        // 🔥 300ms delay between files prevents DB race condition
        if (i < files.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      // 5. Reset progress
      setUploadProgress({ current: 0, total: 0, currentFile: "" });

      // 6. Show styled result modal instead of plain alert
      const newItems = detailedSummary.filter((d) => d.status === "new");
      const dupItems = detailedSummary.filter((d) => d.status === "dup");
      const errItems = detailedSummary.filter((d) => d.status === "error");

      const buildSection = (items, label, icon) => {
        if (items.length === 0) return "";
        return (
          `\n${icon} ${label} (${items.length})\n` +
          "─".repeat(40) + "\n" +
          items.map((d) =>
            d.status === "error"
              ? `  • ${d.filename}\n    ❗ ${d.error}`
              : `  • ${d.vessel} — ${d.date}\n    ${d.summary} | ${d.count} machineries\n    File: ${d.filename}`
          ).join("\n\n")
        );
      };

      const finalReport =
        `╔══════════════════════════════════════╗\n` +
        `       BULK UPLOAD COMPLETE            \n` +
        `╚══════════════════════════════════════╝\n\n` +
        `  📁 Total Files   : ${files.length}\n` +
        `  ✅ New Reports   : ${successCount}\n` +
        `  ⚠️  Duplicates   : ${duplicateCount}\n` +
        `  ❌ Failed        : ${errorCount}\n` +
        `\n` +
        buildSection(newItems, "NEW REPORTS PROCESSED", "✅") +
        buildSection(dupItems, "DUPLICATE REPORTS (UPDATED)", "⚠️") +
        buildSection(errItems, "FAILED UPLOADS", "❌");

      alert(finalReport);

      // 7. Refresh the Matrix
      loadData();

    } catch (globalError) {
      console.error("Bulk Upload Error:", globalError);
      alert("❌ A critical error occurred during bulk processing.");
    } finally {
      setUploading(false);
      setUploadProgress({ current: 0, total: 0, currentFile: "" });
      // 8. Reset the input so the user can upload the same files again if needed
      e.target.value = null;
    }
  };

  // Helper for Status Icons/Colors
  const getStatusBadge = (status) => {
    const s = status.toLowerCase();
    if (s === "normal")
      return (
        <span className="status-badge status-success">
          <CheckCircle size={14} /> Normal
        </span>
      );
    if (s === "warning" || s === "attention")
      return (
        <span className="status-badge status-warning">
          <AlertTriangle size={14} /> Warning
        </span>
      );
    if (s === "critical" || s === "action")
      return (
        <span className="status-badge status-error">
          <AlertCircle size={14} /> Critical
        </span>
      );
    return <span className="status-badge status-default">{status}</span>;
  };
  // 1. Add this state for counters
  const [stats, setStats] = useState({ normal: 0, warning: 0, critical: 0 });

  // 2. Add this calculation function
  const calculateFleetStats = (data) => {
    if (!data || !data.data) return;
    let normal = 0,
      warning = 0,
      critical = 0;
    const today = new Date();

    Object.values(data.data).forEach((vessel) => {
      const dates = Object.values(vessel.machineries || {})
        .map((m) => m.last_sample)
        .filter((d) => d && d !== "-" && d !== "N/A")
        .map((d) => new Date(d.replace(/-/g, "/")));

      if (dates.length > 0) {
        const latestDate = new Date(Math.max(...dates));
        const diffTime = Math.abs(today - latestDate);
        const daysElapsed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysElapsed <= 60) normal++;
        else if (daysElapsed > 60 && daysElapsed <= 90) warning++;
        else critical++;
      } else {
        critical++;
      }
    });
    setStats({ normal, warning, critical });
  };

  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const totalEquipment =
    machineryStats.normal + machineryStats.warning + machineryStats.critical;
  const getPercentage = (value) => {
    return totalEquipment > 0 ? (value / totalEquipment) * 100 : 0;
  };
  // Helper to get color code based on status string
  const getStatusColor = (status) => {
    const s = status ? status.toLowerCase() : "";
    if (s === "normal") return "#22c55e"; // Green
    if (s === "warning" || s === "attention") return "#eab308"; // Yellow
    if (s === "critical" || s === "action") return "#ef4444"; // Red
    return "#cbd5e1"; // Grey (No Data)
  };
  const filterDistinctReports = (history) => {
    if (!history || !Array.isArray(history)) return [];

    // Sort Descending (Newest -> Oldest)
    // We simply sort and return all history items without filtering by day interval
    const sorted = [...history].sort((a, b) => {
      // Handle both date formats if necessary
      const dateA = new Date(a.date || a.sample_date);
      const dateB = new Date(b.date || b.sample_date);
      return dateB - dateA;
    });

    return sorted;
  };
  const getStatusLightColor = (status) => {
    const s = status ? status.toLowerCase() : "";
    if (s === "critical" || s === "action") return "#ef4444"; // Light Red
    if (s === "warning" || s === "attention") return "#eab308"; // Light Yellow
    if (s === "normal") return "#dcfce7"; // Light Green
    return "transparent";
  };
  // --- REPLACE YOUR EXISTING StatusDots WITH THIS ---
  // Add Machinery info and onChartClick callback to props
  const StatusDots = ({
    history,
    hasLatestRemarks,
    previousStatus,
    onChartClick,
    onSampleClick,
    hasReport,
    dueText,
    daysOverdue = 0,
    openUpward,
  }) => {
    // --- STATE FOR DROPDOWN ---
    const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event) => {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(event.target)
        ) {
          setShowHistoryDropdown(false);
        }
      };
      if (showHistoryDropdown) {
        document.addEventListener("mousedown", handleClickOutside);
      }
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [showHistoryDropdown]);

    const safeHistory = history && Array.isArray(history) ? history : [];

    // 1. Sort history: Newest -> Oldest
    const sortedHistory = [...safeHistory].sort((a, b) => {
      const dateA = new Date(a.date || a.sample_date);
      const dateB = new Date(b.date || b.sample_date);
      return dateB - dateA;
    });

    // 2. logic change: Identify ONLY the latest unique report date
    const latestDate =
      sortedHistory.length > 0
        ? sortedHistory[0].date || sortedHistory[0].sample_date
        : null;

    return (
      <div className="lub-status-dots-container">
        {/* --- LINE 1: STATUS ICONS + ACTION BUTTONS (SINGLE LINE) --- */}
        <div className="lub-status-row-one">
          {/* Status Dots Section */}
          <div className="lub-status-dots-group">
            {latestDate ? (
              sortedHistory
                .filter((h) => (h.date || h.sample_date) === latestDate)
                .map((sample, sampleIdx) => {
                  const hasNotes =
                    sample.officer_remarks?.trim() ||
                    sample.office_remarks?.trim() ||
                    sample.internal_remarks?.trim();
                  const hasEvidence =
                    sample.attachment_url &&
                    sample.attachment_url.trim() !== "";
                  const isMandatory = sample.is_image_required === true;
                  const statusChangeDetected =
                    sample.previous_status ||
                    (sampleIdx === 0 && previousStatus);

                  let dotTooltip = `Date: ${sample.date || sample.sample_date}`;
                  if (sample.sample_number)
                    dotTooltip =
                      `Sample: ${sample.sample_number}\n` + dotTooltip;

                  if (
                    hasNotes ||
                    hasEvidence ||
                    isMandatory ||
                    statusChangeDetected
                  ) {
                    dotTooltip += `\n Contains Activity:`;
                    if (hasNotes) dotTooltip += `\n - Communication Notes`;
                    if (hasEvidence) dotTooltip += `\n - Attached Evidence`;
                    if (isMandatory) dotTooltip += `\n - Image Upload Required`;
                    if (statusChangeDetected)
                      dotTooltip += `\n - Status changed from: ${sample.previous_status || previousStatus}`;
                  }

                  return (
                    <div
                      key={`${sample.sample_id || latestDate}-${sampleIdx}`}
                      title={dotTooltip}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSampleClick) onSampleClick(sample);
                      }}
                      className="lub-dot-item"
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.transform = "scale(1.15)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.transform = "scale(1)")
                      }
                    >
                      {/* ðŸ”¥ INCREASED SIZE TO 24 */}
                      <ShellStatusIcon status={sample?.status} size={22} />
                    </div>
                  );
                })
            ) : (
              <ShellStatusIcon status="none" size={22} />
            )}
          </div>

          {/* Action Buttons Section (MOVED TO LINE 1) */}
          {hasReport && (
            <div className="lub-status-actions-group">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onChartClick) onChartClick();
                }}
                className="lub-status-action-btn"
                title="View Trend Graph"
              >
                <TrendingUp size={14} />
              </button>

              <div ref={dropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowHistoryDropdown(!showHistoryDropdown);
                  }}
                  className={`lub-status-action-btn ${showHistoryDropdown ? 'btn-active' : ''}`}
                  title="View Historical Report List"
                >
                  <FileText size={14} />
                </button>

                {showHistoryDropdown && (
                  <div className={`lub-status-history-popover ${openUpward ? 'pop-up' : 'pop-down'}`}>
                    <div className="popover-header">AVAILABLE REPORTS</div>
                    {sortedHistory
                      .filter((h) => (h.date || h.sample_date) !== latestDate)
                      .map((h, i) => (
                        <div
                          key={h.sample_id || i}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowHistoryDropdown(false);
                            onSampleClick(h);
                          }}
                          className="popover-item"
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = "#f1f5f9")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = "white")
                          }
                        >
                          <ShellStatusIcon status={h.status} size={16} />
                          <span
                            className="popover-date-text"
                          >
                            {new Date(
                              h.date || h.sample_date,
                            ).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      ))}

                    {sortedHistory.filter(
                      (h) => (h.date || h.sample_date) !== latestDate,
                    ).length === 0 && (
                        <div className="lub-status-history-empty">
                          No previous reports found
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* --- LINE 2: DUE DATE BADGE (ISOLATED BOTTOM) --- */}
        <span className={`lub-status-due-badge ${daysOverdue > 30 ? 'overdue-critical' : daysOverdue > 0 ? 'overdue-warning' : 'overdue-normal'}`}>
          {daysOverdue > 30 ? "⚠ " : daysOverdue > 0 ? "⚠ " : ""}Due: {dueText}
        </span>
      </div>
    );
  };
  const handleVesselClick = async (vesselName, imoNumber) => {
    if (!imoNumber) return alert("IMO Number not found.");

    // Close if clicking the same vessel again
    if (selectedVesselName === vesselName) {
      setSelectedVesselName(null);
      setVesselReports([]);
      return;
    }

    setSelectedVesselName(vesselName);
    setLoadingReports(true);
    setVesselReports([]); // Reset previous data

    try {
      // Calls the new backend endpoint: /api/luboil/reports/{imo}
      const res = (await axiosLub.get(`/api/luboil/reports/${imo}`)).data;
      setVesselReports(res || []);
    } catch (error) {
      console.error("Failed to fetch reports:", error);
    } finally {
      setLoadingReports(false);
    }
  };
  // --- LOGIC FOR RESOLUTION GATING ---
  const isVesselUser = !amIShore;
  const currentSampleDate = new Date(
    selectedCell?.data?.date || selectedCell?.data?.sample_date,
  );

  // BUG FIX: Check if image exists in gallery (attachment_url) OR newly selected in modal
  const evidenceExistsInGallery =
    selectedCell?.data?.attachment_url &&
    selectedCell.data.attachment_url.trim().length > 0;
  const imageRequirementMet =
    !selectedCell?.data?.is_image_required ||
    evidenceExistsInGallery ||
    selectedCloseFile;

  // RESAMPLING CHECK: Scans equipment history for a report date newer than the current one
  const hasNewerReport = selectedCell?.data?.history?.some(
    (h) => new Date(h.date) > currentSampleDate,
  );
  const resamplingRequirementMet =
    !selectedCell?.data?.is_resampling_required || hasNewerReport;

  // Final State
  const canVesselSubmit = imageRequirementMet && resamplingRequirementMet;
  const isCloseSubmitDisabled =
    isSubmittingClose ||
    (closeRemarksText?.length || 0) < 50 ||
    (isVesselUser && !canVesselSubmit);

  return (
    <div
      className="dashboard-container-enhanced"
      style={{ paddingTop: "72px" }}
    >
      {/* <PerformanceNav /> */}
      <OzellarHeader
        unreadCount={unreadCount}
        notifications={notifications}
        showNotifDropdown={showNotifDropdown}
        notifRef={notifRef}
        onBellClick={() => setShowNotifDropdown(!showNotifDropdown)}
        onNotifClick={handleNotifClick}
        onHideNotification={handleHideNotification}
        viewMode={viewMode}
        onFeedClick={() => {
          if (viewMode === "matrix") {
            fetchFeed();
            setViewMode("liveFeed");
          } else {
            setViewMode("matrix");
          }
        }}
        user={user}
        onRegisterVessel={() => alert("Register Vessel coming soon")}
      />
      {viewMode === "matrix" && (
        <div
          className="section-header-enhanced"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px", // Added slight margin for better layout
            flexShrink: 0,
          }}
        >
          {/* LEFT SIDE: Title and Subtitle */}
          <div>
            <h1
              className="section-title-main"
              style={{ fontSize: "1.25rem", margin: 0, lineHeight: "1.2" }}
            >
              Lube Oil Analysis Overview
            </h1>
            <p
              className="section-subtitle"
              style={{
                margin: "2px 0 0 0",
                fontSize: "0.75rem",
                color: "#64748b",
              }}
            >
              Fleet-wide lubrication health & sampling schedule
            </p>
          </div>

          {/* RIGHT SIDE: Grouped Actions (Bell, Feed, Upload) */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* 1. NOTIFICATION BELL */}
            {/* <div style={{ position: "relative" }} ref={notifRef}>
            <button
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              style={{
                backgroundColor: "white",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                color: unreadCount > 0 ? "#2563eb" : "#64748b",
                transition: "all 0.2s",
              }}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-6px",
                    right: "-6px",
                    backgroundColor: "#ef4444",
                    color: "white",
                    fontSize: "9px",
                    fontWeight: "bold",
                    borderRadius: "50%",
                    width: "16px",
                    height: "18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "2px solid white",
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifDropdown && (
              <div
                ref={notifRef}
                style={{
                  position: "absolute",
                  top: "120%",
                  right: 0,
                  width: "300px",
                  maxHeight: "400px",
                  backgroundColor: "white",
                  borderRadius: "12px",
                  boxShadow:
                    "0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
                  border: "1px solid #e2e8f0",
                  zIndex: 1000,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "12px 16px",
                    backgroundColor: "#f8fafc",
                    borderBottom: "1px solid #f1f5f9",
                    fontWeight: "800",
                    fontSize: "0.8rem",
                    color: "#64748b",
                  }}
                >
                  NOTIFICATIONS
                </div>

                <div style={{ overflowY: "auto", maxHeight: "350px" }}>
                  {notifications.length === 0 ? (
                    <div
                      style={{
                        padding: "24px",
                        textAlign: "center",
                        color: "#94a3b8",
                        fontSize: "0.85rem",
                      }}
                    >
                      No recent notifications
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => handleNotifClick(n)}
                        style={{
                          padding: "12px 16px",
                          borderBottom: "1px solid #f1f5f9",
                          cursor: "pointer",
                          position: "relative",
                          backgroundColor: n.is_read
                            ? "transparent"
                            : "#f0f9ff",
                          transition: "background 0.2s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = n.is_read
                            ? "#f8fafc"
                            : "#e0f2fe")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = n.is_read
                            ? "transparent"
                            : "#f0f9ff")
                        }
                      >
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); 
                            handleHideNotification(n.id); 
                          }}
                          style={{
                            position: "absolute",
                            top: "8px",
                            right: "8px",
                            background: "none",
                            border: "none",
                            color: "#94a3b8",
                            cursor: "pointer",
                            padding: "4px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "4px",
                            zIndex: 2,
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.color = "#ef4444")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.color = "#94a3b8")
                          }
                        >
                          <X size={14} />
                        </button>

                       
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "#1e293b",
                            lineHeight: "1.4",
                            paddingRight: "20px",
                          }}
                        >
                          {n.sender_name && n.message.includes(n.sender_name)
                            ? n.message
                                .split(n.sender_name)
                                .map((part, i, arr) => (
                                  <React.Fragment key={i}>
                                    {part}
                                    {i < arr.length - 1 && (
                                      <strong style={{ fontWeight: "800" }}>
                                        {n.sender_name}
                                      </strong>
                                    )}
                                  </React.Fragment>
                                ))
                            : n.message}
                        </div>

                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#94a3b8",
                            marginTop: "6px",
                          }}
                        >
                          {new Date(n.created_at + "Z").toLocaleString(
                            "en-GB",
                            {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: true,
                            },
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div> */}

            {/* 2. LIVE FEED BUTTON */}
            {/* <Button
            className="nav-pill-btn"
            style={{
              backgroundColor: viewMode === "liveFeed" ? "#0f172a" : "#fff",
              color: viewMode === "liveFeed" ? "white" : "#64748b",
              border: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              height: "36px",
              padding: "0 14px",
              borderRadius: "10px",
              fontWeight: "700",
              fontSize: "0.8rem",
            }}
            onClick={() => {
              if (viewMode === "matrix") {
                fetchFeed();
                setViewMode("liveFeed");
              } else {
                setViewMode("matrix");
              }
            }}
          >
            {viewMode === "matrix" ? (
              <>
                <Activity size={18} /> My Feed
              </>
            ) : (
              <>
                <ChevronDown size={18} style={{ transform: "rotate(90deg)" }} />{" "}
                Go Back
              </>
            )}
          </Button> */}

            {/* 3. UPLOAD BUTTON AREA */}
            <div style={{ position: "relative" }}>
              <input
                type="file"
                accept=".pdf"
                id="luboil-upload"
                multiple
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
              <Button
                className="nav-pill-btn active-nav-btn"
                style={{
                  backgroundColor: "#2563eb",
                  color: "white",
                  height: "36px",
                  padding: "0 14px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  fontSize: "0.8rem",
                }}
                onClick={() => document.getElementById("luboil-upload").click()}
                disabled={uploading}
              >
                <Upload size={18} style={{ marginRight: "8px" }} />
                {uploading && uploadProgress.total > 0
                  ? `${uploadProgress.current}/${uploadProgress.total} Processing...`
                  : uploading
                    ? "Processing..."
                    : "Upload Report (PDF)"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Stats Grid with Collapsible Header */}
      {/* <Card
        className="enhanced-card"
        style={{
          marginBottom: "24px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
        }}
      >
        <CardHeader
          onClick={() => setIsStatsOpen(!isStatsOpen)}
          style={{
            display: "flex",
            flexDirection: "row" ,
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "20px",
            cursor: "pointer",
            backgroundColor: "white",
            borderBottom: isStatsOpen ? "1px solid #f1f5f9" : "none",
            borderTopLeftRadius: "8px",
            borderTopRightRadius: "8px",
            transition: "background-color 0.2s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "#f8fafc")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "white")
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                backgroundColor: "#64748b",
                borderRadius: "8px",
                width: "48px",
                height: "48px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Clock size={24} color="white" />
            </div>

            <div style={{ textAlign: "left" }}>
              <CardTitle
                style={{
                  fontSize: "1.1rem",
                  color: "#0f172a",
                  marginBottom: "4px",
                  lineHeight: "1.2",
                }}
              >
                Report Status - Days Elapsed
              </CardTitle>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>
                Date since last report From Sample Date
              </p>
            </div>
          </div>

          <div style={{ color: "#64748b" }}>
            {isStatsOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </CardHeader>

        {isStatsOpen && (
          <CardContent
            style={{ padding: "20px", animation: "fadeIn 0.3s ease-in-out" }}
          >
            <div
              className="luboil-stats-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px",
              }}
            >
              <div
                className="stat-card"
                onClick={() => handleCardClick("Normal")}
                style={{
                  backgroundColor: "white",
                  padding: "20px",
                  borderRadius: "8px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  borderLeft: "5px solid #22c55e",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#dcfce7",
                    padding: "10px",
                    borderRadius: "8px",
                    color: "#16a34a",
                  }}
                >
                  <CheckCircle size={24} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: "bold",
                      lineHeight: "1",
                      color: "#0f172a",
                    }}
                  >
                    {stats.normal}
                  </div>
                  <div
                    style={{
                      fontWeight: "600",
                      color: "#334155",
                      marginTop: "4px",
                    }}
                  >
                    Normal
                  </div>
                  
                </div>
              </div>

              
              <div
                className="stat-card"
                onClick={() => handleCardClick("Warning")}
                style={{
                  backgroundColor: "white",
                  padding: "20px",
                  borderRadius: "8px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  borderLeft: "5px solid #eab308",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#fef9c3",
                    padding: "10px",
                    borderRadius: "8px",
                    color: "#ca8a04",
                  }}
                >
                  <Clock size={24} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: "bold",
                      lineHeight: "1",
                      color: "#0f172a",
                    }}
                  >
                    {stats.warning}
                  </div>
                  <div
                    style={{
                      fontWeight: "600",
                      color: "#334155",
                      marginTop: "4px",
                    }}
                  >
                    Action Required
                  </div>
                 
                </div>
              </div>

              <div
                className="stat-card"
                onClick={() => handleCardClick("Critical")}
                style={{
                  backgroundColor: "white",
                  padding: "20px",
                  borderRadius: "8px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  borderLeft: "5px solid #ef4444",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#fee2e2",
                    padding: "10px",
                    borderRadius: "8px",
                    color: "#dc2626",
                  }}
                >
                  <AlertOctagon size={24} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: "bold",
                      lineHeight: "1",
                      color: "#0f172a",
                    }}
                  >
                    {stats.critical}
                  </div>
                  <div
                    style={{
                      fontWeight: "600",
                      color: "#334155",
                      marginTop: "4px",
                    }}
                  >
                    Critical
                  </div>
                 
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card> */}
      {/* ----------------- NEW OVERDUE STATS ROW ----------------- */}
      {viewMode === "matrix" ? (
        <>
          <div
            className="lub-stats-grid-container"
            style={{
              display: "grid",
              marginBottom: "8px",
              flexShrink: 0,
            }}
          >
            {/* Card 1: Configured Vessels */}
            <div
              className="stat-card stat-card-configured"
              onClick={() => handleCardClick("Configured")}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = "translateY(-2px)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.transform = "translateY(0)")
              }
            >
              <div
                className="stat-icon-wrapper icon-bg-slate"
              >
                <Activity size={20} /> {/* Reduced from 24 */}
              </div>
              <div className="stat-text-column">
                <div className="lub-stat-value">{overdueStats.configured}</div>
                <div className="lub-stat-label">Configured Vessels</div>
              </div>
            </div>

            {/* NEW Card 2: Pending / Unresolved Cases */}
            <div
              className="stat-card stat-card-unresolved"
              onClick={() => handleCardClick("PendingUnresolved")}
            >
              <div className="stat-icon-wrapper icon-bg-red">
                <AlertCircle size={20} />
              </div>
              <div className="stat-text-column">
                <div className="lub-stat-value">{overdueStats.pendingUnresolved || 0}</div>
                <div className="lub-stat-label">Pending / Unresolved</div>
              </div>
            </div>

            {/* Card 2: Warning Overdue > 30 Days */}
            <div
              className="stat-card stat-card-warning"
              onClick={() => handleCardClick("WarningUnder30")}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = "translateY(-2px)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.transform = "translateY(0)")
              }
            >
              <div className="stat-icon-wrapper icon-bg-orange">
                <Clock size={20} />
              </div>
              <div className="stat-text-column">
                <div
                  className="lub-stat-value"
                >
                  {overdueStats.overdueUnder30}
                </div>
                <div
                  className="lub-stat-label"
                >
                  Overdue &lt; 30 Days
                </div>
              </div>
            </div>

            {/* Card 3: Critical Overdue > 60 Days */}
            <div
              className="stat-card stat-card-critical"
              onClick={() => handleCardClick("CriticalOver30")}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = "translateY(-2px)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.transform = "translateY(0)")
              }
            >
              <div className="stat-icon-wrapper icon-bg-red">
                <AlertOctagon size={20} />
              </div>
              <div className="stat-text-column">
                <div
                  className="lub-stat-value"
                >
                  {overdueStats.overdueOver30}
                </div>
                <div
                  className="lub-stat-label"
                >
                  Overdue &gt; 30 Days With Concern
                </div>
              </div>
            </div>
          </div>
          <Card className="lub-matrix-card enhanced-card">
            {/* NEW HEADER FOR TABLE */}
            <CardHeader
              onClick={() => setIsTableOpen(!isTableOpen)}
              className="lub-matrix-card-header"
            >
              {/* LEFT GROUP: Icon + Title + Filter (Now grouped together) */}
              <div className="lub-matrix-header-left">
                {/* Title & Icon Section */}
                <div className="lub-matrix-title-group">
                  <div className="lub-matrix-icon-box">
                    <Droplet size={18} color="white" className="matrix-droplet-icon" />
                  </div>
                  <div className="lub-matrix-text-box">
                    <CardTitle className="lub-matrix-card-title">
                      Latest Report Matrix
                    </CardTitle>
                    {/* <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>
                  Breakdown by Vessel & Machinery
                </p> */}
                  </div>
                </div>

                {/* --- VESSEL DROPDOWN (Positioned on the Left) --- */}
                <div ref={vesselDropdownRef} className="lub-vessel-dropdown-wrapper">
                  <button
                    className={`lub-vessel-select-btn ${isVesselDropdownOpen ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsTableOpen(true);
                      setIsVesselDropdownOpen(!isVesselDropdownOpen);
                    }}
                  >
                    <span className="vessel-btn-label">
                      {selectedVesselsFilter.length === 0
                        ? "Select the vessel"
                        : selectedVesselsFilter.length ===
                          availableVessels.length
                          ? " All Vessels"
                          : ` ${selectedVesselsFilter.length} Selected`}
                    </span>
                    <ChevronDown size={14} />
                  </button>

                  {isVesselDropdownOpen && (
                    <div
                      className=" lub-vessel-select-menu"
                    >
                      {/* Sticky Select All at top */}
                      <div
                        className="vessel-menu-header"
                      >
                        <label className="vessel-checkbox-label">
                          <input
                            type="checkbox"
                            checked={
                              availableVessels.length > 0 &&
                              availableVessels.every((v) =>
                                selectedVesselsFilter.includes(v.vessel_name),
                              )
                            }
                            onChange={handleSelectAllVessels}
                          />
                          SELECT ALL
                        </label>
                      </div>

                      {/* SCROLLABLE LIST AREA */}
                      <div
                        className="vessel-dropdown-scroll"
                      >
                        {availableVessels.map((v) => (
                          <div
                            key={v.vessel_name}
                            className="vessel-menu-item"
                          >
                            <label className="vessel-checkbox-label">
                              <input
                                type="checkbox"
                                checked={selectedVesselsFilter.includes(
                                  v.vessel_name,
                                )}
                                onChange={() =>
                                  handleVesselToggle(v.vessel_name)
                                }
                              />
                              {/* FIX 4: Convert Vessel Name to all capital letters */}
                              {v.vessel_name.toUpperCase()}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT SIDE: COLLAPSE BUTTON */}
              <div
                className="lub-matrix-collapse-icon"
                onClick={() => setIsTableOpen(!isTableOpen)}
              >
                {isTableOpen ? (
                  <ChevronUp size={20} />
                ) : (
                  <ChevronDown size={20} />
                )}
              </div>
            </CardHeader>

            {/* CONDITIONALLY RENDER CONTENT */}
            {isTableOpen && (
              <CardContent style={{ padding: "0" }}>
                {loading ? (
                  <div className="loading-state-enhanced">
                    <div className="loading-spinner"></div>
                  </div>
                ) : selectedVesselsFilter.length > 0 ? (
                  /* 1. SCROLLABLE WRAPPER: Set to 500px height */
                  <div
                    className="matrix-scroll-container"
                    style={{ position: "relative", overflow: "auto" }}
                  >
                    <table
                      className="vessel-table-enhanced"
                      style={{
                        width:
                          selectedVesselsFilter.length > 5
                            ? `calc(220px + (${selectedVesselsFilter.length} * ((100% - 220px) / 5)))`
                            : "100%",
                        borderCollapse: "separate", // Necessary for sticky headers to not flicker
                        borderSpacing: 0,
                        tableLayout: "fixed", // ðŸ”¥ Ensures all columns respect the defined width
                      }}
                    >
                      <thead>
                        <tr>
                          {/* TOP-LEFT STICKY HEADER (Highest Z-Index) */}
                          <th
                            className="sticky-col matrix-corner-header"
                            style={{
                              position: "sticky",
                              left: 0,
                              top: 0,
                              zIndex: 1000,
                              backgroundColor: "#f1f5f9",
                              borderRight: "1px solid #e2e8f0",
                              borderBottom: "2px solid #cbd5e1",
                              textAlign: "left",
                            }}
                          >
                            MACHINERY / EQUIPMENT
                          </th>

                          {/* TOP STICKY VESSEL HEADERS (Restored Click Logic) */}
                          {selectedVesselsFilter.map((vesselName) => {
                            const vesselImo =
                              matrixData?.data?.[vesselName]?.imo;

                            // 1. Logic to find the Lab Name from the machinery data
                            // Searches all machineries for this vessel and picks the first 'lab_name' found.
                            const vesselData = matrixData?.data?.[vesselName];

                            const uniqueSources = [
                              ...new Set(
                                Object.values(vesselData?.machineries || {})
                                  .map((m) => m.oil_source) // 🟢 Look at the new oil_source from backend
                                  .filter((source) => source && source.trim() !== "") // Remove nulls/blanks
                              )
                            ];

                            // 2. Condition: If same, it shows one. If different, it joins them. Fallback if empty.
                            const labNameDisplay = uniqueSources.length > 0
                              ? uniqueSources.join(" / ")
                              : "Unknown Source";

                            return (
                              <th
                                key={vesselName}
                                // onClick={() => handleVesselClick(vesselName, vesselImo)}
                                className="vessel-header-cell"

                                style={{
                                  position: "sticky",
                                  top: 0,
                                  zIndex: 50,
                                  width: "calc((100% - 220px) / 5)",
                                  minWidth: "calc((100% - 220px) / 5)",
                                  fontSize: "0.8rem",
                                  textAlign: "center",
                                  padding: "10px 4px", // Adjusted padding for better vertical fit
                                  backgroundColor: "#f8fafc",
                                  borderBottom: "2px solid #cbd5e1",
                                  borderRight: "1px solid #e2e8f0",
                                  cursor: "pointer",
                                  color: "#1e293b",
                                  transition: "background 0.2s",
                                }}
                                onMouseEnter={(e) =>
                                (e.currentTarget.style.backgroundColor =
                                  "#eff6ff")
                                }
                                onMouseLeave={(e) =>
                                (e.currentTarget.style.backgroundColor =
                                  "#f8fafc")
                                }
                              >
                                <div
                                  className="vessel-header-container"
                                >
                                  {/* Vessel Name */}
                                  <span
                                    className="vessel-name-txt"
                                  >
                                    {vesselName}
                                  </span>

                                  {/* Lab Source Name */}
                                  <span
                                    className="vessel-lab-txt"
                                  >
                                    {labNameDisplay}
                                  </span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {/* ROW ITERATION (Machinery) */}
                        {(() => {
                          // 1. DYNAMIC FILTER: Determine which equipment rows actually have data in the current view
                          const visibleColumns = tableColumns.filter(
                            (colCode) => {
                              // Return true if ANY of the selected vessels has a report for this equipment
                              return selectedVesselsFilter.some(
                                (vesselName) => {
                                  const cell =
                                    normalizedTable.rows[vesselName]?.[colCode];
                                  return (
                                    cell &&
                                    cell.is_configured &&
                                    cell.has_report === true
                                  );
                                },
                              );
                            },
                          );

                          // 2. MAP ONLY THE VISIBLE ROWS (Hiding universal Missing/NA rows)
                          return visibleColumns.map((colCode, rowIndex) => {
                            // ðŸ”¥ NEW: Find the full description for this machinery code to show on hover
                            const vesselWithInfo = selectedVesselsFilter.find(
                              (vName) =>
                                normalizedTable.rows[vName]?.[colCode]
                                  ?.description,
                            );
                            const fullName = vesselWithInfo
                              ? normalizedTable.rows[vesselWithInfo][colCode]
                                .description
                              : columnLabels[colCode] || colCode;

                            return (
                              <tr key={colCode} className="matrix-table-row">
                                {/* LEFT STICKY MACHINERY NAME */}
                                <td
                                  className="sticky-col machinery-sticky-cell"
                                  title={fullName} // ðŸ”¥ ADDED: Shows full name on hover
                                  style={{
                                    position: "sticky",
                                    left: 0,
                                    backgroundColor: "#ffffff",
                                    zIndex: 6,
                                    borderRight: "1px solid #e2e8f0",
                                    borderBottom: "1px solid #e2e8f0",
                                  }}
                                >
                                  <div className="machinery-info-wrapper">
                                    <span className="m-code-label">
                                      {columnLabels[colCode] || colCode}
                                    </span>
                                    <span className="m-desc-label">
                                      {fullName}
                                    </span>
                                  </div>
                                </td>

                                {/* DATA CELLS */}
                                {selectedVesselsFilter.map((vesselName) => {
                                  const cell =
                                    normalizedTable.rows[vesselName]?.[colCode];
                                  const isResolved = cell?.is_resolved === true;
                                  const isLatestReport =
                                    cell?.sample_id ===
                                    cell?.history?.[0]?.sample_id;
                                  const showVerifiedTick =
                                    isResolved && isLatestReport;
                                  const vesselImo =
                                    matrixData?.data?.[vesselName]?.imo;
                                  const today = new Date();

                                  const cellBaseStyle = {
                                    width: "calc((100% - 220px) / 5)",
                                    minWidth: "calc((100% - 220px) / 5)",
                                    height: "80px",
                                    textAlign: "center",
                                    verticalAlign: "middle",
                                    padding: "2px",
                                    borderBottom: "1px solid #f1f5f9",
                                    borderRight: "1px solid #f1f5f9",
                                    boxSizing: "border-box",
                                    position: "relative",
                                  };

                                  // --- CONDITION 1: N/A ---
                                  if (!cell || !cell.is_configured) {
                                    return (
                                      <td key={vesselName} className="lub-data-cell empty-cell">
                                        <span className="na-text">N/A</span>
                                      </td>
                                    );
                                  }

                                  // --- CONDITION 2: MISSING ---
                                  if (!cell.has_report) {
                                    return (
                                      <td key={vesselName} className="lub-data-cell missing-cell">
                                        <div className="missing-label">MISSING</div>
                                      </td>

                                    );
                                  }

                                  // --- CONDITION 3: DATA AVAILABLE ---
                                  const interval =
                                    typeof cell.interval === "number" &&
                                      cell.interval > 0
                                      ? cell.interval
                                      : 3;
                                  const sampleDate = new Date(cell.last_sample);
                                  const dueDate = new Date(sampleDate);
                                  dueDate.setMonth(
                                    dueDate.getMonth() + interval,
                                  );
                                  const formattedDue =
                                    dueDate.toLocaleDateString("en-GB", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "2-digit",
                                    });
                                  const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
                                  const hasRemarks =
                                    cell.officer_remarks || cell.office_remarks;
                                  const isNormal =
                                    cell.status &&
                                    cell.status.toLowerCase() === "normal";

                                  let badgeBg = "#4e4f4f";
                                  let badgeText = "#fcfdfd";

                                  return (
                                    <td
                                      key={vesselName}
                                      // onClick={() => {
                                      //   const latestSample = cell.history && cell.history.length > 0 ? cell.history[0] : null;
                                      //   handleSelectSample(vesselName, cell, latestSample);
                                      // }}
                                      //   style={{
                                      //     ...cellBaseStyle,
                                      //     cursor: isNormal
                                      //       ? "default"
                                      //       : "pointer",
                                      //     transition: "background 0.2s",
                                      //   }}
                                      className={`lub-data-cell data-available ${isNormal ? "" : "hover-cell"}`}
                                    >
                                      {daysOverdue > 0 && (
                                        <div
                                          title={`Overdue by ${daysOverdue} days`}
                                          className={`overdue-indicator ${daysOverdue > 30 ? "critical" : "warning"}`}
                                        >
                                          <Clock size={12} color="white" className="indicator-icon" />
                                        </div>
                                      )}
                                      {showVerifiedTick && (
                                        <div className="verified-tick-dogear" title="Resolution Documented & Verified">
                                          <CheckCircle size={12} color="white" className="indicator-icon" />
                                        </div>
                                      )}
                                      <div className="cell-content-wrapper">
                                        <StatusDots
                                          history={cell.history}
                                          vesselName={vesselName} // Pass vessel
                                          cellData={cell}
                                          hasLatestRemarks={hasRemarks}
                                          previousStatus={cell.previous_status}
                                          hasReport={cell.has_report}
                                          dueText={formattedDue}
                                          daysOverdue={daysOverdue}
                                          openUpward={
                                            rowIndex >=
                                            visibleColumns.length - 2
                                          }
                                          onChartClick={() => {
                                            handleOpenTrend(
                                              vesselName,
                                              vesselImo,
                                              cell.code,
                                              cell.description,
                                            );
                                          }}
                                          onSampleClick={(sample) =>
                                            handleSelectSample(
                                              vesselName,
                                              cell,
                                              sample,
                                            )
                                          }
                                        />
                                        {/* <span
                    style={{
                      backgroundColor: badgeBg,
                      color: badgeText,
                      fontSize: "0.65rem",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontWeight: "700",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Due: {formattedDue}
                  </span> */}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                      {/* ðŸ”¥ FULLY UPDATED STICKY FOOTER WITH CHECKLIST POPOVER */}
                      <tfoot className="matrix-footer-sticky">
                        <tr>
                          <td className="lub-matrix-footer-label">
                            PDF Reports
                          </td>

                          {selectedVesselsFilter.map((vesselName) => {
                            const vesselImo =
                              matrixData?.data?.[vesselName]?.imo;
                            const isOpen = footerReportVessel === vesselName;

                            return (
                              <td key={`foot-${vesselName}`} className="lub-matrix-footer-cell">
                                <div
                                  ref={
                                    footerReportVessel === vesselName
                                      ? footerRef
                                      : null
                                  }
                                  className="footer-popover-wrapper"
                                >
                                  <button
                                    onClick={() => {
                                      if (isOpen) {
                                        setFooterReportVessel(null);
                                        setSelectedFooterReports([]);
                                      } else {
                                        handleFooterReportClick(
                                          vesselName,
                                          vesselImo,
                                        );
                                      }
                                    }}
                                    className={`lub-footer-select-btn ${isOpen ? "active" : ""}`}
                                  >
                                    <FileText size={14} />
                                    {isOpen ? "CLOSE" : "SELECT"}
                                  </button>

                                  {/* ðŸ”¥ CHECKLIST POPOVER CONTAINER */}
                                  {isOpen && (
                                    <div className="lub-footer-popover">
                                      {/* Popover Header */}
                                      <div className="lub-footer-popover-header">
                                        <span className="popover-title">SELECT REPORTS</span>
                                        {selectedFooterReports.length > 0 && (
                                          <span className="popover-count-badge">
                                            {selectedFooterReports.length} Selected
                                          </span>
                                        )}
                                      </div>

                                      {/* Popover List Body */}
                                      <div className="lub-footer-popover-body">
                                        {isFooterLoading ? (
                                          <div className="popover-loading-box">
                                            <div className="loading-spinner-small"></div>
                                          </div>
                                        ) : (
                                          footerReports.map((report, idx) => (
                                            <label key={idx} className="lub-footer-popover-item">
                                              <input
                                                type="checkbox"
                                                className="popover-checkbox"
                                                checked={selectedFooterReports.includes(
                                                  report.report_id,
                                                )}
                                                onChange={() => {
                                                  setSelectedFooterReports(
                                                    (prev) =>
                                                      prev.includes(
                                                        report.report_id,
                                                      )
                                                        ? prev.filter(
                                                          (id) =>
                                                            id !==
                                                            report.report_id,
                                                        )
                                                        : [
                                                          ...prev,
                                                          report.report_id,
                                                        ],
                                                  );
                                                }}
                                                style={{
                                                  width: "15px",
                                                  height: "15px",
                                                  cursor: "pointer",
                                                }}
                                              />
                                              <span
                                                className="popover-item-date"
                                              >
                                                {report.report_date
                                                  ? new Date(
                                                    report.report_date,
                                                  ).toLocaleDateString(
                                                    "en-GB",
                                                    {
                                                      day: "2-digit",
                                                      month: "short",
                                                      year: "numeric",
                                                    },
                                                  )
                                                  : "Unknown Date"}
                                              </span>
                                            </label>
                                          ))
                                        )}
                                      </div>

                                      {/* Popover Footer (Common Download Button) */}
                                      <div className="lub-footer-popover-footer">
                                        <button
                                          disabled={
                                            selectedFooterReports.length ===
                                            0 || isFooterDownloading
                                          }
                                          onClick={() =>
                                            handleFooterBatchDownload(
                                              vesselName,
                                            )
                                          }
                                          className="lub-footer-download-btn"
                                          style={{
                                            backgroundColor: selectedFooterReports.length > 0 ? "#10b981" : "#cbd5e1",
                                            cursor: selectedFooterReports.length > 0 ? "pointer" : "not-allowed",
                                          }}
                                        >
                                          {isFooterDownloading ? (
                                            "PREPARING ZIP..."
                                          ) : (
                                            <>
                                              <Download size={14} />
                                              DOWNLOAD SELECTED
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="lub-matrix-empty-state">
                    <p className="lub-matrix-empty-text">
                      Select one or more vessels above to view Fleet Analysis Matrix
                    </p>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </>
      ) : (
        <div style={{ animation: "fadeIn 0.4s ease-out" }}>
          {/* 1. Main Card: Set to Flexbox and Hide global overflow */}
          <Card
            className="enhanced-card lub-feed-container"
            style={{
              padding: "0",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              border: "1px solid #e2e8f0",
              scrollbarWidth: "thin",
              scrollbarColor: "#cbd5e1 transparent",
              height: "600px", // Base height
            }}
          >
            {/* 2. Sticky Header: Positioned at the top with a higher Z-index */}
            <CardHeader
              className="lub-feed-header-spacing"
              style={{
                backgroundColor: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {/* TOP ROW: Title and Horizontal Toggles */}
                <div className="lub-feed-top-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: "#0f172a",
                        padding: "6px",
                        borderRadius: "6px",
                        color: "white",
                      }}
                    >
                      <Activity size={18} />
                    </div>
                    <CardTitle className="lub-feed-title-text" style={{ fontWeight: "700" }}>
                      LIVE FEED
                    </CardTitle>
                  </div>

                  <div className="lub-feed-toggles" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {/* NEW: FLEET / MY FEED TOGGLE SWITCH */}
                    <div
                      className="lub-feed-toggle-group"
                      style={{
                        display: "flex",
                        background: "#e2e8f0",
                        padding: "2px",
                        borderRadius: "8px",
                        gap: "2px",
                      }}
                    >
                      {["FLEET", "MY FEED"].map((mode) => (
                        <button
                          key={mode}
                          className="lub-feed-toggle-btn"
                          onClick={() =>
                            setFeedMode(
                              mode === "MY FEED" ? "MY_FEED" : "FLEET",
                            )
                          }
                          style={{
                            /* Dynamic Styles - MUST STAY INLINE */
                            backgroundColor:
                              (feedMode === "MY_FEED" && mode === "MY FEED") ||
                                (feedMode === "FLEET" && mode === "FLEET")
                                ? "white"
                                : "transparent",
                            color:
                              (feedMode === "MY_FEED" && mode === "MY FEED") ||
                                (feedMode === "FLEET" && mode === "FLEET")
                                ? "#2563eb"
                                : "#64748b",
                            boxShadow:
                              (feedMode === "MY_FEED" && mode === "MY FEED") ||
                                (feedMode === "FLEET" && mode === "FLEET")
                                ? "0 2px 4px rgba(0,0,0,0.1)"
                                : "none",
                            /* Static Visual Styles */
                            border: "none",
                            cursor: "pointer",
                            transition: "all 0.2s",
                          }}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>

                    {/* HORIZONTAL TOGGLE SWITCH (READ/UNREAD) */}
                    <div
                      className="lub-feed-read-toggle-group"
                      style={{
                        display: "flex",
                        background: "#e2e8f0",
                        padding: "2px",
                        borderRadius: "8px",
                        gap: "1px",
                      }}
                    >
                      {["ALL", "UNREAD", "READ"].map((mode) => (
                        <button
                          className="lub-feed-read-btn"
                          key={mode}
                          onClick={() => setFeedReadFilter(mode)}
                          style={{
                            /* Dynamic logic must stay inline */
                            backgroundColor: feedReadFilter === mode ? "white" : "transparent",
                            color: feedReadFilter === mode ? "#2563eb" : "#64748b",
                            boxShadow: feedReadFilter === mode ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                            /* Static styles */
                            border: "none",
                            cursor: "pointer",
                            transition: "all 0.2s",
                          }}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>

                    <Button
                      onClick={fetchFeed}
                      className="lub-feed-refresh-btn"
                      style={{
                        background: "white",
                        color: "#0f172a",
                        border: "1px solid #cbd5e1",
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer"
                      }}
                    >
                      <Clock size={14} style={{ marginRight: "5px" }} /> Refresh
                    </Button>
                  </div>
                </div>

                {/* BOTTOM ROW: Filters and Search */}
                <div className="lub-feed-filter-bar" style={{ display: "flex", alignItems: "center" }}>
                  {/* Keyword Search */}
                  <div className="lub-feed-search-box" style={{ position: "relative" }}>
                    <Filter
                      size={16}
                      style={{
                        position: "absolute",
                        left: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#94a3b8",
                      }}
                    />
                    <input
                      type="text"
                      className="lub-feed-search-input"
                      placeholder="Search feed..."
                      value={feedSearch}
                      onChange={(e) => setFeedSearch(e.target.value)}
                      style={{ borderRadius: "6px", border: "1px solid #e2e8f0", backgroundColor: "white", color: "black" }}
                    />
                  </div>

                  {/* Vessel Dropdown */}
                  <select
                    className="lub-feed-vessel-select"
                    value={feedVesselFilter}
                    onChange={(e) => setFeedVesselFilter(e.target.value)}
                    style={{ borderRadius: "6px", border: "1px solid #e2e8f0", backgroundColor: "white", color: "black", cursor: "pointer" }}
                  >
                    {uniqueFeedVessels.map((v) => (
                      <option key={v} value={v}>
                        {v === "ALL" ? "ALL VESSEL" : v}
                      </option>
                    ))}
                  </select>

                  {/* Event Type Dropdown - CONDITIONALLY RENDERED */}
                  {feedMode === "FLEET" && (
                    <select
                      className="lub-feed-action-select"
                      value={feedFilter}
                      onChange={(e) => setFeedFilter(e.target.value)}
                      style={{ borderRadius: "6px", border: "1px solid #e2e8f0", backgroundColor: "white", color: "black", cursor: "pointer" }}
                    >
                      <option value="ALL">ALL ACTIONS</option>
                      <option value="NEW_REPORT">UPLOADED REPORT</option>
                      <option value="EVIDENCE_UPLOAD">UPLOADED EVIDENCE</option>
                      <option value="RESAMPLE_REMINDER">
                        RESAMPLE PENDING
                      </option>
                      <option value="EVIDENCE_DELETE">DELETED EVIDENCE</option>
                      <option value="SCHEDULE_ALERT">OVERDUE</option>
                      <option value="MANDATORY">IMAGE MANDATORY</option>
                    </select>
                  )}

                  {/* Date Pickers */}
                  <div className="lub-feed-date-container" style={{ display: "flex", alignItems: "center", backgroundColor: "white", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span className="lub-feed-date-label" style={{ color: "#64748b", fontWeight: "800" }}>FROM:</span>
                      <input
                        type="date"
                        className="lub-feed-date-field"
                        value={feedFromDate}
                        onChange={(e) => setFeedFromDate(e.target.value)}
                        style={{ border: "none", outline: "none", backgroundColor: "white", color: "black" }}
                      />
                    </div>

                    <div
                      style={{
                        width: "1px",
                        height: "14px",
                        backgroundColor: "#e2e8f0",
                      }}
                    ></div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span className="lub-feed-date-label" style={{ color: "#64748b", fontWeight: "800" }}>TO:</span>
                      <input
                        type="date"
                        className="lub-feed-date-field"
                        value={feedToDate}
                        onChange={(e) => setFeedToDate(e.target.value)}
                        style={{ border: "none", outline: "none", backgroundColor: "white", color: "black" }}
                      />
                    </div>

                    {(feedFromDate || feedToDate) && (
                      <X
                        size={14}
                        onClick={() => {
                          setFeedFromDate("");
                          setFeedToDate("");
                        }}
                        style={{
                          cursor: "pointer",
                          color: "#ef4444",
                          marginLeft: "4px",
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>

            {/* 3. Scrollable Content Area */}
            <CardContent
              className="lub-feed-content"
              style={{
                padding: "10px 16px",
                overflowY: "auto",
                flex: 1,
                backgroundColor: "#ffffff",
                scrollbarWidth: "thin",
              }}
            >
              {feedLoading ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    padding: "60px",
                  }}
                >
                  <div className="loading-spinner"></div>
                </div>
              ) : groupedFeed.today.length > 0 ||
                groupedFeed.earlier.length > 0 ||
                groupedFeed.read.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {/* Helper Internal Function to keep existing styling exactly as it was */}
                  {(() => {
                    const renderFeedItem = (item) => (
                      <div
                        key={item.id}
                        className={`lub-feed-item-card ${item.is_read ? 'read' : 'unread'}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          borderRadius: "8px",
                          border: "1px solid #e2e8f0",
                          cursor: "default",
                          transition: "all 0.2s",
                          /* Logic-based colors remain inline */
                          backgroundColor: item.is_read ? "#ffffff" : "#f0f9ff",
                          borderLeft: item.is_read ? "6px solid #cbd5e1" : "6px solid #2563eb",
                          position: "relative",
                          marginBottom: "4px",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow =
                            "0 4px 12px rgba(0,0,0,0.05)";
                          e.currentTarget.style.backgroundColor = item.is_read
                            ? "#f8fafc"
                            : "#e0f2fe";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = "none";
                          e.currentTarget.style.backgroundColor = item.is_read
                            ? "#ffffff"
                            : "#f0f9ff";
                        }}
                      >
                        {/* Event Icon */}
                        <div
                          className="lub-feed-item-icon-box"
                          style={{ width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", marginRight: "12px" }}
                        >
                          {item.event_type === "MENTION" ? (
                            <MessageSquareText size={16} />
                          ) : item.event_type === "EVIDENCE_UPLOAD" ? (
                            <ImageIcon size={16} />
                          ) : item.event_type === "MANDATORY" ? ( // ðŸ”¥ NEW: Icon for Image/Resample Mandatory toggles
                            <AlertTriangle size={16} />
                          ) : item.event_type === "APPROVAL_REQUEST" ? ( // ðŸ”¥ NEW: Vessel requesting closure
                            <Clock size={16} />
                          ) : item.event_type === "STATUS_CHANGE" ? ( // ðŸ”¥ NEW: Reopening or Status Alerts
                            <Activity size={16} />
                          ) : item.event_type === "APPROVAL_DECLINED" ? ( // ðŸ”¥ NEW: Shore declined closure
                            <X size={16} color="#ef4444" />
                          ) : item.event_type === "RESAMPLE_REMINDER" ? (
                            <History size={16} />
                          ) : item.priority === "CRITICAL" ? (
                            <AlertOctagon size={16} />
                          ) : item.event_type === "SCHEDULE_ALERT" ? (
                            <Clock size={16} />
                          ) : (
                            <FileText size={16} />
                          )}
                        </div>

                        {/* Message Body */}
                        <div className="lub-feed-item-body" style={{ flex: 1 }}>
                          {(() => {
                            const msgParts = item.message.split("\n");
                            const headerText = msgParts[0];
                            const bodyContent = msgParts.slice(1).join("\n");

                            return (
                              <>
                                <div style={{ marginBottom: "4px" }}>
                                  <span
                                    className="lub-feed-item-title"
                                    style={{ fontWeight: "700", color: item.is_read ? "#64748b" : "#0f172a" }}
                                  >
                                    {headerText}
                                  </span>
                                </div>
                                <div
                                  className="lub-feed-item-desc"
                                  style={{ color: item.is_read ? "#94a3b8" : "#334155", whiteSpace: "pre-wrap", lineHeight: "1.4" }}
                                >
                                  {bodyContent}
                                </div>
                              </>
                            );
                          })()}
                        </div>

                        {/* Action Area: Timestamp + Buttons */}
                        <div className="lub-feed-item-actions" style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px" }}>
                          <div className="lub-feed-timestamp" style={{ color: "#94a3b8", fontWeight: "600" }}>
                            {new Date(item.created_at + "Z").toLocaleDateString(
                              "en-GB",
                            )}{" "}
                            {new Date(item.created_at + "Z").toLocaleTimeString(
                              "en-GB",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                              },
                            )}
                          </div>

                          <div className="lub-feed-item-btns" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {!item.is_read && (
                              <button
                                className="lub-action-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkSingleRead(item.id);
                                }}
                                style={{
                                  backgroundColor: "white",
                                  border: "1px solid #2563eb",
                                  color: "#2563eb",
                                  borderRadius: "4px",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <CheckCircle size={12} /> MARK AS READ
                              </button>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFeedItemClick(item);
                              }}
                              className="lub-action-btn"
                              style={{
                                backgroundColor: "white",
                                color: "#2563eb",
                                border: "1px solid #2563eb",
                                borderRadius: "4px",
                                fontWeight: "700",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                transition: "all 0.2s",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor =
                                  "#2563eb";
                                e.currentTarget.style.color = "white";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "white";
                                e.currentTarget.style.color = "#2563eb";
                              }}
                            >
                              <Eye size={14} /> VIEW
                            </button>
                          </div>
                        </div>
                      </div>
                    );

                    const SectionHeader = (text) => (
                      <div
                        className="lub-feed-section-divider"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          className="lub-feed-line"
                          style={{
                            flex: 1,
                            backgroundColor: "#f1f5f9",
                          }}
                        ></div>
                        <span
                          className="lub-feed-section-pill"
                          style={{
                            fontWeight: "800",
                            color: "#f59e0b",
                            border: "1px solid #f59e0b",
                            borderRadius: "6px",
                            backgroundColor: "#fff7ed",
                            textTransform: "uppercase",
                            letterSpacing: "1px",
                          }}
                        >
                          {text}
                        </span>
                        <div
                          className="lub-feed-line"
                          style={{
                            flex: 1,
                            backgroundColor: "#f1f5f9",
                          }}
                        ></div>
                      </div>
                    );

                    return (
                      <>
                        {groupedFeed.today.length > 0 && (
                          <>
                            {SectionHeader("TODAY")}
                            {groupedFeed.today.map((item) =>
                              renderFeedItem(item),
                            )}
                          </>
                        )}

                        {groupedFeed.earlier.length > 0 && (
                          <>
                            {SectionHeader("EARLIER")}
                            {groupedFeed.earlier.map((item) =>
                              renderFeedItem(item),
                            )}
                          </>
                        )}

                        {groupedFeed.read.length > 0 && (
                          <>
                            {SectionHeader("READ")}
                            {groupedFeed.read.map((item) =>
                              renderFeedItem(item),
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "60px 20px",
                    color: "#94a3b8",
                  }}
                >
                  <Activity
                    size={48}
                    style={{ opacity: 0.2, marginBottom: "12px" }}
                  />
                  <p>No feed items match your current filters.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {/* <Card
        className="enhanced-card"
        style={{
          marginBottom: "24px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
        }}
      >
        
        <CardHeader
          onClick={() => setIsMachineryStatsOpen(!isMachineryStatsOpen)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "20px",
            cursor: "pointer",
            backgroundColor: "white",
            borderBottom: isMachineryStatsOpen ? "1px solid #f1f5f9" : "none",
            borderTopLeftRadius: "8px",
            borderTopRightRadius: "8px",
            transition: "background-color 0.2s",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "#f8fafc")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "white")
          }
        >
          
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                backgroundColor: "#64748b",
                borderRadius: "8px",
                width: "48px",
                height: "48px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Activity size={24} color="white" />
            </div>
            <div style={{ textAlign: "left" }}>
              <CardTitle
                style={{
                  fontSize: "1.1rem",
                  color: "#0f172a",
                  marginBottom: "4px",
                  lineHeight: "1.2",
                }}
              >
                Machinery Status - Days Elapsed
              </CardTitle>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>
                Individual Equipment Health & Age
              </p>
            </div>
          </div>

          
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <div style={{ textAlign: "right" }}>
              <span
                style={{
                  fontSize: "0.85rem",
                  color: "#64748b",
                  marginRight: "8px",
                }}
              >
                Total Equipment:
              </span>
              <span
                style={{
                  fontSize: "1.2rem",
                  fontWeight: "bold",
                  color: "#0f172a",
                }}
              >
                {totalEquipment}
              </span>
            </div>
            <div style={{ color: "#64748b" }}>
              <ChevronDown
                size={20}
                style={{
                  transform: isMachineryStatsOpen
                    ? "rotate(180deg)"
                    : "rotate(0deg)",
                  transition: "transform 0.3s ease-in-out",
                }}
              />
            </div>
          </div>
        </CardHeader>
        {isMachineryStatsOpen && (
          <CardContent
            style={{
              padding: "20px",
              animation: "fadeIn 0.3s ease-in-out",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
           
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px",
                border: "1px solid #f1f5f9",
                borderRadius: "12px",
                backgroundColor: "white",
              }}
            >
              
              <div
                style={{
                  width: "50px",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#dcfce7",
                    padding: "8px",
                    borderRadius: "20%",
                    color: "#16a34a",
                  }}
                >
                  <CheckCircle size={20} />
                </div>
              </div>

              
              <div style={{ width: "150px", paddingLeft: "12px" }}>
                <div style={{ fontWeight: "600", color: "#334155" }}>
                  Normal
                </div>
              </div>

              
              <div
                style={{
                  flex: 1,
                  height: "12px",
                  backgroundColor: "#f1f5f9",
                  borderRadius: "6px",
                  margin: "0 24px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${getPercentage(machineryStats.normal)}%`,
                    height: "100%",
                    backgroundColor: "#22c55e",
                    borderRadius: "6px",
                    transition: "width 0.5s ease-in-out",
                  }}
                ></div>
              </div>

              
              <div style={{ width: "100px", textAlign: "right" }}>
                <span
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: "bold",
                    color: "#0f172a",
                  }}
                >
                  {machineryStats.normal}
                </span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "#64748b",
                    marginLeft: "6px",
                  }}
                >
                  equipment
                </span>
              </div>
            </div>

            
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px",
                border: "1px solid #f1f5f9",
                borderRadius: "12px",
                backgroundColor: "white",
              }}
            >
              <div
                style={{
                  width: "50px",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#fef9c3",
                    padding: "8px",
                    borderRadius: "20%",
                    color: "#ca8a04",
                  }}
                >
                  <Clock size={20} />
                </div>
              </div>

              <div style={{ width: "150px", paddingLeft: "12px" }}>
                <div style={{ fontWeight: "600", color: "#334155" }}>
                  Action Required
                </div>
              </div>

              <div
                style={{
                  flex: 1,
                  height: "12px",
                  backgroundColor: "#f1f5f9",
                  borderRadius: "6px",
                  margin: "0 24px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${getPercentage(machineryStats.warning)}%`,
                    height: "100%",
                    backgroundColor: "#eab308",
                    borderRadius: "6px",
                    transition: "width 0.5s ease-in-out",
                  }}
                ></div>
              </div>

              <div style={{ width: "100px", textAlign: "right" }}>
                <span
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: "bold",
                    color: "#0f172a",
                  }}
                >
                  {machineryStats.warning}
                </span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "#64748b",
                    marginLeft: "6px",
                  }}
                >
                  equipment
                </span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px",
                border: "1px solid #f1f5f9",
                borderRadius: "12px",
                backgroundColor: "white",
              }}
            >
              <div
                style={{
                  width: "50px",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    backgroundColor: "#fee2e2",
                    padding: "8px",
                    borderRadius: "20%",
                    color: "#dc2626",
                  }}
                >
                  <AlertOctagon size={20} />
                </div>
              </div>

              <div style={{ width: "150px", paddingLeft: "12px" }}>
                <div style={{ fontWeight: "600", color: "#334155" }}>
                  Critical
                </div>
                
              </div>

              <div
                style={{
                  flex: 1,
                  height: "12px",
                  backgroundColor: "#f1f5f9",
                  borderRadius: "6px",
                  margin: "0 24px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${getPercentage(machineryStats.critical)}%`,
                    height: "100%",
                    backgroundColor: "#ef4444",
                    borderRadius: "6px",
                    transition: "width 0.5s ease-in-out",
                  }}
                ></div>
              </div>

              <div style={{ width: "100px", textAlign: "right" }}>
                <span
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: "bold",
                    color: "#0f172a",
                  }}
                >
                  {machineryStats.critical}
                </span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "#64748b",
                    marginLeft: "6px",
                  }}
                >
                  equipment
                </span>
              </div>
            </div>
          </CardContent>
        )}
      </Card> */}

      {/* Main Matrix Table */}
      {/* Main Matrix Table */}
      {selectedVesselName && (
        <Card
          ref={reportsSectionRef}
          className="enhanced-card lub-report-history-card"
        >
          <CardHeader className="lub-report-header">
            <div className="lub-report-header-left">
              <div className="lub-report-icon-box">
                <FileText size={24} color="white"className="lub-header-icon" />
              </div>
              <div className="lub-report-title-info">
                <CardTitle
                  className="lub-report-title"
                >
                  {selectedVesselName} - Report History
                </CardTitle>
                <p className="lub-report-subtitle">
                  Raw PDF Reports available for download/preview
                </p>
              </div>
            </div>

            <div className="lub-report-header-actions">
              {selectedLubReports.length > 0 && (
                <Button
                  onClick={handleLubBatchDownload}
                  disabled={isDownloading} // Prevents double-clicking
                  className={`lub-batch-download-btn ${isDownloading ? 'is-loading' : ''}`}
                >
                  {isDownloading ? (
                    <>
                      <Activity size={16} className="animate-spin" />
                      <span>Preparing ZIP...</span>
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      <span>Download {selectedLubReports.length} Selected</span>
                    </>
                  )}
                </Button>
              )}

              <Button
                onClick={() => {
                  setSelectedVesselName(null);
                  setVesselReports([]);
                  setSelectedLubReports([]);
                }}
                className="lub-report-close-btn"
              >
                <X size={20} />
              </Button>
            </div>
          </CardHeader>

          <CardContent
            className="lub-report-table-area"
          >
            {loadingReports ? (
              <div className="loading-state-enhanced">
                <div className="loading-spinner"></div>
              </div>
            ) : vesselReports.length > 0 ? (
              <table className="lub-report-table">
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    backgroundColor: "#f1f5f9",
                    zIndex: 1,
                  }}
                >
                  <tr>
                    <th className="col-check">
                      <input
                        type="checkbox"
                        className="lub-checkbox"
                        checked={
                          selectedLubReports.length === vesselReports.length &&
                          vesselReports.length > 0
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedLubReports(
                              vesselReports.map((r) => r.report_id),
                            );
                          } else {
                            setSelectedLubReports([]);
                          }
                        }}
                      />
                    </th>
                    <th className="col-date">Report Date</th>
                    <th className="col-action">Lube Oil Report</th>

                  </tr>
                </thead>
                <tbody>
                  {vesselReports.map((report, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          className="lub-checkbox"
                          checked={selectedLubReports.includes(
                            report.report_id,
                          )}
                          onChange={() => {
                            setSelectedLubReports((prev) =>
                              prev.includes(report.report_id)
                                ? prev.filter((id) => id !== report.report_id)
                                : [...prev, report.report_id],
                            );
                          }}
                        />
                      </td>
                      <td className="col-date-text">
                        {report.report_date
                          ? new Date(report.report_date).toLocaleDateString(
                            "en-GB",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "2-digit",
                            },
                          )
                          : "N/A"}
                      </td>
                      <td className="col-action">
                        <Button
                          onClick={() =>
                            window.open(
                              report.report_url || report.url,
                              "_blank",
                            )
                          }
                          disabled={!report.report_url && !report.url}
                          className="lub-preview-btn"
                        >
                          <Eye size={14} /> Preview
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="lub-report-empty">No reports found.</div>
            )}
          </CardContent>
        </Card>
      )}
      {/* ----------------- MODAL START ----------------- */}
      {isModalOpen && selectedCell && (
        <div className="lub-modal-overlay">
          {/* â”€â”€ OUTER MODAL SHELL â”€â”€ */}
          <div className="lub-modal-shell">
            {/* â”€â”€ MODAL TOP BAR (vessel name + close) â”€â”€ */}
            <div className="lub-modal-header">
              <div className="lub-modal-header-info">
                <h3 className="modal-vessel-title">{selectedCell.vessel}</h3>
                <span className="modal-machinery-subtitle">{selectedCell.machinery}</span>
                <div className="modal-date-pill">
                  Report Date:
                  <span className="modal-date-text">
                    {new Date(
                      selectedCell.data.report_date ||
                      selectedCell.data.date ||
                      selectedCell.data.sample_date,
                    ).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {/* Status pill */}
                {/* <span
            style={{
              padding: "3px 10px",
              borderRadius: "20px",
              fontSize: "0.7rem",
              fontWeight: "800",
              backgroundColor:
                selectedCell.data.status?.toLowerCase() === "normal"
                  ? "#dcfce7"
                  : selectedCell.data.status?.toLowerCase() === "warning" ||
                    selectedCell.data.status?.toLowerCase() === "attention"
                  ? "#fef9c3"
                  : "#fee2e2",
              color:
                selectedCell.data.status?.toLowerCase() === "normal"
                  ? "#166534"
                  : selectedCell.data.status?.toLowerCase() === "warning" ||
                    selectedCell.data.status?.toLowerCase() === "attention"
                  ? "#854d0e"
                  : "#991b1b",
            }}
          >
            {selectedCell.data.status || "N/A"}
          </span> */}
              </div>

              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setRightPanelMode("report");
                  setIsResamplingActive(false);
                  setCompareIds([]);
                  setIsLinkGenerated(false);
                  setIsDiagExpanded(false);
                }}
                className="modal-close-btn"
              >
                <X size={24} className="modal-close-icon" />
              </button>
            </div>

            {/* â”€â”€ THREE-PANEL ROW â”€â”€ */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "row",
                overflow: "hidden",
                minHeight: 0,
              }}
            >
              {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            PANEL 1 â€” DIAGNOSIS  (flex: 1)
            - Fully scrollable body
            - Reduced font sizes throughout
            - Upload + View Evidence on one row
            - Collapsible ACTIONS section
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
              <div className={`lub-diag-panel ${isDiagCollapsed ? "collapsed" : ""}`}>
                {/* â”€â”€ Panel Header (sticky, click to collapse whole panel) â”€â”€ */}
                <div className="lub-diag-header" onClick={() => setIsDiagCollapsed(!isDiagCollapsed)}>
                  <div className="lub-header-left">
                    <Activity size={14} color="#2563eb" className="lub-header-icon" />
                    {!isDiagCollapsed && (
                      <span className="lub-header-title">Lab Diagnosis & Evidence</span>
                    )}
                  </div>
                  <div className="lub-header-right">
                    {!isDiagCollapsed && (
                      <div className="lub-status-icon-wrapper">
                        <ShellStatusIcon
                          status={selectedCell.data.status}
                          size={18}
                        />
                      </div>
                    )}
                    {isDiagCollapsed ? (
                      <ChevronDown size={14} className="lub-arrow-icon" />
                    ) : (
                      <ChevronUp size={14} className="lub-arrow-icon" />
                    )}
                  </div>
                </div>

                {/* â”€â”€ Panel Body: ONE scrollable area for everything â”€â”€ */}
                {!isDiagCollapsed && (
                  <div className="lub-diag-body">
                    {/* 1 â”€â”€ DETECTED ANOMALIES */}
                    {selectedCell.data.summary_error && (
                      <div className="lub-anomaly-box">
                        <div className="lub-anomaly-header">
                          <AlertTriangle size={13} color="#c2410c" className="lub-anomaly-icon" />
                          <h5 className="lub-anomaly-title">Detected Anomalies</h5>
                        </div>
                        <ul className="lub-anomaly-list">
                          {selectedCell.data.summary_error
                            .split(" & ")
                            .map((alert, idx) => (
                              <li key={idx} className="lub-anomaly-item">
                                {alert}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}

                    {/* 2 â”€â”€ TECHNICAL ANALYSIS ACCORDION */}
                    {selectedCell.data.diagnosis ? (
                      <div className="lub-diag-accordion">
                        <button
                          onClick={() => setIsDiagExpanded(!isDiagExpanded)}
                          className="lub-accordion-trigger"
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = "#f1f5f9")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = "#f8fafc")
                          }
                        >
                          <div className="lub-accordion-label-box">
                            <FileText size={13} color="#64748b" className="lub-accordion-icon" />
                            <span className="lub-accordion-label">
                              Technical Analysis & Recommendations
                            </span>
                          </div>
                          {isDiagExpanded ? (
                            <ChevronUp size={14} color="#94a3b8" className="lub-arrow-icon" />
                          ) : (
                            <ChevronDown size={14} color="#94a3b8" className="lub-arrow-icon" />
                          )}
                        </button>

                        {isDiagExpanded && (
                          <div className="lub-accordion-content">
                            <div style={{ position: "relative" }}>
                              <div className="quote-mark">"</div>
                              <div className="lub-diagnosis-text">
                                {formatDiagnosisAsList(
                                  selectedCell.data.diagnosis,
                                )}
                              </div>
                            </div>
                            <div className="lub-source-tag">
                              SOURCE: {selectedCell.data.lab_name || "SHELL LUBEANALYST"}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="lub-diag-empty-state">
                        <AlertCircle size={22} className="empty-icon" />
                        <p className="empty-text">No lab diagnosis found.</p>
                      </div>
                    )}

                    {/* 3 â”€â”€ ACTIONS (collapsible section) */}
                    <div className="lub-evidence-section">

                      {/* Actions header â€” click to collapse/expand */}
                      <div
                        onClick={() =>
                          setIsActionsCollapsed(!isActionsCollapsed)
                        }
                        className="lub-evidence-header"
                      >
                        <span className="lub-section-label">Evidence</span>
                        {isActionsCollapsed ? (
                          <ChevronDown size={13} color="#94a3b8" className="lub-arrow-icon" />
                        ) : (
                          <ChevronUp size={13} color="#94a3b8" className="lub-arrow-icon" />
                        )}
                      </div>

                      {/* Actions body */}
                      {!isActionsCollapsed && (
                        <div className="lub-evidence-body">
                          {/* ROLE-BASED IMAGE REQUIREMENT TOGGLE */}
                          {(() => {
                            const _userData = user?.user || user;
                            const _userAccess = (
                              _userData?.access_type ||
                              _userData?.accessType ||
                              ""
                            ).toUpperCase();
                            const _userRole = (
                              _userData?.role || ""
                            ).toUpperCase();
                            const isShore =
                              _userAccess === "SHORE" ||
                              _userRole === "ADMIN" ||
                              _userRole === "SUPERUSER" ||
                              _userRole === "SHORE";

                            const isImageRequired =
                              selectedCell.data.is_image_required;
                            const isResamplingRequired =
                              selectedCell.data.is_resampling_required; // New Flag
                            const isLocked = selectedCell.data.is_resolved;

                            if (isShore) {
                              return (
                                <div className="lub-mandatory-group">
                                  {/* --- EXISTING IMAGE BUTTON (UNCHANGED) --- */}
                                  <button
                                    onClick={handleRequestImageAction}
                                    disabled={isLocked}
                                    className={`lub-mandatory-btn ${isImageRequired ? "active-red" : "inactive-dashed"}`}
                                  >
                                    {isImageRequired ? (
                                      <><AlertTriangle size={12} className="lub-mandatory-icon animate-pulse" /> IMAGE MANDATORY</>
                                    ) : (
                                      <><ImageIcon size={12} className="lub-mandatory-icon" /> IMAGE MANDATORY</>
                                    )}
                                  </button>

                                  {/* --- NEW RESAMPLING BUTTON (MATCHING STYLE) --- */}
                                  <button
                                    onClick={handleRequestResamplingAction}
                                    disabled={isLocked}
                                    className={`lub-mandatory-btn ${isResamplingRequired ? "active-red" : "inactive-dashed"}`}
                                  >
                                    {isResamplingRequired ? (
                                      <><History size={12} className="lub-mandatory-icon animate-pulse" /> RESAMPLING MANDATORY</>
                                    ) : (
                                      <><History size={12} className="lub-mandatory-icon" /> RESAMPLING MANDATORY</>
                                    )}

                                  </button>
                                </div>
                              );
                            }

                            if (
                              !isShore &&
                              (isImageRequired || isResamplingRequired)
                            ) {
                              return (
                                <div className="lub-mandatory-group">
                                  {/* --- EXISTING IMAGE BANNER (UNCHANGED) --- */}
                                  {isImageRequired && (
                                    <div className="lub-mandatory-banner">
                                      <AlertTriangle size={12} className="lub-mandatory-icon animate-pulse" /> IMAGE UPLOAD MANDATORY
                                    </div>
                                  )}

                                  {/* --- NEW RESAMPLING BANNER (MATCHING STYLE) --- */}
                                  {isResamplingRequired && (
                                    <div className="lub-mandatory-banner">
                                      <History size={12} className="lub-mandatory-icon animate-pulse" /> RESAMPLING REQUIRED
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          })()}

                          {/* UPLOAD + VIEW EVIDENCE â€” side by side on one row */}
                          <div className="lub-evidence-action-row">
                            {/* Upload */}
                            <input
                              type="file"
                              id="lub-sidebar-upload"
                              hidden
                              accept="*"
                              onChange={(e) =>
                                handleSidebarUpload(e.target.files[0])
                              }
                            />
                            {!selectedCell.data.is_resolved && (
                              <button
                                onClick={() =>
                                  document
                                    .getElementById("lub-sidebar-upload")
                                    .click()
                                }
                                className="lub-action-btn btn-primary"
                              >
                                <Upload size={11} className="lub-btn-icon" /> Upload
                              </button>
                            )}

                            {/* View Evidence */}
                            <button
                              onClick={() => setIsEvidenceModalOpen(true)}
                              className="lub-action-btn btn-secondary"
                            >
                              <Eye size={11} className="lub-btn-icon" /> View (
                              {selectedCell.data.conversation?.filter(
                                (m) =>
                                  m.message?.includes("ATTACHED_IMAGE:") ||
                                  m.message?.includes("ATTACHED_PDF:"),
                              ).length || 0}
                              )
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 4 â”€â”€ RESAMPLING WITH LINK (shore-only) */}
                    {(user?.access_type === "SHORE" ||
                      user?.role === "admin" ||
                      user?.role === "superuser" ||
                      user?.role === "shore") && (
                        <div className="lub-resample-section">
                          <button
                            onClick={() => {
                              if (isResamplingActive) {
                                setRightPanelMode("report");
                                setCompareIds([]);
                                setIsLinkGenerated(false);
                                setIsResamplingActive(false);
                              } else {
                                // Keep current sample ID as the first ID in comparison
                                setCompareIds([selectedCell.data.sample_id]);
                                setIsResamplingActive(true);
                              }
                            }}
                            className={`lub-resample-toggle-btn ${isResamplingActive ? "active-cancel" : ""}`}
                          >
                            <History size={13} className="lub-resample-icon" />
                            {isResamplingActive
                              ? "CANCEL"
                              : "LINK WITH RESAMPLING"}
                          </button>

                          {isResamplingActive && (
                            <div className="lub-resample-config-box">
                              {!isLinkGenerated ? (
                                <>
                                  <p className="lub-resample-label">Select Report:</p>
                                  <div className="lub-resample-list">
                                    {(() => {
                                      // 1. Get the date of the current selected report
                                      const currentReportDate = new Date(
                                        selectedCell.data.date ||
                                        selectedCell.data.last_sample,
                                      );

                                      // 2. Filter history for reports that occur AFTER the current one
                                      const futureReports =
                                        selectedCell.data.history?.filter((h) => {
                                          const hDate = new Date(
                                            h.date || h.sample_date,
                                          );
                                          // Ensure it's in the future and NOT the same sample
                                          return (
                                            hDate > currentReportDate &&
                                            h.sample_id !==
                                            selectedCell.data.sample_id
                                          );
                                        });

                                      if (
                                        futureReports &&
                                        futureReports.length > 0
                                      ) {
                                        return futureReports.map((item) => (
                                          <label key={item.sample_id} className={`lub-resample-item ${compareIds.includes(item.sample_id) ? "selected" : ""}`}>
                                            <input
                                              type="checkbox"
                                              checked={compareIds.includes(
                                                item.sample_id,
                                              )}
                                              onChange={() => {
                                                if (
                                                  compareIds.includes(
                                                    item.sample_id,
                                                  )
                                                ) {
                                                  // Reset back to just the current report if unchecked
                                                  setCompareIds([
                                                    selectedCell.data.sample_id,
                                                  ]);
                                                } else {
                                                  // Select this future report as the second comparison point
                                                  setCompareIds([
                                                    selectedCell.data.sample_id,
                                                    item.sample_id,
                                                  ]);
                                                }
                                              }}
                                            // style={{
                                            //   width: "13px",
                                            //   height: "13px",
                                            // }}
                                            />
                                            <div className="lub-item-info">
                                              <span className="date-txt">{item.date}</span>
                                              <span className="status-txt" style={{ color: getStatusColor(item.status) }}>{item.status}</span>
                                            </div>
                                          </label>
                                        ));
                                      } else {
                                        // If no reports are newer than the currently selected one
                                        return (
                                          <div className="lub-resample-empty">
                                            <p>No Subsequent Reports Available.</p>
                                          </div>
                                        );
                                      }
                                    })()}
                                  </div>

                                  <button
                                    disabled={compareIds.length !== 2}
                                    onClick={() => setIsLinkGenerated(true)}
                                    className="lub-resample-generate-btn"
                                  >
                                    GENERATE LINK
                                  </button>
                                </>
                              ) : (
                                <div className="lub-generated-link-area">
                                  <p className="lub-resample-label">Resampling Comparison:</p>
                                  <div className="lub-link-display-box">
                                    {(() => {
                                      // 1. Get the date of the primary opened report
                                      const firstDate =
                                        selectedCell.data.date ||
                                        selectedCell.data.sample_date;

                                      // 2. Find the date of the second selected report from the history array
                                      const targetId = compareIds.find(
                                        (id) =>
                                          id !== selectedCell.data.sample_id,
                                      );
                                      const targetSample =
                                        selectedCell.data.history?.find(
                                          (h) => h.sample_id === targetId,
                                        );
                                      const secondDate =
                                        targetSample?.date || "Subsequent";

                                      // 3. Mixed Parameters String: Domain / Vessel / Machinery / Date & Date
                                      const mixedLinkDisplay = `${window.location.origin} / ${selectedCell.vessel} / ${selectedCell.machinery} / ${firstDate} & ${secondDate}`;

                                      return (
                                        <a
                                          href="#"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            setRightPanelMode("resampling_view");
                                            setIsDiagExpanded(false);
                                          }}
                                          className="lub-resample-link"
                                        >
                                          {mixedLinkDisplay}
                                        </a>
                                      );
                                    })()}
                                  </div>
                                  <button
                                    onClick={() => {
                                      setIsLinkGenerated(false);
                                      setCompareIds([
                                        selectedCell.data.sample_id,
                                      ]);
                                    }}
                                    className="lub-resample-change-btn"
                                  >
                                    Change Selected Reports
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                )}
                {/* {selectedCell.data.status?.toLowerCase() !== "normal" && ( */}
                <div className="lub-diag-footer">
                  <div className="lub-footer-flex">
                    {/* --- BUTTON 1: STATUS BUTTON (CLOSE / PENDING / CLOSED) --- */}
                    <button
                      // 1. Disable if resolved, awaiting approval, or submitting
                      disabled={
                        selectedCell.data.is_resolved ||
                        selectedCell.data.is_approval_pending ||
                        isSubmittingClose
                      }
                      // 2. Only allow opening the modal if it's not already resolved or pending
                      onClick={() => {
                        if (
                          !selectedCell.data.is_resolved &&
                          !selectedCell.data.is_approval_pending
                        ) {
                          setIsCloseModalOpen(true);
                        }
                      }}
                      className="lub-main-status-btn"
                      style={{
                        backgroundColor: selectedCell.data.is_resolved
                          ? "#94a3b8"
                          : selectedCell.data.is_approval_pending
                            ? "#f59e0b"
                            : "#059669",
                        cursor: (selectedCell.data.is_resolved || selectedCell.data.is_approval_pending) ? "not-allowed" : "pointer",
                        opacity: (selectedCell.data.is_resolved || selectedCell.data.is_approval_pending) ? 0.8 : 1,
                      }}
                    >
                      {/* 6. Dynamic Icon & Text Logic (Preserved) */}
                      {selectedCell.data.is_resolved ? (
                        <>
                          <CheckCircle size={16} className="lub-footer-icon" />
                          CLOSED
                        </>
                      ) : selectedCell.data.is_approval_pending ? (
                        <>
                          <Clock size={16} className="lub-footer-icon" />
                          PENDING APPROVAL
                        </>
                      ) : (
                        <>
                          <CheckCircle size={16} className="lub-footer-icon" />
                          CLOSE
                        </>
                      )}
                    </button>

                    {/* --- BUTTON 2: REOPEN BUTTON (ONLY FOR SHORE WHEN CLOSED) --- */}
                    {selectedCell.data.is_resolved && amIShore && (
                      <button
                        onClick={handleReopenIssue}
                        disabled={isSubmittingClose}
                        className="lub-reopen-btn"
                      >
                        <History size={16} />
                        REOPEN ISSUE
                      </button>
                    )}
                  </div>
                </div>
                {/* )} */}
              </div>

              {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            PANEL 2 â€” PDF REPORT  (flex: 1.8)
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
              <div className={`lub-pdf-panel ${isReportCollapsed ? "collapsed" : ""}`}>
                {/* Panel Header */}
                <div className="lub-pdf-header" onClick={() => setIsReportCollapsed(!isReportCollapsed)}>
                  <div className="lub-header-left">
                    <FileText size={16} color="#2563eb" className="lub-header-icon" />
                    {!isReportCollapsed && (
                      <span className="lub-header-title">Analysis Report</span>
                    )}
                  </div>
                  {isReportCollapsed ? (
                    <ChevronDown size={16} color="#64748b" className="lub-arrow-icon" />
                  ) : (
                    <ChevronUp size={16} color="#64748b" className="lub-arrow-icon" />
                  )}
                </div>

                {/* Panel Body */}
                {!isReportCollapsed && (
                  <div className="lub-pdf-body">
                    {/* RESAMPLING VIEW (takes over PDF panel when active) */}
                    {rightPanelMode === "resampling_view" ? (
                      <div className="lub-pdf-split-container">
                        {/* Left: The report originally opened in the modal (September in your example) */}
                        <div className="lub-pdf-sub-panel">
                          <div className="lub-pdf-sub-header header-blue">
                            <span className="date-label">OPENED: {selectedCell.data.date || selectedCell.data.sample_date}</span>
                            <span className="type-label">Extracted Page</span>
                          </div>
                          <iframe
                            src={`/lub/api/luboil/view-specific-page/${selectedCell.data.sample_id}`}
                            // src={`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8002"}/api/luboil/view-specific-page/${selectedCell.data.sample_id}`}
                            style={{ width: "100%", flex: 1, border: "none" }}
                            title="Opened View"
                          />
                        </div>

                        {/* Right: The future resampling report selected from the list (November in your example) */}
                        {(() => {
                          const targetId = compareIds.find(
                            (id) => id !== selectedCell.data.sample_id,
                          );
                          // Find the specific date for the targetId from the history array
                          const targetSample = selectedCell.data.history?.find(
                            (h) => h.sample_id === targetId,
                          );
                          const targetDate =
                            targetSample?.date || "Newer Report";

                          return (
                            <div className="lub-pdf-sub-panel">
                              <div className="lub-pdf-sub-header header-gray">
                                <span className="date-label">SUBSEQUENT: {targetDate}</span>
                                <span className="type-label">Extracted Page</span>
                              </div>
                              <iframe
                                src={`/lub/api/luboil/view-specific-page/${targetId}`}
                                // src={`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8002"}/api/luboil/view-specific-page/${targetId}`}
                                style={{
                                  width: "100%",
                                  flex: 1,
                                  border: "none",
                                }}
                                title="Future View"
                              />
                            </div>
                          );
                        })()}
                      </div>
                    ) : selectedCell.data.report_url ? (
                      <iframe
                        src={`/lub/api/luboil/view-specific-page/${selectedCell.data.sample_id}`}
                        // src={`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8002"}/api/luboil/view-specific-page/${selectedCell.data.sample_id}`}
                        style={{ width: "100%", flex: 1, border: "none" }}
                        title="Original Report"
                      />
                    ) : (
                      <div className="lub-pdf-empty">
                        <FileText size={40} className="empty-icon" />
                        <p className="empty-text">No PDF report available for this sample.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
            PANEL 3 â€” COMMUNICATION  (flex: 1.2)
        â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
              <div
                style={{
                  flex: isCommCollapsed ? "0 0 45px" : 1.2,
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: "white",
                  overflow: "hidden",
                  transition: "flex 0.3s ease",
                }}
              >
                {/* Panel Header */}
                <div className="lub-chat-header"
                  onClick={() => setIsCommCollapsed(!isCommCollapsed)}
                >
                  <div className="lub-header-left">
                    <MessageSquareText size={16} color="#2563eb" className="lub-header-icon" />
                    {!isCommCollapsed && (
                      <span className="lub-header-title">Communication</span>
                    )}
                  </div>
                  {isCommCollapsed ? (
                    <ChevronDown size={16} color="#64748b" className="lub-arrow-icon" />
                  ) : (
                    <ChevronUp size={16} color="#64748b" className="lub-arrow-icon" />
                  )}
                </div>

                {/* Panel Body â€” the full chat UI */}
                {!isCommCollapsed &&
                  (() => {
                    const userData = user?.user || user;
                    const userAccess = (
                      userData?.access_type ||
                      userData?.accessType ||
                      ""
                    ).toUpperCase();
                    const userRole = (userData?.role || "").toUpperCase();

                    const amIShore =
                      userAccess === "SHORE" ||
                      userRole === "ADMIN" ||
                      userRole === "SUPERUSER" ||
                      userRole === "SHORE" ||
                      userRole === "SUPERINTENDENT";

                    // Input change handler
                    const handleInputChange = async (val) => {
                      if (chatMode === "internal") {
                        setInternalDraft(val);
                      } else {
                        if (amIShore) {
                          setRemarksData((prev) => ({ ...prev, office: val }));
                        } else {
                          setRemarksData((prev) => ({ ...prev, officer: val }));
                        }
                      }
                      const parts = val.split(/[\s\n]/);
                      const lastWord = parts[parts.length - 1];
                      if (lastWord.startsWith("@")) {
                        const query = lastWord.slice(1).toLowerCase();
                        setMentionFilter(query);
                        try {
                          const users = (
                            await axiosLub.get(
                              `/api/luboil/mentions/${selectedCell.data.imo}?chat_mode=${chatMode}`,
                            )
                          ).data;
                          setMentionList(Array.isArray(users) ? users : []);
                          setShowMentionDropdown(true);
                        } catch (err) {
                          console.error("Failed to fetch mentions", err);
                        }
                      } else {
                        setShowMentionDropdown(false);
                      }
                    };

                    const applyMention = (targetName) => {
                      const currentVal =
                        chatMode === "internal"
                          ? internalDraft
                          : amIShore
                            ? remarksData.office
                            : remarksData.officer;
                      const parts = currentVal.split(/[\s\n]/);
                      parts.pop();
                      const newVal = [...parts, `@${targetName} `].join(" ");
                      if (chatMode === "internal") {
                        setInternalDraft(newVal);
                      } else {
                        setRemarksData((prev) => ({
                          ...prev,
                          [amIShore ? "office" : "officer"]: newVal,
                        }));
                      }
                      setTimeout(() => chatInputRef.current?.focus(), 0);
                      setShowMentionDropdown(false);
                    };

                    return (
                      <div className={`lub-chat-wrapper chat-mode-${chatMode}`}>
                        {/* CHAT MODE TOGGLE (shore only) */}
                        {amIShore && (
                          <div className="lub-chat-toggle-bar">
                            <button
                              onClick={() => {
                                setChatMode("external");
                                setShowMentionDropdown(false);
                              }}
                              className={`lub-toggle-pill ${chatMode === "external" ? "active-external" : ""}`}
                            >
                              EXTERNAL CHAT
                            </button>
                            <button
                              onClick={() => {
                                setChatMode("internal");
                                setShowMentionDropdown(false);
                              }}
                              className={`lub-toggle-pill ${chatMode === "internal" ? "active-internal" : ""}`}
                            >
                              INTERNAL CHAT
                            </button>
                          </div>
                        )}

                        {/* â”€â”€ MESSAGES AREA (flex: 1, scrollable) â”€â”€ */}
                        <div className="lub-msg-scroll-area">
                          {selectedCell.data.conversation
                            ?.filter((msg) =>
                              chatMode === "internal"
                                ? msg.is_internal === true
                                : msg.is_internal !== true,
                            )
                            .map((msg, idx) => {
                              const isSystem = msg.role === "System";
                              const isFileAttachment =
                                msg.message.includes("ATTACHED_IMAGE:") ||
                                msg.message.includes("ATTACHED_PDF:");
                              if (isFileAttachment) return null;

                              const msgUserData = user?.user || user;
                              const uAccess = (
                                msgUserData?.access_type ||
                                msgUserData?.accessType ||
                                ""
                              ).toUpperCase();
                              const uRole = (
                                msgUserData?.role || ""
                              ).toUpperCase();
                              const amIShoreMsg =
                                uAccess === "SHORE" ||
                                uRole === "ADMIN" ||
                                uRole === "SUPERUSER" ||
                                uRole === "SHORE" ||
                                uRole === "SUPERINTENDENT";

                              // Centered System Log
                              if (isSystem)
                                return (
                                  <div key={idx} className="lub-system-log">
                                    <span className="log-pill">
                                      <span
                                        dangerouslySetInnerHTML={{
                                          __html: msg.message,
                                        }}
                                      />{" "}
                                      {msg.date}
                                    </span>
                                  </div>
                                );

                              // Extract sender name and clean body
                              let senderNameInMsg = msg.role;
                              let cleanBody = msg.message;
                              if (msg.message.includes(": ")) {
                                const splitPoint = msg.message.indexOf(": ");
                                senderNameInMsg = msg.message
                                  .substring(0, splitPoint)
                                  .trim();
                                cleanBody = msg.message.substring(
                                  splitPoint + 2,
                                );
                              }

                              const isMe =
                                senderNameInMsg.toLowerCase() ===
                                user?.full_name?.toLowerCase();

                              // Full-name mention highlighter
                              const renderVerifiedMessage = (text) => {
                                // 1. Guard clause
                                if (!text)
                                  return (
                                    <span style={{ fontWeight: "400" }}>
                                      {text}
                                    </span>
                                  );

                                // THE FIX: Get your own name from the auth state
                                const myName = user?.full_name || "";

                                // Create a combined list: the API mention list + your own name
                                const allNamesToHighlight = [
                                  ...(mentionList || []),
                                ];

                                // If your name isn't already in the list, add it so @YourName turns blue too
                                if (
                                  myName &&
                                  !allNamesToHighlight.some(
                                    (u) =>
                                      u.full_name?.toLowerCase() ===
                                      myName.toLowerCase(),
                                  )
                                ) {
                                  allNamesToHighlight.push({
                                    full_name: myName,
                                  });
                                }

                                // If no names are found to highlight, return plain text
                                if (allNamesToHighlight.length === 0) {
                                  return (
                                    <span style={{ fontWeight: "400" }}>
                                      {text}
                                    </span>
                                  );
                                }

                                // 2. Sort users by name length to prevent partial matches (e.g., "Gokul D" before "Gokul")
                                const sortedUsers = allNamesToHighlight.sort(
                                  (a, b) =>
                                    (b.full_name || b.name || "").length -
                                    (a.full_name || a.name || "").length,
                                );

                                let contentParts = [text];

                                sortedUsers.forEach((targetUser) => {
                                  const userName =
                                    targetUser.full_name ||
                                    targetUser.name ||
                                    "";
                                  // Escapes special characters and ensures boundary checks
                                  const pattern = new RegExp(
                                    `(@${userName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")})(?=[\\s\\n.,!?;:]|$)`,
                                    "gi",
                                  );

                                  let nextParts = [];
                                  contentParts.forEach((part) => {
                                    if (typeof part !== "string") {
                                      nextParts.push(part);
                                      return;
                                    }

                                    const splitArr = part.split(pattern);
                                    splitArr.forEach((sub) => {
                                      // Case-insensitive check to see if the part is the mention
                                      if (
                                        sub.toLowerCase() ===
                                        `@${userName}`.toLowerCase()
                                      ) {
                                        nextParts.push(
                                          <span
                                            key={`${userName}-${Math.random()}`}
                                            style={{
                                              fontWeight: "600",
                                              color: "#00a5f4", // âœ¨ EXACT WHATSAPP MENTION BLUE
                                              display: "inline",
                                              pointerEvents: "none", // Keeps bubble clickable while maintaining color
                                            }}
                                          >
                                            {sub}
                                          </span>,
                                        );
                                      } else if (sub !== "") {
                                        nextParts.push(sub);
                                      }
                                    });
                                  });
                                  contentParts = nextParts;
                                });

                                return contentParts.map((p, i) =>
                                  typeof p === "string" ? (
                                    <span key={i} style={{ fontWeight: "400" }}>
                                      {p}
                                    </span>
                                  ) : (
                                    p
                                  ),
                                );
                              };
                              return (
                                <div key={idx} className={`lub-msg-row ${isMe ? 'row-me' : 'row-them'}`}>
                                  <div className={`lub-msg-bubble ${isMe ? 'bubble-me' : 'bubble-them'}`}>
                                    {/* Header: name | role */}
                                    <div className="bubble-header">
                                      <span className="sender-name">
                                        {senderNameInMsg}
                                      </span>
                                      <span className="sender-role">
                                        {msg.role === "Office"
                                          ? "Office"
                                          : "Vessel"}
                                      </span>
                                    </div>

                                    {/* Body */}
                                    <div className="bubble-text">{renderVerifiedMessage(cleanBody)}</div>

                                    {/* Footer: timestamp */}
                                    <div className="bubble-footer">{msg.date}</div>
                                  </div>
                                </div>
                              );
                            })}
                          <div ref={chatEndRef} />
                        </div>

                        {/* â”€â”€ QUICK ACTIONS FOOTER (always pinned, never pushed up) â”€â”€ */}
                        <div
                          style={{
                            flexShrink: 0,
                            backgroundColor: "#f8fafc",
                            borderTop: "1px solid #e2e8f0",
                            padding: "10px 14px",
                            position: "relative",
                          }}
                        >
                          {/* 1. APPROVAL CARD - Original logic preserved exactly */}
                          {selectedCell.data.is_approval_pending &&
                            amIShore &&
                            !selectedCell.data.is_resolved && (
                              <div className="lub-approval-card">
                                <div className="card-header">
                                  <Clock size={16} color="#d97706" />
                                  Resolution Awaiting Approval
                                </div>

                                <div className="card-quote">"{selectedCell.data.resolution_remarks}"</div>

                                <div className="card-actions">
                                  <button
                                    onClick={() =>
                                      handleShoreApproval("ACCEPT")
                                    }
                                    disabled={isSubmittingClose}
                                    className="btn-accept"
                                  >
                                    <CheckCircle size={14} /> ACCEPT
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleShoreApproval("DECLINE")
                                    }
                                    disabled={isSubmittingClose}
                                    className="btn-decline"
                                  >
                                    <X size={14} /> DECLINE
                                  </button>
                                </div>
                              </div>
                            )}

                          {/* ðŸ”¥ GATING LOGIC: If resolved, show Locked UI. If not resolved, show original chat UI */}
                          {selectedCell.data.is_resolved ? (
                            <div className="lub-locked-ui">
                              <X size={18} style={{ opacity: 0.5 }} />
                              <span className="lock-title">COMMUNICATION LOCKED</span>
                              <span className="lock-desc">
                                This issue is closed.{" "}
                                {amIShore
                                  ? "Use REOPEN button below to enable chat."
                                  : "Only Shore staff can reopen this issue."}
                              </span>
                            </div>
                          ) : (
                            <>
                              {/* Mention dropdown - Original preserved */}
                              {showMentionDropdown &&
                                mentionList.length > 0 && (
                                  <div className="lub-mention-dropdown">
                                    <div className="mention-dropdown-header">
                                      ASSIGNED TO THIS VESSEL
                                    </div>
                                    <div className="mention-dropdown-scroll">
                                      {(mentionList || [])
                                        .filter((u) =>
                                          u.full_name
                                            ?.toLowerCase()
                                            .includes(mentionFilter),
                                        )
                                        .map((u, i) => (
                                          <div
                                            key={i}
                                            onClick={() =>
                                              applyMention(u.full_name)
                                            }
                                            className="mention-dropdown-item"
                                          >
                                            <span className="mention-user-name">
                                              {u.full_name}
                                            </span>
                                            <span className="mention-user-detail">
                                              {u.job_title || "User"} {u.role}
                                            </span>
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                )}

                              {chatMode === "internal" && (
                                <div className="internal-indicator">
                                  INTERNAL NOTE (SHORE ONLY)
                                </div>
                              )}

                              {/* Input row - Original preserved */}
                              <div className={`lub-chat-input-box ${chatMode === 'internal' ? 'box-internal' : ''}`}>
                                <textarea
                                  ref={chatInputRef}
                                  value={
                                    chatMode === "internal"
                                      ? internalDraft
                                      : amIShore
                                        ? remarksData.office
                                        : remarksData.officer
                                  }
                                  onChange={(e) =>
                                    handleInputChange(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      if (
                                        showMentionDropdown &&
                                        mentionList.length > 0
                                      ) {
                                        const filtered = (mentionList || []).filter(
                                          (u) =>
                                            u.full_name
                                              .toLowerCase()
                                              .includes(mentionFilter),
                                        );
                                        if (filtered.length > 0) {
                                          e.preventDefault();
                                          applyMention(filtered[0].full_name);
                                        }
                                      } else {
                                        e.preventDefault();
                                        handleSendMessage();
                                      }
                                    }
                                    if (e.key === "Escape")
                                      setShowMentionDropdown(false);
                                  }}
                                  placeholder={
                                    chatMode === "internal"
                                      ? "Type an internal note..."
                                      : "Type a message..."
                                  }
                                  className="lub-chat-field"
                                />
                                <button
                                  onClick={handleSendMessage}
                                  className="lub-chat-send-btn"
                                >
                                  <SendHorizontal
                                    size={18}
                                    color="white"
                                    strokeWidth={2.5}
                                    className="send-icon"
                                  />
                                </button>
                              </div>

                              {/* Footer meta row - Original preserved */}
                              <div
                                className="lub-chat-meta"
                              >
                                <span>
                                  ACCESSIBLE:{" "}
                                  <strong
                                    style={{
                                      color:
                                        chatMode === "internal"
                                          ? "#3b82f6"
                                          : "#64748b",
                                    }}
                                  >
                                    {chatMode === "internal"
                                      ? "INTERNAL TEAM"
                                      : amIShore
                                        ? "OFFICE & SHORE"
                                        : "VESSEL"}
                                  </strong>
                                </span>
                                <span>Enter to send</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
              </div>
            </div>
            {/* â”€â”€ END THREE-PANEL ROW â”€â”€ */}
          </div>
          {/* â”€â”€ END OUTER MODAL SHELL â”€â”€ */}
        </div>
      )}
      {/* ----------------- MODAL END ----------------- */}
      {/* ----------------- VESSEL LIST MODAL ----------------- */}
      {/* ----------------- VESSEL LIST MODAL (FULLY UPDATED) ----------------- */}
      {listModal.isOpen && (
        <div className="lub-list-modal-overlay">
          <div className="lub-list-modal-shell">
            {/* Header */}
            <div className="lub-list-modal-header">
              <div className="lub-list-modal-title-group">
                <h3 className="lub-list-modal-title">
                  {listModal.type === "Configured"
                    ? "Fleet Configuration"
                    : listModal.type === "Warning"
                      ? "Action Required"
                      : listModal.type}{" "}
                  Vessels
                </h3>
                <p className="lub-list-modal-subtitle">
                  {listModal.vessels.length}{" "}
                  {listModal.vessels.length === 1 ? "vessel" : "vessels"}{" "}
                  {/* ðŸ”¥ Logic change for configured label */}
                  {listModal.type === "Configured"
                    ? "in fleet overview"
                    : "requiring attention"}
                </p>
              </div>
              <button
                onClick={() => setListModal({ ...listModal, isOpen: false })}
                className="lub-list-modal-close"
              >
                <X size={20} className="lub-modal-close-icon" />
              </button>
            </div>

            {/* List Body Area - Optimized for Scrolling 10+ items */}
            <div
              className="vessel-modal-scroll-area lub-list-modal-body"
            >
              {listModal.vessels.length > 0 ? (
                listModal.vessels.map((v, idx) => (
                  <OverdueVesselRow
                    key={idx}
                    v={v}
                    modalType={listModal.type}
                    user={user}
                    amIShore={amIShore} // Pass the shore check here
                    onUpload={handleVesselManualReportUpload}
                    canAddJustification={canAddJustification}
                    onVesselAction={handleVesselOverdueAction}
                    isOverdueModal={listModal.type === "Overdue < 30 Days" || listModal.type === "Overdue > 30 Days"}  // 🔥 ADD THIS
                    canApprove={canApprove}
                    /* ðŸ”¥ THIS ADDITION HANDLES THE REDIRECT */
                    onViewClick={(vesselName, item) => {
                      // 1. Close the current Pending/Overdue list window
                      setListModal((prev) => ({ ...prev, isOpen: false }));

                      // 2. Identify the full machinery cell from the master matrix
                      // item.code is the equipment key (e.g., 'ME.SYS')
                      const cellData =
                        normalizedTable.rows[vesselName][item.code];

                      // 3. specificSample is the rawData we stored in handleCardClick
                      const specificSample = item.rawData;

                      // 4. Trigger the Technical Communication Modal
                      // This uses your existing logic to open the 3-panel modal and load the PDF
                      handleSelectSample(vesselName, cellData, specificSample);
                    }}
                  />
                ))
              ) : (
                <div className="lub-list-modal-empty">
                  <CheckCircle
                    size={40}
                    color="#22c55e"
                    className="lub-list-modal-empty-icon"
                  />
                  <p className="lub-list-modal-empty-text">
                    No vessels in this category.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            {/* <div
        style={{
          padding: "16px 24px",
          borderTop: "1px solid #e2e8f0",
          textAlign: "right",
          backgroundColor: "#f8fafc",
        }}
      >
        <Button
          onClick={() => setListModal({ ...listModal, isOpen: false })}
          style={{
            backgroundColor: "#0f172a",
            color: "white",
            width: "100%",
            height: "42px",
            borderRadius: "8px",
            fontWeight: "600",
          }}
        >
          Close
        </Button>
      </div> */}
          </div>
        </div>
      )}
      {trendModal.isOpen && (
        <div
          className="lub-trend-modal-overlay"
          style={{
            position: "fixed",
            marginTop: "60px",
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.8)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
        >
          <div className="modal-main-shell lub-trend-modal-shell" style={{ backgroundColor: "white", borderRadius: "12px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>

            {/* Header */}
            <div className="lub-trend-header" style={{ borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f8fafc" }}>
              <div>
                <h3 className="lub-trend-title" style={{ margin: 0, color: "#0f172a", fontWeight: "700" }}>{trendModal.title}</h3>
                <p className="lub-trend-subtitle" style={{ margin: "2px 0 0 0", color: "#64748b" }}>Historical Trend Analysis</p>
              </div>
              <button onClick={() => setTrendModal({ ...trendModal, isOpen: false })} className="modal-close-btn" style={{ cursor: "pointer", border: "none", background: "none", color: "#94a3b8", transition: "color 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
              >

                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="lub-trend-body" style={{ flex: 1, backgroundColor: "#fff", display: "flex", flexDirection: "column" }}>
              {loadingTrend ? (
                <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}><div className="loading-spinner"></div></div>
              ) : trendModal.data && trendModal.data.length > 0 ? (
                <div className="lub-trend-grid" style={{ display: "grid", flex: 1 }}>

                  {/* 1. PHYSICAL CHARACTERISTICS */}
                  <div className="lub-trend-chart-card">
                    <h4 className="lub-trend-chart-title" style={{ fontWeight: "600", color: "#475569", borderLeft: "3px solid #2563eb" }}>Physical Characteristics</h4>
                    <div className="lub-chart-wrapper">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendModal.data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} fontSize={9} tick={{ fill: "#94a3b8" }} />
                          <YAxis yAxisId="left" fontSize={9} tick={{ fill: "#2563eb" }} />
                          <YAxis yAxisId="right" orientation="right" fontSize={9} tick={{ fill: "#7c3aed" }} />
                          <Tooltip labelFormatter={(val, payload) => payload?.[0]?.payload?.dateLabel || val} contentStyle={{ fontSize: "11px", borderRadius: "8px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }} />
                          <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                          <Line yAxisId="left" type="monotone" dataKey="viscosity_40c" stroke="#2563eb" name="Visc 40C" strokeWidth={2} dot={{ r: 3 }} />
                          <Line yAxisId="right" type="monotone" dataKey="tan" stroke="#7c3aed" name="TAN" strokeWidth={2} dot={{ r: 3 }} />
                          <Line yAxisId="right" type="monotone" dataKey="tbn" stroke="#db2777" name="TBN" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 2. WEAR METALS */}
                  <div className="lub-trend-chart-card">
                    <h4 className="lub-trend-chart-title" style={{ fontWeight: "600", color: "#475569", borderLeft: "3px solid #ef4444" }}>Wear Metals (ppm)</h4>
                    <div className="lub-chart-wrapper">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendModal.data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} fontSize={9} tick={{ fill: "#94a3b8" }} />
                          <YAxis fontSize={9} tick={{ fill: "#64748b" }} />
                          <Tooltip labelFormatter={(val, payload) => payload?.[0]?.payload?.dateLabel || val} contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                          <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                          <Line type="monotone" dataKey="iron" stroke="#ef4444" name="Iron (Fe)" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="copper" stroke="#f59e0b" name="Copper (Cu)" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="aluminium" stroke="#94a3b8" name="Aluminium" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 3. CONTAMINATION */}
                  <div className="lub-trend-chart-card">
                    <h4 className="lub-trend-chart-title" style={{ fontWeight: "600", color: "#475569", borderLeft: "3px solid #0891b2" }}>Contamination</h4>
                    <div className="lub-chart-wrapper">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendModal.data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} fontSize={9} tick={{ fill: "#94a3b8" }} />
                          <YAxis yAxisId="left" fontSize={9} tick={{ fill: "#0891b2" }} />
                          <YAxis yAxisId="right" orientation="right" fontSize={9} tick={{ fill: "#0ea5e9" }} />
                          <Tooltip labelFormatter={(val, payload) => payload?.[0]?.payload?.dateLabel || val} contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                          <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                          <Line yAxisId="left" type="monotone" dataKey="sodium" stroke="#0891b2" name="Sodium" strokeWidth={2} dot={{ r: 3 }} />
                          <Line yAxisId="left" type="monotone" dataKey="silicon" stroke="#4b5563" name="Silicon" strokeWidth={2} dot={{ r: 3 }} />
                          <Line yAxisId="right" type="monotone" dataKey="water" stroke="#0ea5e9" name="Water %" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 4. ADDITIVES */}
                  <div className="lub-trend-chart-card">
                    <h4 className="lub-trend-chart-title" style={{ fontWeight: "600", color: "#475569", borderLeft: "3px solid #10b981" }}>Additives</h4>
                    <div className="lub-chart-wrapper">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendModal.data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} fontSize={9} tick={{ fill: "#94a3b8" }} />
                          <YAxis fontSize={9} tick={{ fill: "#64748b" }} />
                          <Tooltip labelFormatter={(val, payload) => payload?.[0]?.payload?.dateLabel || val} contentStyle={{ fontSize: "11px", borderRadius: "8px" }} />
                          <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                          <Line type="monotone" dataKey="calcium" stroke="#10b981" name="Calcium %" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="magnesium" stroke="#f97316" name="Magnesium" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="zinc" stroke="#6366f1" name="Zinc" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="lub-trend-empty-state"><TrendingUp size={40} style={{ opacity: 0.3, marginBottom: "12px" }} /><p>No historical analysis data found.</p></div>
              )}
            </div>
          </div>
        </div>
      )}
      {isCloseModalOpen && (
        <div className="lub-res-modal-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            zIndex: 100005,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          {/* CALCULATE GATING LOGIC INSIDE MODAL */}
          {(() => {
            const isVesselUser = !amIShore;
            const currentSampleDate = new Date(
              selectedCell?.data?.date || selectedCell?.data?.sample_date,
            );

            // 1. Image Check: Satisfied if not required OR file chosen now OR file already in gallery
            const evidenceExistsInGallery =
              selectedCell?.data?.attachment_url &&
              selectedCell.data.attachment_url.trim().length > 0;
            const imageRequirementMet =
              !selectedCell?.data?.is_image_required ||
              evidenceExistsInGallery ||
              selectedCloseFile;

            // 2. Resampling Check: Satisfied if not required OR a report in history is newer than this sample
            const hasNewerReport = selectedCell?.data?.history?.some(
              (h) => new Date(h.date) > currentSampleDate,
            );
            const resamplingRequirementMet =
              !selectedCell?.data?.is_resampling_required || hasNewerReport;

            // 3. Final State logic
            const canVesselSubmit =
              imageRequirementMet && resamplingRequirementMet;
            const isCloseSubmitDisabled =
              isSubmittingClose ||
              (closeRemarksText?.length || 0) < 50 ||
              (isVesselUser && !canVesselSubmit);

            return (
              <div
                className="modal-content-shell lub-res-modal-shell"
                style={{ backgroundColor: "white", borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column", overflowY: "auto", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}
              >
                {/* Header */}
                <div
                  className="lub-res-modal-header"
                  style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc", display: "flex", justifyContent: "space-between" }}
                >
                  <h3 className="lub-res-title" style={{ margin: 0, fontWeight: "800" }}>
                    Equipment Resolution Detail
                  </h3>
                  <X
                    size={20}
                    className="modal-close-icon"
                    style={{ cursor: "pointer", color: "#94a3b8" }}
                    onClick={() => setIsCloseModalOpen(false)}
                  />
                </div>

                <div className="lub-res-modal-body" style={{ padding: "24px" }}>
                  <p className="lub-res-p" style={{ margin: "0 0 16px 0", color: "#475569", lineHeight: "1.5" }}>
                    Documenting resolution for{" "}
                    <b>
                      {selectedCell.vessel} - {selectedCell.machinery}
                    </b>
                    .
                    <br />
                    <span className="lub-res-status-text">Current Status: <b style={{ color: getStatusColor(selectedCell.data.status) }}>{selectedCell.data.status}</b></span>
                  </p>

                  {/* Text Area with Character Counter */}
                  <div style={{ marginBottom: "20px" }}>
                    <label className="lub-res-label" style={{ display: "block", fontWeight: "800", color: "#64748b", marginBottom: "8px", textTransform: "uppercase" }}>
                      Correction / Action Remarks (Min 50 Chars)
                    </label>
                    <textarea
                      value={closeRemarksText}
                      onChange={(e) => setCloseRemarksText(e.target.value)}
                      placeholder="Describe the corrective maintenance or investigation performed..."
                      className="lub-res-textarea"
                      style={{ width: "100%", borderRadius: "10px", border: `2px solid ${closeRemarksText.length >= 50 ? "#10b981" : "#e2e8f0"}`, resize: "none" }}
                    />
                    <div
                      className="lub-res-counter"
                      style={{ color: closeRemarksText.length >= 50 ? "#10b981" : "#ef4444" }}
                    >
                      {closeRemarksText.length} / 50 characters
                    </div>
                  </div>

                  {/* --- IMAGE MANDATORY STATUS BANNER (BUG FIX: Checks gallery) --- */}
                  <div className={`lub-res-banner ${imageRequirementMet ? 'banner-success' : 'banner-danger'}`}>
                    <div className="lub-res-banner-icon-box">
                      {imageRequirementMet ? <CheckCircle className="lub-res-icon" /> : <AlertCircle className="lub-res-icon" />}
                    </div>
                    <div>
                      <div className="lub-res-banner-title" style={{ color: imageRequirementMet ? "#166534" : "#991b1b" }}>
                        {selectedCell.data.is_image_required
                          ? imageRequirementMet
                            ? "EVIDENCE VERIFIED"
                            : "EVIDENCE UPLOAD MANDATORY"
                          : "EVIDENCE UPLOAD OPTIONAL"}
                      </div>
                      <p className="lub-res-banner-desc" style={{ color: imageRequirementMet ? "#15803d" : "#b91c1c" }}>
                        {evidenceExistsInGallery
                          ? "Requirement satisfied via existing gallery evidence."
                          : selectedCell.data.is_image_required
                            ? imageRequirementMet
                              ? "File attached successfully."
                              : "Vessel must provide a file to resolve."
                            : "No mandatory image request for this report."}
                      </p>
                    </div>
                  </div>

                  {/* --- NEW: RESAMPLING MANDATORY STATUS BANNER --- */}
                  {selectedCell.data.is_resampling_required && (
                    <div className={`lub-res-banner ${resamplingRequirementMet ? 'banner-success' : 'banner-danger'}`}>

                      <div className="lub-res-banner-icon-box">
                        {resamplingRequirementMet ? (
                          <CheckCircle className="lub-res-icon" color="#16a34a" />
                        ) : (
                          <History className="lub-res-icon" color="#dc2626" />
                        )}
                      </div>
                      <div>
                        <div className="lub-res-banner-title" style={{ color: resamplingRequirementMet ? "#166534" : "#991b1b" }}>
                          {resamplingRequirementMet
                            ? "RESAMPLE REPORT DETECTED"
                            : "RESAMPLING REQUIRED"}
                        </div>
                        <p className="lub-res-banner-desc" style={{ color: resamplingRequirementMet ? "#15803d" : "#b91c1c" }}>
                          {resamplingRequirementMet
                            ? "A newer report was found in history (Resampling Done)."
                            : "Cannot close until a follow-up report is uploaded."}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Upload Section */}
                  <div className="lub-res-input-group">
                    <label className="lub-res-label">
                      Attach Evidence / File
                    </label>
                    <input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          // ðŸ”¥ NEW: Size Restriction check
                          if (file.size > 1024 * 1024) {
                            alert(
                              "âŒ File too large. Maximum allowed size is 1MB.",
                            );
                            e.target.value = ""; // Clear the input
                            return;
                          }
                          setSelectedCloseFile(file);
                        }
                      }}
                      className="lub-res-file-input"
                    />
                  </div>

                  {/* Modal Buttons */}
                  <div className="lub-res-btn-container">
                    <button
                      onClick={handleResolutionSubmit}
                      disabled={isCloseSubmitDisabled}
                      className="lub-res-submit-btn"
                      style={{
                        backgroundColor: isCloseSubmitDisabled ? "#cbd5e1" : "#059669",
                        cursor: isCloseSubmitDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {isVesselUser && !resamplingRequirementMet
                        ? "WAITING FOR NEW REPORT"
                        : isVesselUser && !imageRequirementMet
                          ? "ATTACH FILE TO CLOSE"
                          : "CLOSE REPORT"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      {previewImage && (
        <div
          className="lub-img-preview-overlay"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="lub-img-preview-container"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage}
              className="lub-img-preview-main"
              alt="Evidence Preview"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="lub-img-preview-close"
            >
              <X size={32} className="lub-img-preview-x" />
            </button>
          </div>
        </div>
      )}
      {isEvidenceModalOpen && (
        <div
          className="lub-gallery-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100001,
            backgroundColor: "rgba(15, 23, 42, 0.95)", // Dark backdrop
            display: "flex",
          }}
          onClick={() => {
            setIsEvidenceModalOpen(false);
            setPreviewImage(null);
            setSelectedGalleryItems([]);
          }}
        >
          {/* LEFT SIDEBAR: GALLERY LIST */}
          <div
            className="lub-gallery-sidebar"
            style={{ backgroundColor: "white", boxShadow: "4px 0 15px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="lub-gallery-header"
              style={{ padding: "20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <h4 className="lub-gallery-title" style={{ margin: 0, fontWeight: "800", color: "#1e293b" }}>Evidence Gallery</h4>
              <X
                size={20}
                className="modal-close-icon"
                onClick={() => {
                  setIsEvidenceModalOpen(false);
                  setPreviewImage(null);
                  setSelectedGalleryItems([]);
                }}
                style={{ cursor: "pointer" }}
              />
            </div>

            <div
              className="lub-gallery-list"
              style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column" }}
            >
              {/* ðŸ”¥ UPDATED FILTER: Now looks for both prefixes */}
              {selectedCell.data.conversation?.filter(
                (m) =>
                  m.message.includes("ATTACHED_IMAGE:") ||
                  m.message.includes("ATTACHED_PDF:"),
              ).length > 0 ? (
                selectedCell.data.conversation
                  .filter(
                    (m) =>
                      m.message.includes("ATTACHED_IMAGE:") ||
                      m.message.includes("ATTACHED_PDF:"),
                  )
                  .map((msg, i) => {
                    const isPdf = msg.message.includes("ATTACHED_PDF:");
                    const prefix = isPdf
                      ? "ATTACHED_PDF: "
                      : "ATTACHED_IMAGE: ";

                    // Extract URL accurately even if it contains colons (SAS tokens)
                    const url = msg.message.substring(
                      msg.message.indexOf(prefix) + prefix.length,
                    );

                    // Use the URL as the unique identifier for selection (safer than date)
                    const isChecked = selectedGalleryItems.some(
                      (item) => item.url === url,
                    );
                    const uploaderName =
                      msg.message.match(/\] (.*?):/)?.[1] || msg.role;

                    return (
                      <div
                        key={i}
                        // PDFs open in new tab, Images preview on the right
                        onClick={() =>
                          isPdf
                            ? window.open(url, "_blank")
                            : setPreviewImage(url)
                        }
                        className="lub-gallery-item-card"
                        style={{ padding: "12px", cursor: "pointer", borderRadius: "12px", position: "relative" }}
                      >
                        {/* Selection Checkbox */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "8px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => {
                              setSelectedGalleryItems((prev) =>
                                isChecked
                                  ? prev.filter((item) => item.url !== url)
                                  : [...prev, { ...msg, url }],
                              );
                            }}
                            style={{
                              cursor: "pointer",
                              width: "18px",
                              height: "18px",
                            }}
                          />
                          <span
                            style={{
                              fontSize: "0.7rem",
                              fontWeight: "800",
                              color: isChecked ? "#ef4444" : "#64748b",
                            }}
                          >
                            {isChecked
                              ? "SELECTED"
                              : `SELECT ${isPdf ? "FILE" : "IMAGE"}`}
                          </span>
                        </div>

                        <div
                          className="lub-gallery-uploader-info"
                          style={{
                            color: "#64748b",
                            fontWeight: "700",
                          }}
                        >
                          Uploaded by:{" "}
                          <span style={{ color: "#1e293b" }}>
                            {uploaderName}
                          </span>{" "}
                          <br /> {msg.date}
                        </div>

                        {/* UI Branch: PDF Icon vs Image Thumbnail */}
                        {isPdf ||
                          url.toLowerCase().includes(".xls") ||
                          url.toLowerCase().includes(".doc") ? (
                          <div
                            style={{
                              width: "100%",
                              height: "130px",
                              backgroundColor: "#f1f5f9",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                            }}
                          >
                            {/* Dynamic Icon based on type */}
                            {url.toLowerCase().includes(".xls") ? (
                              <TrendingUp size={40} color="#16a34a" /> // Green for Excel
                            ) : (
                              <FileText size={40} color="#2563eb" /> // Blue for others
                            )}
                            <span
                              style={{
                                fontSize: "0.6rem",
                                fontWeight: "800",
                                color: "#475569",
                              }}
                            >
                              CLICK TO PREVIEW FILE
                            </span>
                          </div>
                        ) : (
                          <img
                            src={url}
                            alt="evidence"
                            style={{
                              width: "100%",
                              height: "130px",
                              objectFit: "cover",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                            }}
                          />
                        )}
                      </div>
                    );
                  })
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "40px 20px",
                    color: "#94a3b8",
                  }}
                >
                  No attachments found.
                </div>
              )}
            </div>

            {/* SIDEBAR FOOTER */}
            <div className="lub-gallery-footer" style={{ padding: "16px", borderTop: "1px solid #e2e8f0", display: "flex", flexDirection: "column" }}>
              {selectedGalleryItems.length > 0 && (
                <button
                  className="lub-gallery-delete-btn"
                  onClick={handleBulkDelete}
                  style={{ width: "100%", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "8px", fontWeight: "800" }}
                >
                  DELETE SELECTED ({selectedGalleryItems.length})
                </button>
              )}
              <Button

                onClick={() => {
                  setIsEvidenceModalOpen(false);
                  setPreviewImage(null);
                  setSelectedGalleryItems([]);
                }}
                className="lub-gallery-close-btn"
                style={{ width: "100%", backgroundColor: "#0f172a", color: "white" }}
              >
                Close Gallery
              </Button>
            </div>
          </div>

          {/* RIGHT SIDE: FULL PREVIEW AREA */}
          <div
            className="lub-gallery-preview-pane"
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", backgroundColor: "#0f172a" }}
            onClick={(e) => e.stopPropagation()}
          >
            {previewImage ? (
              <div
                className="lub-gallery-frame-container"
                style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}
              >
                <button
                  onClick={() => setPreviewImage(null)}
                  style={{
                    position: "absolute",
                    right: "0px",
                    backgroundColor: "white",
                    border: "none",
                    borderRadius: "50%",
                    width: "50px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
                    zIndex: 10,
                  }}
                >
                  <X size={22} color="#0f172a" />
                </button>
                {(() => {
                  const urlLower = previewImage.toLowerCase().split("?")[0]; // Ignore SAS token for extension check
                  const isExcel =
                    urlLower.endsWith(".xlsx") ||
                    urlLower.endsWith(".xls") ||
                    urlLower.endsWith(".csv");
                  const isDoc =
                    urlLower.endsWith(".docx") || urlLower.endsWith(".doc");
                  const isPdf = urlLower.endsWith(".pdf");

                  // ðŸ”¥ SHARED STYLE OBJECT: This ensures Image, Excel, and PDF look identical
                  const frameStyle = {
                    width: isExcel || isDoc || isPdf ? "80vw" : "auto",
                    maxWidth: "100%",
                    height: isExcel || isDoc || isPdf ? "75vh" : "auto",
                    maxHeight: "75vh",
                    borderRadius: "12px",
                    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)",
                    border: "6px solid white", // Same border as your image layout
                    backgroundColor: "white", // Ensures a clean background behind docs
                    objectFit: "contain",
                    display: "block",
                  };

                  // Case 1: Excel or Word Documents (Use Microsoft Viewer)
                  if (isExcel || isDoc) {
                    return (
                      <iframe
                        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewImage)}`}
                        style={frameStyle}
                        title="Office Preview"
                      />
                    );
                  }

                  // Case 2: PDF Files (Use standard iframe)
                  if (isPdf) {
                    return (
                      <iframe
                        src={previewImage}
                        style={frameStyle}
                        title="PDF Preview"
                      />
                    );
                  }

                  // Case 3: Images (Uses the same shared style object)
                  return (
                    <img
                      src={previewImage}
                      alt="Full view"
                      style={frameStyle}
                    />
                  );
                })()}
              </div>
            ) : (
              <div
                style={{ textAlign: "center", color: "rgba(255,255,255,0.2)" }}
              >
                <Activity
                  size={100}
                  style={{ marginBottom: "20px", opacity: 0.1 }}
                />
                <p style={{ fontSize: "1.5rem", fontWeight: "600" }}>
                  Select an image card to preview
                </p>
                <p style={{ fontSize: "0.9rem", opacity: 0.6 }}>
                  PDFs will open in a new browser tab when clicked.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LuboilAnalysis;
