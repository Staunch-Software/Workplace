// src/services/defectApi.js - COMPLETE PRODUCTION-READY VERSION WITH ENHANCED EXCEL EXPORT
import api from '@drs/api/axiosDrs';

export const defectApi = {
  // ============================================
  // ATTACHMENT MANAGEMENT
  // ============================================
  getAttachmentUrl: async (blobPath) => {
    try {
      console.log("🔗 [API] Requesting signed URL for:", blobPath);
      const response = await api.post("/attachments/signed-url", {
        blob_path: blobPath,
      });
      console.log("✅ [API] Signed URL received");
      return response.data.url;
    } catch (error) {
      console.error("❌ [API] Error getting attachment URL:", error);
      throw error;
    }
  },

  getUploadSasUrl: async (blobName) => {
    console.log("\n====================================");
    console.log("📡 [API] getUploadSasUrl() called");
    console.log("====================================");

    try {
      console.log("📋 [API] Request details:");
      console.log("   Endpoint: /defects/sas");
      console.log("   Method: GET");
      console.log("   Param blobName:", blobName);
      console.log("   Param type:", typeof blobName);
      console.log("   Param length:", blobName?.length);

      // Validate input
      if (!blobName) {
        throw new Error("❌ [API] blobName parameter is required");
      }

      if (typeof blobName !== "string") {
        throw new Error(
          `❌ [API] blobName must be a string, got ${typeof blobName}`,
        );
      }

      if (blobName.includes("http://") || blobName.includes("https://")) {
        throw new Error(
          `❌ [API] blobName should be a path, not a URL: ${blobName}`,
        );
      }

      console.log("✅ [API] Input validation passed");
      console.log("📤 [API] Sending request...");

      const response = await api.get("/defects/sas", {
        params: { blobName },
      });

      console.log("📥 [API] Response received");
      console.log("   Status:", response.status);
      console.log("   Status text:", response.statusText);
      console.log("   Data type:", typeof response.data);
      console.log("   Data keys:", Object.keys(response.data || {}));
      console.log(
        "   Full response data:",
        JSON.stringify(response.data, null, 2),
      );

      // Validate response
      if (!response.data) {
        throw new Error("❌ [API] No data in response");
      }

      if (!response.data.url) {
        console.error("❌ [API] No URL in response.data");
        console.error("   Response.data:", response.data);
        throw new Error('❌ [API] Response missing "url" field');
      }

      console.log("✅ [API] Response validation passed");
      console.log("   URL present:", !!response.data.url);
      console.log("   URL length:", response.data.url.length);
      console.log("====================================\n");

      return response.data;
    } catch (error) {
      console.error("\n====================================");
      console.error("❌ [API] getUploadSasUrl() FAILED");
      console.error("====================================");
      console.error("   BlobName:", blobName);
      console.error("   Error type:", error.constructor.name);
      console.error("   Error message:", error.message);

      if (error.response) {
        console.error("   HTTP Status:", error.response.status);
        console.error("   HTTP Status text:", error.response.statusText);
        console.error("   Response data:", error.response.data);
      } else if (error.request) {
        console.error("   No response received");
        console.error("   Request:", error.request);
      } else {
        console.error("   Request setup error");
      }

      console.error("   Stack:", error.stack);
      console.error("====================================\n");
      throw error;
    }
  },

  // ============================================
  // DEFECT MANAGEMENT
  // ============================================
  getDefects: async (vesselImo = "") => {
    const params = vesselImo ? { vessel_imo: vesselImo } : {};
    const response = await api.get("/defects/", { params });
    return Array.isArray(response.data) ? response.data : (response.data?.results ?? response.data?.defects ?? []);
  },

  getDefectById: async (defectId) => {
    const response = await api.get(`/defects/${defectId}`);
    return response.data;
  },

  createDefect: async (defectData) => {
    console.log("\n====================================");
    console.log("💾 [API] createDefect() called");
    console.log("====================================");

    try {
      console.log("📋 [API] Defect data to create:");
      console.log("   Defect ID:", defectData.id);
      console.log("   Vessel IMO:", defectData.vessel_imo);
      console.log("   Equipment:", defectData.equipment);
      console.log("   JSON backup path:", defectData.json_backup_path);
      console.log("   Full payload:", JSON.stringify(defectData, null, 2));

      // Critical validation
      if (!defectData.json_backup_path) {
        console.warn("⚠️ [API] WARNING: json_backup_path is missing or empty!");
        console.warn(
          "   This means the JSON backup path will NOT be saved to database!",
        );
      } else {
        console.log(
          "✅ [API] json_backup_path is present:",
          defectData.json_backup_path,
        );

        // Validate it's a path not a URL
        if (
          defectData.json_backup_path.includes("http://") ||
          defectData.json_backup_path.includes("https://")
        ) {
          console.error(
            "❌ [API] json_backup_path appears to be a URL, not a path!",
          );
          console.error("   Value:", defectData.json_backup_path);
        } else {
          console.log(
            "✅ [API] json_backup_path format looks correct (path not URL)",
          );
        }
      }

      console.log("📤 [API] Sending POST request to /defects/...");

      const response = await api.post("/defects/", defectData);

      console.log("📥 [API] Response received");
      console.log("   Status:", response.status);
      console.log("   Response data:", JSON.stringify(response.data, null, 2));

      // Check if json_backup_path made it to the response
      if (response.data && response.data.json_backup_path) {
        console.log(
          "✅ [API] SUCCESS: json_backup_path in response:",
          response.data.json_backup_path,
        );
      } else {
        console.warn("⚠️ [API] WARNING: json_backup_path NOT in response");
        console.warn("   This suggests the backend did not save it");
      }

      console.log("====================================\n");
      return response.data;
    } catch (error) {
      console.error("\n====================================");
      console.error("❌ [API] createDefect() FAILED");
      console.error("====================================");
      console.error("   Defect ID:", defectData?.id);
      console.error("   Error:", error.message);

      if (error.response) {
        console.error("   HTTP Status:", error.response.status);
        console.error("   Response data:", error.response.data);
      }

      console.error("====================================\n");
      throw error;
    }
  },

  updateDefect: async (defectId, updates) => {
    console.log("📝 [API] updateDefect() called");
    console.log("   Defect ID:", defectId);
    console.log("   Updates:", JSON.stringify(updates, null, 2));

    const response = await api.patch(`/defects/${defectId}`, updates);

    console.log("✅ [API] updateDefect() success");
    console.log("   Response:", JSON.stringify(response.data, null, 2));

    return response.data;
  },

  closeDefect: async (defectId, closeData) => {
    const response = await api.patch(`/defects/${defectId}/close`, closeData);
    return response.data;
  },
  // ✅ After — proper async/await, returns response.data, full logging
  shoreCloseDefect: async (id, data) => {
    const response = await api.patch(`/defects/${id}/shore-close`, data);
    return response.data; // consistent with all other methods
  },

  removeDefect: async (defectId) => {
    const response = await api.delete(`/defects/${defectId}`);
    return response.data;
  },

  // Validate defect images before closing
  validateDefectImages: async (defectId) => {
    try {
      console.log("🔍 Validating defect images for:", defectId);
      const response = await api.get(`/defects/${defectId}/validate-images`);
      console.log("✅ Validation result:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Error validating images:", error);
      throw error;
    }
  },

  // ============================================
  // ✅ ENHANCED: EXCEL EXPORT WITH MULTI-SELECT & TEXT SEARCH
  // ============================================
  /**
   * Export defects to Excel with multi-select filtering, text search, and date ranges
   * @param {Object} filters - Filter object with arrays for multi-select fields
   * @param {string} columns - Comma-separated list of visible column IDs
   * @returns {Promise<void>} - Triggers browser download
   */
  exportDefects: async (filters = {}, columns = "") => {
    try {
      console.log("📊 [API] Exporting defects to Excel...");
      console.log("   Filters:", JSON.stringify(filters, null, 2));
      console.log("   Visible columns:", columns);

      // ✅ Build URLSearchParams to properly handle arrays
      const params = new URLSearchParams();

      // Process each filter
      Object.keys(filters).forEach((key) => {
        const value = filters[key];

        if (Array.isArray(value)) {
          // ✅ For arrays, append each value with the same key
          // This creates: ?vessel_imo=IMO1&vessel_imo=IMO2 (FastAPI Query list format)
          value.forEach((item) => {
            if (item !== null && item !== undefined && item !== "") {
              params.append(key, item);
            }
          });
        } else if (value !== null && value !== undefined && value !== "") {
          // For non-array values
          if (
            typeof value === "boolean" ||
            value === "true" ||
            value === "false"
          ) {
            params.append(key, value);
          } else if (value.toString().trim() !== "") {
            params.append(key, value);
          }
        }
      });

      // ✅ Add visible columns parameter
      if (columns && columns.trim() !== "") {
        params.append("visible_columns", columns);
        console.log("   ✅ Added visible_columns parameter:", columns);
      }

      console.log("   Final params string:", params.toString());

      // Make API call with responseType: 'blob' for binary data
      const response = await api.get("/defects/export", {
        params: params, // URLSearchParams handles arrays correctly for FastAPI
        responseType: "blob",
      });

      console.log("✅ [API] Excel file received");
      console.log("   Response size:", response.data.size, "bytes");

      // Create blob URL for download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;

      // Extract filename from Content-Disposition header
      const contentDisposition = response.headers["content-disposition"];
      let fileName = `Defect_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;

      if (contentDisposition) {
        const match = contentDisposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
        );
        if (match && match[1]) {
          fileName = match[1].replace(/['"]/g, "");
        }
      }

      console.log("   Filename:", fileName);

      // Trigger download
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();

      // Cleanup
      link.remove();
      window.URL.revokeObjectURL(url);

      console.log("✅ [API] Excel export completed successfully");
    } catch (error) {
      console.error("❌ [API] exportDefects() FAILED:", error.message);

      let errorMessage = "Failed to export defects.";
      if (error.response?.status === 500) {
        errorMessage += " Server error occurred. Please try again.";
      } else if (error.response?.status === 404) {
        errorMessage += " Export endpoint not found.";
      } else if (!navigator.onLine) {
        errorMessage += " No internet connection.";
      }

      alert(errorMessage);
      throw error;
    }
  },

  importDefects: async (formData) => {
    try {
      console.log("📥 [API] Importing defects from Excel...");

      const response = await api.post("/defects/import", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      console.log("✅ [API] Import successful:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ [API] Import failed:", error);

      if (error.response) {
        console.error("   Status:", error.response.status);
        console.error("   Data:", error.response.data);
      }

      throw error;
    }
  },

  downloadTemplate: async () => {
    try {
      const response = await api.get("/defects/import-template", {
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "Defect_Import_Template.xlsx");
      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(url); // ✅ IMPORTANT
    } catch (error) {
      console.error("❌ Template download failed:", error);
      throw error;
    }
  },

  downloadVesselTemplate: async () => {
    try {
      const response = await api.get("/defects/import-template-vessel", {
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "Vessel_Defect_Template.xlsx");
      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Template download failed:", error);
      throw error;
    }
  },

  // ============================================
  // THREADS & ATTACHMENTS
  // ============================================
  getThreads: async (defectId) => {
    const response = await api.get(`/defects/${defectId}/threads`);
    return response.data;
  },

  createThread: async (threadData) => {
    const response = await api.post("/defects/threads", threadData);
    return response.data;
  },

  createAttachment: async (attachmentData) => {
    const response = await api.post("/defects/attachments", attachmentData);
    return response.data;
  },

  // Add to defectApi object:
  getLiveFeed: () =>
    api.get("/users/live-feed").then((r) => r.data),

  markFeedRead: (id) =>
    api.patch(`/users/live-feed/${id}/read`).then((r) => r.data),
  // ============================================
  // VESSEL USERS
  // ============================================
  // Change this function in your defectApi.js
  getVesselUsers: async (identifier) => {
    const isImo = /^\d{7}$/.test(identifier);
    const url = isImo
      ? `/vessels/${identifier}/users`
      : `/defects/${identifier}/vessel-users`;

    const response = await api.get(url);

    // ✅ FIX: Include role and jobTitle so the frontend can filter them
    return response.data.map((u) => ({
      id: u.id,
      name: u.full_name,
      full_name: u.full_name,
      role: u.role, // 👈 Ensure this matches backend key
      jobTitle: u.job_title, // 👈 ShoreDashboard uses "jobTitle" (camelCase)
      job_title: u.job_title, // Keep snake_case just in case
    }));
  },

  getVessels: async () => {
    try {
      console.log("🚢 [API] Fetching all vessels from database...");
      const response = await api.get("/vessels/");
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error("❌ [API] Error fetching vessel list:", error);
      throw error;
    }
  },

  // ============================================
  // PR ENTRY MANAGEMENT
  // ============================================
  createPrEntry: async (prData) => {
    const response = await api.post("/defects/pr-entries", prData);
    return response.data;
  },

  getPrEntries: async (defectId) => {
    const response = await api.get(`/defects/${defectId}/pr-entries`);
    return response.data;
  },

  updatePrEntry: async (prId, data) => {
    const response = await api.patch(`/defects/pr-entries/${prId}`, data);
    return response.data;
  },

  deletePrEntry: async (prId) => {
    const response = await api.delete(`/defects/pr-entries/${prId}`);
    return response.data;
  },

  // ============================================
  // DEFECT IMAGES MANAGEMENT
  // ============================================
  saveDefectImage: async (imageData) => {
    try {
      console.log("💾 Saving defect image:", imageData);
      const response = await api.post("/defects/images", imageData);
      console.log("✅ Image saved successfully");
      return response.data;
    } catch (error) {
      console.error("❌ Error saving image:", error);
      throw error;
    }
  },

  getDefectImages: async (defectId, imageType) => {
    try {
      console.log(`📷 Fetching ${imageType} images for defect:`, defectId);
      const response = await api.get(
        `/defects/${defectId}/images/${imageType}`,
      );
      console.log(`✅ Found ${response.data.length} images`);
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching images:", error);
      return [];
    }
  },

  getEmailRecipients: (defectId) =>
    api.get(`/defects/${defectId}/email-recipients`).then(r => r.data),

  // ============================================
  // TASKS & NOTIFICATIONS
  // ============================================
  getMyTasks: async () => {
    const response = await api.get("/users/me/tasks");
    return response.data;
  },

  completeTask: async (taskId) => {
    const response = await api.patch(`/users/tasks/${taskId}/complete`);
    return response.data;
  },

  getNotifications: async () => {
    const response = await api.get("/users/me/notifications");
    return Array.isArray(response.data) ? response.data : [];
  },

  markNotificationsRead: async () => {
    const response = await api.patch("/users/notifications/read-all");
    return response.data;
  },

  markNotificationsSeen: async () => {
    const response = await api.patch("/users/notifications/mark-seen");
    return response.data;
  },

  markSingleNotificationRead: async (id) => {
    const response = await api.patch(`/users/notifications/${id}/read`);
    return response.data;
  },

  // ============================================
  // USER PREFERENCES (COLUMN CUSTOMIZATION)
  // ============================================

  /**
   * Get current user's preferences
   * @returns {Promise<Object>} User preferences object containing vessel_columns and other settings
   */
  getUserPreferences: async () => {
    try {
      console.log("📋 [API] Fetching user preferences...");
      const response = await api.get("/users/me/preferences");
      console.log("✅ [API] User preferences loaded:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ [API] Error fetching user preferences:", error);
      // Return default preferences on error (UPDATED with new icon columns)
      return {
        preferences: {
          vessel_columns: [
            "date",
            "deadline",
            "source",
            "equipment",
            "description",
            "priority",
            "status",
            "deadline_icon",
            "chat",
            "pr_details",
          ],
        },
      };
    }
  },

  /**
   * Update current user's preferences
   * @param {Object} preferences - Preferences object to save (e.g., { vessel_columns: [...] })
   * @returns {Promise<Object>} Updated user data
   */
  updateUserPreferences: async (preferences) => {
    try {
      console.log("💾 [API] Updating user preferences...");
      console.log("   New preferences:", JSON.stringify(preferences, null, 2));

      const response = await api.patch("/users/me/preferences", {
        preferences,
      });

      console.log("✅ [API] Preferences updated successfully");
      console.log("   Response:", JSON.stringify(response.data, null, 2));

      return response.data;
    } catch (error) {
      console.error("❌ [API] Error updating user preferences:", error);

      if (error.response) {
        console.error("   HTTP Status:", error.response.status);
        console.error("   Response data:", error.response.data);
      }

      throw new Error(
        error.response?.data?.detail || "Failed to update user preferences",
      );
    }
  },

  /**
   * Update vessel dashboard column preferences
   * @param {Array<string>} columns - Array of column IDs to display
   * @returns {Promise<Object>} Updated user data
   */
  updateColumnPreferences: async (columns) => {
    console.log("🎯 [API] Updating column preferences...");
    console.log("   Selected columns:", columns);

    // Validate columns array
    if (!Array.isArray(columns)) {
      throw new Error("Columns must be an array");
    }

    if (columns.length === 0) {
      throw new Error("At least one column must be selected");
    }

    // Valid column IDs (UPDATED with new icon columns)
    const validColumns = [
      "date",
      "deadline",
      "source",
      "equipment",
      "description",
      "priority",
      "status",
      "deadline_icon",
      "owner",
      "chat",
      "pr_details",
    ];

    // Check if all columns are valid
    const invalidColumns = columns.filter((col) => !validColumns.includes(col));
    if (invalidColumns.length > 0) {
      console.warn("⚠️ [API] Invalid column IDs detected:", invalidColumns);
    }

    return defectApi.updateUserPreferences({
      vessel_columns: columns,
    });
  },
};

// ============================================
// NAMED EXPORTS (for backward compatibility)
// ============================================
export const getUserPreferences = defectApi.getUserPreferences;
export const updateUserPreferences = defectApi.updateUserPreferences;
export const updateColumnPreferences = defectApi.updateColumnPreferences;

export default defectApi;
