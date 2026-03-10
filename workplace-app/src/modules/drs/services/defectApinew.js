// src/services/defectApi.js - ✅ PRODUCTION-READY with Multi-Select & Text Search Support
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
    console.log('\n====================================');
    console.log('📡 [API] getUploadSasUrl() called');
    console.log('====================================');
    
    try {
      console.log('📋 [API] Request details:');
      console.log('   Endpoint: /defects/sas');
      console.log('   Method: GET');
      console.log('   Param blobName:', blobName);
      
      if (!blobName) {
        throw new Error('❌ [API] blobName parameter is required');
      }
      
      if (typeof blobName !== 'string') {
        throw new Error(`❌ [API] blobName must be a string, got ${typeof blobName}`);
      }
      
      console.log('✅ [API] Input validation passed');
      console.log('📤 [API] Sending request...');
      
      const response = await api.get("/defects/sas", {
        params: { blobName },
      });
      
      console.log('📥 [API] Response received');
      console.log('✅ [API] Response validation passed');
      console.log('====================================\n');
      
      return response.data;
    } catch (error) {
      console.error('\n====================================');
      console.error('❌ [API] getUploadSasUrl() FAILED');
      console.error('   Error:', error.message);
      console.error('====================================\n');
      throw error;
    }
  },

  // ============================================
  // DEFECT MANAGEMENT
  // ============================================
  getDefects: async (vesselImo = "") => {
    const params = vesselImo ? { vessel_imo: vesselImo } : {};
    const response = await api.get("/defects/", { params });
    return response.data;
  },

  getDefectById: async (defectId) => {
    const response = await api.get(`/defects/${defectId}`);
    return response.data;
  },

  createDefect: async (defectData) => {
    console.log('💾 [API] createDefect() called');
    const response = await api.post("/defects/", defectData);
    console.log('✅ [API] createDefect() success');
    return response.data;
  },

  updateDefect: async (defectId, updates) => {
    console.log('📝 [API] updateDefect() called');
    const response = await api.patch(`/defects/${defectId}`, updates);
    console.log('✅ [API] updateDefect() success');
    return response.data;
  },

  closeDefect: async (defectId, closeData) => {
    const response = await api.patch(`/defects/${defectId}/close`, closeData);
    return response.data;
  },

  removeDefect: async (defectId) => {
    const response = await api.delete(`/defects/${defectId}`);
    return response.data;
  },

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
      console.log('📊 [API] Exporting defects to Excel...');
      console.log('   Filters:', JSON.stringify(filters, null, 2));
      console.log('   Visible columns:', columns);

      // ✅ Build URLSearchParams to properly handle arrays
      const params = new URLSearchParams();

      // Process each filter
      Object.keys(filters).forEach(key => {
        const value = filters[key];
        
        if (Array.isArray(value)) {
          // ✅ For arrays, append each value with the same key
          // This creates: ?vessel_imo=IMO1&vessel_imo=IMO2 (FastAPI Query list format)
          value.forEach(item => {
            if (item !== null && item !== undefined && item !== '') {
              params.append(key, item);
            }
          });
        } else if (value !== null && value !== undefined && value !== '') {
          // For non-array values
          if (typeof value === 'boolean' || value === 'true' || value === 'false') {
            params.append(key, value);
          } else if (value.toString().trim() !== '') {
            params.append(key, value);
          }
        }
      });

      // ✅ Add visible columns parameter
      if (columns && columns.trim() !== '') {
        params.append('visible_columns', columns);
        console.log('   ✅ Added visible_columns parameter:', columns);
      }

      console.log('   Final params string:', params.toString());
      
      // Make API call with responseType: 'blob' for binary data
      const response = await api.get('/defects/export', {
        params: params,  // URLSearchParams handles arrays correctly for FastAPI
        responseType: 'blob',
      });

      console.log('✅ [API] Excel file received');
      console.log('   Response size:', response.data.size, 'bytes');

      // Create blob URL for download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Extract filename from Content-Disposition header
      const contentDisposition = response.headers['content-disposition'];
      let fileName = `Defect_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          fileName = match[1].replace(/['"]/g, '');
        }
      }

      console.log('   Filename:', fileName);

      // Trigger download
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      link.remove();
      window.URL.revokeObjectURL(url);
      
      console.log('✅ [API] Excel export completed successfully');
      
    } catch (error) {
      console.error('❌ [API] exportDefects() FAILED:', error.message);
      
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

  // ============================================
  // VESSEL USERS
  // ============================================
  getVesselUsers: async (identifier) => {
    const isImo = /^\d{7}$/.test(identifier);
    const url = isImo
      ? `/vessels/${identifier}/users`
      : `/defects/${identifier}/vessel-users`;

    const response = await api.get(url);
    return response.data.map((u) => ({
      id: u.id,
      name: u.full_name || u.name,
    }));
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
    return response.data;
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
      console.log('📋 [API] Fetching user preferences...');
      const response = await api.get('/users/me/preferences');
      console.log('✅ [API] User preferences loaded:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ [API] Error fetching user preferences:', error);
      // Return default preferences on error (UPDATED with new icon columns)
      return {
        preferences: {
          vessel_columns: [
            'date',
            'deadline',
            'source',
            'equipment',
            'description',
            'priority',
            'status',
            'deadline_icon',
            'chat',
            'pr_details'
          ]
        }
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
      console.log('💾 [API] Updating user preferences...');
      console.log('   New preferences:', JSON.stringify(preferences, null, 2));
      
      const response = await api.patch('/users/me/preferences', { 
        preferences 
      });
      
      console.log('✅ [API] Preferences updated successfully');
      console.log('   Response:', JSON.stringify(response.data, null, 2));
      
      return response.data;
    } catch (error) {
      console.error('❌ [API] Error updating user preferences:', error);
      
      if (error.response) {
        console.error('   HTTP Status:', error.response.status);
        console.error('   Response data:', error.response.data);
      }
      
      throw new Error(
        error.response?.data?.detail || 'Failed to update user preferences'
      );
    }
  },

  /**
   * Update vessel dashboard column preferences
   * @param {Array<string>} columns - Array of column IDs to display
   * @returns {Promise<Object>} Updated user data
   */
  updateColumnPreferences: async (columns) => {
    console.log('🎯 [API] Updating column preferences...');
    console.log('   Selected columns:', columns);
    
    // Validate columns array
    if (!Array.isArray(columns)) {
      throw new Error('Columns must be an array');
    }
    
    if (columns.length === 0) {
      throw new Error('At least one column must be selected');
    }
    
    // Valid column IDs (UPDATED with new icon columns)
    const validColumns = [
      'date',
      'deadline',
      'source',
      'equipment',
      'description',
      'priority',
      'status',
      'deadline_icon',
      'chat',
      'pr_details'
    ];
    
    // Check if all columns are valid
    const invalidColumns = columns.filter(col => !validColumns.includes(col));
    if (invalidColumns.length > 0) {
      console.warn('⚠️ [API] Invalid column IDs detected:', invalidColumns);
    }
    
    return defectApi.updateUserPreferences({
      vessel_columns: columns
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