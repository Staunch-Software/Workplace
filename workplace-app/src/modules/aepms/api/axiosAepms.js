// lib/api.js - Updated API Client with Report-based Filtering and URL Parameter Cleansing
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8005';
// const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/aepms/api';

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
    console.log('API Service initialized with base URL:', this.baseURL);
  }

  getToken() {
    return localStorage.getItem('app_token') || localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const token = this.getToken();
    
    const config = {
      ...options,
      headers: {
        ...options.headers,
      },
    };

    if (!(options.body instanceof FormData)) {
      config.headers['Content-Type'] = 'application/json';
    }

    if (token && !endpoint.includes('/auth/local/login') && !endpoint.includes('/auth/sso/microsoft')) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`🌐 API Request: ${options.method || 'GET'} ${url}`);

    try {
      const response = await fetch(url, config);
      console.log(`📡 Response Status: ${response.status} ${response.statusText}`);
      
      if (response.status === 401) {
        console.warn('⚠️ 401 Unauthorized - Clearing auth data');
        localStorage.removeItem('app_token');
        localStorage.removeItem('user');
        window.dispatchEvent(new CustomEvent('auth:logout'));
        throw new Error('Unauthorized - please login again');
      }

      const contentType = response.headers.get('content-type');
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          
          if (response.status === 422 && Array.isArray(errorData.detail)) {
            // CRITICAL FIX: Handle FastAPI 422 error detail (array of objects)
            // This serializes the array of validation errors into a single, readable string.
            errorMessage = `Validation Error (422):\n${errorData.detail.map(d => 
                `[Location: ${d.loc.join('.')}] ${d.msg}`
            ).join('; ')}`;
          } else {
            // Fallback for other JSON errors
            const detail = errorData.detail;
            const message = errorData.message;
            
            if (typeof detail === 'string') {
                errorMessage = detail;
            } else if (typeof message === 'string') {
                errorMessage = message;
            } else {
                // Last resort: stringify the complex object if it's not a known structure
                errorMessage = JSON.stringify(errorData, null, 2);
            }
          }
          
        } else {
          const errorText = await response.text();
          errorMessage = errorText || errorMessage;
        }
        
        console.error('❌ API Error:', errorMessage);
        // Ensure we always throw a string message, not an object
        throw new Error(String(errorMessage));
      }

      const data = await response.json();
      console.log('✅ API Success:', Object.keys(data));
      return data;
      
    } catch (error) {
      console.error('❌ API Request Failed:', error.message);
      console.log("➡️ FINAL API REQUEST URL:", this.baseURL + endpoint);
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error(`Cannot connect to server at ${this.baseURL}. Please ensure backend is running.`);
      }
      
      throw error;
    }
  }

  // ==================== AUTH ENDPOINTS ====================
  
  async microsoftSSOLogin(idToken) {
    console.log('🔐 Microsoft SSO Login');
    return this.request('/auth/sso/microsoft', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });
  }

  async localLogin(email, password) {
    console.log('🔑 Local Login:', email);
    return this.request('/auth/local/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getCurrentUser() {
    console.log('👤 Get Current User');
    return this.request('/auth/me');
  }

  async logout() {
    console.log('🚪 Logout');
    try {
      return await this.request('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn('Logout request failed (continuing anyway):', error);
      return { success: true };
    }
  }

  async getProtectedData() {
    console.log('🔒 Get Protected Data');
    return this.request('/auth/protected/data');
  }

  async checkPageAccess(page) {
    console.log('🔍 Checking access for:', page);
    return this.request(`/auth/check-access?page=${page}`);
  }

  // ==================== NOTIFICATION ENDPOINTS ====================
  
  async getNotifications() {
    console.log('🔔 Fetching Notifications');
    return this.request('/api/notifications');
  }

  async markNotificationRead(notificationId) {
    console.log('✅ Marking notification as read:', notificationId);
    return this.request(`/api/notifications/${notificationId}/read`, {
      method: 'PATCH',
    });
  }
  async getLuboilLiveFeed(feedMode = "FLEET") {
    console.log(`📡 Fetching Luboil Live Feed. Mode: ${feedMode}`);
    
    // 🔥 CRITICAL FIX: You must append the feedMode to the URL
    return this.request(`/api/luboil/live-feed?feed_mode=${feedMode}`);
  }
  async hideNotification(notificationId) {
    console.log('Soft-deleting/Hiding notification:', notificationId);
    return this.request(`/api/notifications/${notificationId}/hide`, {
      method: 'PATCH',
    });
  }

  // ==================== ADMIN ENDPOINTS ====================
  
  async getUsers() {
    console.log('👥 Get Users');
    return this.request('/api/admin/users');
  }

  async activateUser(userId, role) {
    console.log('✅ Activate User:', userId, role);
    return this.request(`/api/admin/users/${userId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  }

  async deactivateUser(userId) {
    console.log('❌ Deactivate User:', userId);
    return this.request(`/api/admin/users/${userId}/deactivate`, {
      method: 'POST',
    });
  }

  async createLocalUser(userData) {
    console.log('👤 Create Local User:', userData.email);
    return this.request('/api/admin/local-users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async createLocalUserWithPerms(userData) {
    console.log('👤 Create Local User with Permissions:', userData.email);
    // ✅ Standard REST: POST to the resource collection
    return this.request('/api/admin/local-users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async updateUserPermissions(userId, permissions) {
    console.log('🔓 Update Permissions for user:', userId);
    return this.request(`/api/admin/users/${userId}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify({ permissions }),
    });
  }

  async getOrganizations() {
    console.log('🏢 Get Organizations');
    return this.request('/api/admin/organizations');
  }

  async getSummary() {
    console.log('📊 Get Admin Summary');
    return this.request('/api/admin/summary');
  }

  // ==================== FLEET ENDPOINTS ====================
  /**
   * Upload Excel file to sync database
   */
  async adminDataSync(file, engineType) {
    console.log('🔄 Admin Data Sync:', engineType);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('engine_type', engineType);

    const token = this.getToken();

    const response = await fetch(`${this.baseURL}/api/admin/data-sync`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Sync failed (${response.status})`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail) errorMessage = errorJson.detail;
      } catch (e) { /* ignore parse error */ }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result;
  }

  async adminUploadBaseline(file, engineType, imoNumber) {
    console.log('📤 Admin Baseline Upload:', engineType, 'IMO:', imoNumber);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('engine_type', engineType);

    // 🔥 NEW: Append IMO Number if provided
    if (imoNumber) {
        formData.append('imo_number', imoNumber);
    }

    const token = this.getToken();

    const response = await fetch(`${this.baseURL}/api/admin/upload-baseline`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Upload failed (${response.status})`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail) errorMessage = errorJson.detail;
      } catch (e) { /* ignore parse error */ }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('✅ Baseline upload successful:', result);
    return result;
  }

  
  async getFleet() {
    console.log('🚢 Get Fleet');
    return this.request('/api/fleet/');
  }

  // ==================== DASHBOARD ENDPOINTS ====================
  
  async getDashboardKpis(shipId = null) {
    console.log('📊 Get Dashboard KPIs', shipId ? `for ship ${shipId}` : '');
    const queryParam = shipId ? `?ship_id=${encodeURIComponent(shipId)}` : '';
    return this.request(`/api/dashboard/kpis${queryParam}`);
  }

  async getFleetConfigurationSummary() {
    console.log('📊 Get Fleet Configuration Summary (LIVE)');
    
    try {
        const response = await this.request('/api/fleet/config-summary-live'); 
        return response; 
    } catch (error) {
        console.error('Backend endpoint failed. Dashboard will display zeros.', error);
        return {
            total_ships: 0,
            me_configured_ships: 0, 
            ae_configured_ships: 0, 
            me_unconfigured_list: [], 
            ae_unconfigured_list: []
        };
    }
  }

  async getFleetShopTrialSummary() {
    console.log('📈 Get Fleet Shop Trial Summary (All Ships)');
    try {
        const response = await this.request('/api/fleet/shop-trial-summary'); 
        return response;
    } catch (error) {
        console.warn('Using mock data for fleet shop trial summary in Fleet.jsx fallback:', error);
        return {
            summary: [
                { id: '1', name: 'GCL Ganga', imo: '9481697', me_configured: true, ae_configured: true, baseSFOC: 168.5, basePmax: 130.1, baseExhTemp: 405.0 },
                { id: '2', name: 'GCL Tapi', imo: '9481659', me_configured: false, ae_configured: true, baseSFOC: 172.0, basePmax: 125.5, baseExhTemp: 410.2 },
                { id: '3', name: 'AM Tarang', imo: '9832913', me_configured: true, ae_configured: false, baseSFOC: 165.2, basePmax: 132.8, baseExhTemp: 398.7 },
                { id: '4', name: 'GCL Sabarmati', imo: '9481661', me_configured: false, ae_configured: false, baseSFOC: 175.5, basePmax: 120.0, baseExhTemp: 415.9 },
            ]
        };
    }
  }

  // ==================== MAIN ENGINE PERFORMANCE ENDPOINTS ====================

  /**
 * Get Main Engine Alert History (last 6 reports)
 * Used in Alert Summary → MEPerformanceOverview.jsx
 */
  async getMEAlertHistory(imoNumber, limit = 6) {
    console.log("📊 Get ME Alert History for IMO:", imoNumber);

    const url = `/api/me-engine/deviation/history-table/${imoNumber}?limit=${limit}`;
    return this.request(url);
  }
  

  /** 
   * 🔥 NEW: Get Detailed History with Explicit Deviations 
   * Used in Detailed History Table -> MEPerformanceOverview.jsx
   */
  async getMEHistoryDetails(imoNumber) {
    console.log('📜 Get ME History Details (Actuals + Devs) for IMO:', imoNumber);
    return this.request(`/api/me-engine/history-details/${imoNumber}`);
  }
  /**
   * Get detailed ME alerts/parameters for a specific report
   * Used in Modal Popup -> MEPerformanceOverview.jsx
   */
  async getMEAlertDetails(reportId) {
    console.log('🔍 Get ME Alert Details for report:', reportId);
    // NOTE: Verify this URL matches your Backend. 
    // Based on your AE pattern, it might be: /performance/me-alerts/${reportId}
    // Or based on your ME pattern: /api/me-engine/alert-details/${reportId}
    return this.request(`/api/me-engine/alert-details/${reportId}`);
  }

  
  async getBaseline(imoNumber) {
    console.log('📈 Get Baseline Performance for IMO:', imoNumber);
    return this.request(`/api/performance/${imoNumber}/baseline`);
  }

  async getMEAlertDetails(reportId) {
  console.log('🔍 Get ME Alert Details for report:', reportId);
  return this.request(`/api/me-engine/alert-details/${reportId}`);
}

/** 🔥 REQUIRED FOR MEPerformanceOverview.jsx */
async getMEBaselineReference(imoNumber) {
  console.log("📈 Get ME Baseline Reference for IMO:", imoNumber);
  return this.request(`/api/me-engine/baseline/reference/${imoNumber}`);
}


  /**
   * Get historical ME performance data (latest N reports)
   * @param {number} imoNumber - Vessel IMO number
   * @param {number} limit - Number of reports to fetch (2, 3, 6, or 12)
   * @param {string|null} referenceMonth - Reference month in YYYY-MM format
   */
  async getPerformanceHistory(imoNumber, limit, referenceMonth = null) {
    console.log('📊 Get Performance History:', { imoNumber, limit, referenceMonth });
    
    const params = new URLSearchParams({
      imo_number: imoNumber.toString(),
      limit: limit.toString(),
    });
    
    // CRITICAL FIX FOR 422 ERROR: Clean the referenceMonth string
    if (referenceMonth) {
        // Use a regex to strictly extract only the YYYY-MM part, ignoring trailing garbage like ':1'
        const cleanedRefMonth = referenceMonth.match(/^\d{4}-\d{2}/)?.[0];
        
        if (cleanedRefMonth) { 
            params.append('ref_month', cleanedRefMonth);
        } else {
            console.warn(`Warning: referenceMonth was invalid ('${referenceMonth}'). Ignoring ref_month.`);
        }
    }

    return this.request(`/performance/history?${params.toString()}`);
  }

  /**
   * Get main engine performance data (historical or current)
   * @param {number} imoNumber - Vessel IMO number
   * @param {string} limitString - Time filter string ('current', 'last2', 'last3', etc.)
   * @param {string|null} referenceMonth - Reference month in YYYY-MM format
   */
  // async getPerformanceData(imoNumber, limitString, referenceMonth = null) {
  //   console.log('📊 Get Performance Data:', { imoNumber, limitString, referenceMonth });
    
  //   if (limitString === "current") {
  //     return { monthly_performance_list: [] };
  //   }

  //   // CRITICAL FIX: Map the UI string ('last3') to the numerical limit (3)
  //   const limitMap = { 
  //     "last2": 2, 
  //     "last3": 3, 
  //     "last6": 6, 
  //     "last12": 12 
  //   };
  //   const numericLimit = limitMap[limitString]; 

  //   if (isNaN(numericLimit) || numericLimit <= 0) {
  //     throw new Error(`Invalid time filter: ${limitString}`); 
  //   }

  //   return this.getPerformanceHistory(
  //     parseInt(imoNumber),
  //     numericLimit, // Correctly passes the number to getPerformanceHistory
  //     referenceMonth
  //   );
  // }
  async getPerformanceData(imoNumber, limitInput, referenceMonth = null) {
    
    let numericLimit;

    // 1. If it's already a number (e.g. 24), use it directly
    if (typeof limitInput === 'number') {
        numericLimit = limitInput;
    } else {
        // 2. Otherwise map the old string values
        if (limitInput === "current") return { monthly_performance_list: [] };
        
        const limitMap = { "last2": 2, "last3": 3, "last6": 6, "last12": 12 };
        numericLimit = limitMap[limitInput];
    }

    if (!numericLimit || numericLimit <= 0) {
      // Fallback to 6 if something goes wrong
      numericLimit = 6; 
    }

    return this.getPerformanceHistory(
      parseInt(imoNumber),
      numericLimit,
      referenceMonth
    );
  }

  async getGraphData(reportId) {
    console.log('📈 Get ME Graph Data for report:', reportId);
    return this.request(`/reports/${reportId}/graph-data`);
  }
  async getRawReportUrl(reportId, engineType) {
    console.log('📥 Fetching Raw Report Download URL:', { reportId, engineType });
    // This matches the @app.get("/api/performance/raw-download-link/{report_id}") backend endpoint
    return this.request(`/api/performance/raw-download-link/${reportId}?engine_type=${engineType}`);
  }
  async getBatchRawReportUrls(reportIds, engineType) {
    console.log('📥 Fetching Batch Raw URLs:', { reportIds, engineType });
    return this.request('/api/performance/batch-raw-download-links', {
      method: 'POST',
      body: JSON.stringify({
        report_ids: reportIds,
        engine_type: engineType
      })
    });
  }

  async getBatchRawZip(reportIds, engineType) {
    const token = this.getToken();
    const response = await fetch(`${this.baseURL}/api/performance/batch-download-zip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        report_ids: reportIds,
        engine_type: engineType
      })
    });

    if (!response.ok) throw new Error("Failed to generate ZIP");
    return response.blob(); // Return as blob instead of json
  }

  async uploadCsv(vesselId, file) {
    console.log('📤 Upload CSV for vessel:', vesselId);
    
    const formData = new FormData();
    formData.append('file', file);
    const token = this.getToken();

    const response = await fetch(`${this.baseURL}/upload-monthly-report/`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Upload successful:', result);
    return result;
  }

  // ==================== MAIN ENGINE DASHBOARD ENDPOINTS ====================

  /**
   * Get ME dashboard summary for monthly/daily view
   * @param {number} year - Year (e.g., 2024)
   * @param {number|null} month - Month number (1-12) or null for all months
   * @param {number|null} imoNumber - Filter by specific vessel IMO
   */
  async getMEDashboardSummary(year, month = null, imoNumber = null) {
    console.log('📊 Get ME Dashboard Summary:', { year, month, imoNumber });
    
    const params = new URLSearchParams({ year: year.toString() });
    
    if (month !== null) {
      params.append('month', month.toString());
    }
    
    if (imoNumber !== null) {
      params.append('imo_number', imoNumber.toString());
    }
    
    return this.request(`/api/performance/me-dashboard-summary?${params.toString()}`);
  }

  // ==================== AUXILIARY ENGINE ENDPOINTS ====================
  async getAuxPerformanceByReport(reportId) {
    console.log('📈 Get AE Graph Data for specific report:', reportId);
    return this.request(`/api/aux-engine/${reportId}/graph-data`);
  }
  /**
   * Get list of generators for a vessel by IMO number
   */
  async getGeneratorsList(imoNumber) {
    console.log('🔧 Get Generators List for IMO:', imoNumber);
    return this.request(`/aux/generators/${imoNumber}`);
  }

  /**
   * Get auxiliary engine baseline data for a vessel
   */
  async getAuxiliaryBaseline(imoNumber) {
    console.log('📈 Get Auxiliary Baseline for IMO:', imoNumber);
    return this.request(`/aux/performance/baseline?imo_number=${imoNumber}`);
  }

  /**
   * Get historical auxiliary engine performance data
   * @param {number} imoNumber - Vessel IMO number
   * @param {string} limitString - Time filter string ('last2', 'last3', etc.)
   * @param {string|null} ref_month - Reference month in YYYY-MM format
   * @param {number} generatorId - Generator ID
   */
  // async getAuxiliaryPerformanceHistory(imoNumber, limitString, ref_month = null, generatorId) {
  //   console.log('📊 Get Auxiliary Performance History:', { imoNumber, limitString, ref_month, generatorId });
    
  //   // CRITICAL FIX: Map the UI string ('last3') to the numerical limit (3)
  //   const limitMap = { 
  //     "last2": 2, 
  //     "last3": 3, 
  //     "last6": 6, 
  //     "last12": 12 
  //   };
  //   const numericLimit = limitMap[limitString];

  //   if (isNaN(numericLimit) || numericLimit <= 0) {
  //     throw new Error(`Invalid time filter: ${limitString}`);
  //   }
    
  //   const params = new URLSearchParams({
  //     imo_number: imoNumber.toString(),
  //     limit: numericLimit.toString(), // CRITICAL FIX: Passes the mapped number and uses 'limit' parameter
  //     generator_id: generatorId.toString()
  //   });

  //   // CRITICAL FIX FOR 422 ERROR: Clean the ref_month string
  //   if (ref_month) {
  //       const cleanedRefMonth = ref_month.match(/^\d{4}-\d{2}/)?.[0];
        
  //       if (cleanedRefMonth) {
  //           params.append('ref_month', cleanedRefMonth);
  //       } else {
  //           console.warn(`Warning: ref_month was invalid ('${ref_month}'). Ignoring ref_month.`);
  //       }
  //   }

  //   return this.request(`/aux/history?${params.toString()}`);
  // }
  async getAuxiliaryPerformanceHistory(imoNumber, limitInput, ref_month = null, generatorId) {
    
    let numericLimit;

    // 1. Allow direct number (e.g. 24)
    if (typeof limitInput === 'number') {
        numericLimit = limitInput;
    } else {
        // 2. Map strings
        const limitMap = { "last2": 2, "last3": 3, "last6": 6, "last12": 12 };
        numericLimit = limitMap[limitInput];
    }

    if (!numericLimit || numericLimit <= 0) {
       numericLimit = 6;
    }
    
    const params = new URLSearchParams({
      imo_number: imoNumber.toString(),
      limit: numericLimit.toString(), 
      generator_id: generatorId.toString()
    });

    // ... keep the rest of the function (ref_month logic) exactly the same ...
    if (ref_month) {
        const cleanedRefMonth = ref_month.match(/^\d{4}-\d{2}/)?.[0];
        if (cleanedRefMonth) params.append('ref_month', cleanedRefMonth);
    }

    return this.request(`/aux/history?${params.toString()}`);
  }

  /**
   * Get the latest performance data for a specific generator
   */
  async getAuxPerformance(generatorId) {
    console.log('📊 Get Auxiliary Engine Performance:', generatorId);
    return this.request(`/aux/performance/${generatorId}`);
  }

  /**
 * Upload auxiliary engine monthly report PDF
 * @param {number} imoNumber - Vessel IMO number
 * @param {File} file - PDF file to upload
 */
async uploadAuxReport(imoNumber, file) {
  console.log('📤 Upload Auxiliary Engine Report for IMO:', imoNumber);
  
  const formData = new FormData();
  formData.append('file', file);
  // ❌ REMOVE: formData.append('imo_number', imoNumber.toString());
  // The backend doesn't need imo_number in the form - it extracts it from the PDF
  
  const token = this.getToken();

  // ✅ FIXED: Corrected endpoint URL to match backend
  const response = await fetch(`${this.baseURL}/aux/upload-auxiliary-report/`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log('✅ Aux upload successful:', result);
  return result;
}
// ==================== 🔥 NEW: AE DEVIATION HISTORY TABLE ENDPOINT ====================
  
  /**
   * Get AE Deviation History for Table View (Last 6 reports)
   * Returns: Date, Load, FIPI, Scav, Exh Temps (Actual & Dev)
   */
  async getAEDeviationHistoryTable(generatorId, refDate = null) {
    console.log('📊 Get AE Deviation Table History for:', generatorId, 'Ref Date:', refDate);
    
    let url = `/api/aux-engine/deviation/history-table/${generatorId}?limit=6`;
    if (refDate) {
      url += `&ref_date=${refDate}`;   // <-- CRITICAL
    }

    return this.request(url);
  }

  // ==================== AUXILIARY ENGINE ALERT ENDPOINTS ====================

  /**
   * Get AE dashboard summary
   * @param {number} year - Year (e.g., 2024)
   * @param {number|null} month - Month number (1-12) or null for all months
   * @param {number|null} imoNumber - Filter by specific vessel IMO
   */
  async getAEDashboardSummary(year, month = null, imoNumber = null) {
    console.log('📊 Get AE Dashboard Summary:', { year, month, imoNumber });
    
    const params = new URLSearchParams({ year: year.toString() });
    
    if (month !== null) {
      params.append('month', month.toString());
    }
    
    if (imoNumber !== null) {
      params.append('imo_number', imoNumber.toString());
    }
    
    return this.request(`/api/performance/ae-dashboard-summary?${params.toString()}`);
  }

  /**
   * Get detailed AE alerts for a specific report
   * @param {number} reportId - Report ID
   */
  async getAEAlertDetails(reportId) {
    console.log('🔍 Get AE Alert Details for report:', reportId);
    return this.request(`/performance/ae-alerts/${reportId}`);
  }

  /**
   * Get AE alert summary (fast O(1) query)
   * @param {number} reportId - Report ID
   */
  async getAEAlertSummary(reportId) {
    console.log('📋 Get AE Alert Summary for report:', reportId);
    return this.request(`/performance/ae-alerts/summary/${reportId}`);
  }

  /**
   * Get fleet-wide AE alert status
   * @param {number|null} year - Filter by year
   * @param {number|null} month - Filter by month
   * @param {number|null} imoNumber - Filter by vessel
   * @param {string|null} statusFilter - 'Normal', 'Warning', or 'Critical'
   */
  async getAEFleetAlertSummary(year = null, month = null, imoNumber = null, statusFilter = null) {
    console.log('🚢 Get AE Fleet Alert Summary');
    
    const params = new URLSearchParams();
    if (year) params.append('year', year.toString());
    if (month) params.append('month', month.toString());
    if (imoNumber) params.append('imo_number', imoNumber.toString());
    if (statusFilter) params.append('status_filter', statusFilter);
    
    // CRITICAL FIX: Updated URL to prevent routing conflict (matches new backend route)
    return this.request(`/performance/ae-alerts/fleet?${params.toString()}`);
  }

  /**
   * Reprocess alerts for a specific report
   * @param {number} reportId - Report ID
   */
  async reprocessAEAlerts(reportId) {
    console.log('🔄 Reprocess AE Alerts for report:', reportId);
    return this.request(`/performance/ae-alerts/reprocess/${reportId}`, {
      method: 'POST'
    });
  
  }
  // ==================== MAIN ENGINE FLEET OVERVIEW ENDPOINTS ====================

/**
 * Get propeller margin overview for entire fleet
 */
async getPropellerMarginOverview() {
  console.log('📊 Get Propeller Margin Overview');
  return this.request('/api/v1/fleet/propeller-margin-overview');
}

/**
 * Get days elapsed since last report for entire fleet
 */
async getDaysElapsedOverview() {
  console.log('📊 Get Days Elapsed Overview');
  return this.request('/api/v1/fleet/days-elapsed-overview');
}
  // ==================== AUXILIARY ENGINE FLEET OVERVIEW ENDPOINTS ====================

/**
 * Get AE performance overview (latest running hours and load history) for entire fleet
 */
async getAEPerformanceOverview() {
  console.log('📊 Get AE Performance Overview (Hours & Load History)');
  // CRITICAL: Call the existing, correctly implemented backend endpoint
  return this.request('/api/v1/fleet/ae-performance-overview');
}
 async getAEReportDetails(reportId) {
    console.log('🔍 Get AE Report Details for Modal:', reportId);
    return this.request(`/api/v1/fleet/ae-report-details/${reportId}`);
  }
async getMainEngineDeviationHistory(imoNumber, refDate = null) {
  console.log("📊 Get ME Deviation Table History for:", imoNumber, "Ref Date:", refDate);
  let url = `/api/me-engine/deviation/history-table/${imoNumber}?limit=6`;
  if (refDate) {
    const cleaned = refDate.match(/^\d{4}-\d{2}/)?.[0];
    if (cleaned) url += `&ref_date=${cleaned}`;
  }
  return this.request(url);
}
 // ==================== LUBE OIL ENDPOINTS ====================

  // ==================== LUBE OIL ENDPOINTS ====================

  // async getLuboilLiveFeed() {
  //   console.log('📡 Fetching Luboil Live Feed');
  //   return this.request('/api/luboil/live-feed');
  // }

  /**
   * Mark a specific live feed event as read for the current user
   */
  async markLuboilEventRead(eventId) {
    console.log('✅ Marking Live Feed event as read:', eventId);
    return this.request(`/api/luboil/live-feed/${eventId}/read`, {
      method: 'PATCH'
    });
  }

  async uploadVesselManualReport(formData) {
    console.log('📤 Uploading Manual Vessel Report');
    const token = this.getToken();
    
    const response = await fetch(`${this.baseURL}/api/luboil/vessel/manual-upload`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vessel report upload failed: ${errorText}`);
    }
    
    return await response.json();
  }

  async generateSasUrl(blobUrl) {
    if (!blobUrl) return null;
    try {
      const res = await this.request(`/api/blob/freshen-url?blob_url=${encodeURIComponent(blobUrl)}`);
      // Ensure you return the specific string property, not the whole 'res' object
      return res.signed_url; 
    } catch (error) {
      console.error("Error signing URL:", error);
      return null;
    }
  }

  /**
   * Bulk mark all events in the feed as read for the current user
   */
  async markAllLuboilEventsRead() {
    console.log('🧹 Marking all Live Feed events as read');
    return this.request('/api/luboil/live-feed/read-all', {
      method: 'POST'
    });
  }
  async getLuboilTrend(imo, code) {
    if (!imo || !code) {
        console.error("Missing parameters for Trend API", { imo, code });
        return [];
    }
    console.log('📈 Fetching Luboil Trend:', { imo, code });
    // This calls your backend: @app.get("/api/v1/luboil/trend/{imo}/{equipment_code}")
    return this.request(`/api/v1/luboil/trend/${imo}/${code}`);
}
async getVesselMentions(imoNumber, chatMode = 'external') {
    console.log('👥 Fetching Vessel Mentions for IMO:', imoNumber, 'Mode:', chatMode);
    return this.request(`/api/luboil/mentions/${imoNumber}?chat_mode=${chatMode}`);
  }
  async getLuboilFleetOverview() {
    console.log('🛢️ Get Lube Oil Fleet Overview');
    return this.request('/api/v1/fleet/luboil-overview');
  }

  /**
   * Fetch Luboil reports for a specific vessel.
   * Logic: Returns only the latest 3 DISTINCT reports.
   * If a report is within 25 days of the previous one, it is considered 
   * a re-analysis (superseded) and is ignored.
   */
  async getLuboilReports(imoNumber) {
    console.log('🛢️ Get Luboil Reports (Filtered) for IMO:', imoNumber);
    
    // 1. Fetch raw list from backend
    // Note: Ensure your backend has an endpoint that returns the list of reports for this IMO
    const rawReports = await this.request(`/api/luboil/reports/${imoNumber}`);

    if (!Array.isArray(rawReports) || rawReports.length === 0) {
      return [];
    }

    // 2. Sort by Date (Newest First) - handles 'sample_date' or 'date'
    const sortedReports = rawReports.sort((a, b) => {
      const dateA = new Date(a.sample_date || a.date);
      const dateB = new Date(b.sample_date || b.date);
      return dateB - dateA;
    });

    // 3. Filter based on 25-day logic
    const distinctReports = [];
    let lastAcceptedDate = null;

    for (const report of sortedReports) {
      const currentReportDate = new Date(report.sample_date || report.date);

      if (!lastAcceptedDate) {
        // Always accept the very latest file found
        distinctReports.push(report);
        lastAcceptedDate = currentReportDate;
        continue;
      }

      // Calculate difference in days
      const diffTime = Math.abs(lastAcceptedDate - currentReportDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 25) {
        // Difference is >= 25 days, so this is a NEW distinct report
        distinctReports.push(report);
        lastAcceptedDate = currentReportDate;
      } else {
        // Difference < 25 days: Treat as re-analysis of the same month, skip this older version
        console.log(`Skipping superseded report from ${currentReportDate.toISOString().split('T')[0]}`);
      }

      // Stop once we have 3 reports
      if (distinctReports.length >= 3) break;
    }

    return distinctReports;
  }

  async updateLuboilRemarks(payload) {
    console.log('📝 Update Lube Oil Remarks:', payload);
    return this.request('/api/luboil/remarks/update', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async uploadLuboilReport(file) {
    console.log('📤 Upload Lube Oil Report');
    const formData = new FormData();
    formData.append('file', file);
    
    // Note: The endpoint in api.py was defined as /upload-luboil-report/
    const token = this.getToken();
    const response = await fetch(`${this.baseURL}/upload-luboil-report/`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${errorText}`);
    }
    return await response.json();
  }

  async uploadLuboilAttachment(formData) {
    console.log('📤 Uploading Luboil Image Attachment');
    
    // Using the internal request helper which handles the Authorization token
    return this.request('/api/luboil/upload-attachment', {
      method: 'POST',
      body: formData,
      // No need to set Content-Type, the browser/fetch handles FormData automatically
    });
  }

  
  async getPropellerMarginTrend() {
    console.log('📈 Get Propeller Margin Trend');
    return this.request('/api/v1/fleet/propeller-margin-trend');
  }
  async uploadGeneratedReportPDF(formData) {
    console.log('☁️ Sending PDF to Azure...');
    return this.request('/api/reports/upload-generated', {
      method: 'POST',
      body: formData,
    });
  }
// Add inside the ApiService class in lib/api.js

  /**
   * Upload Shop Trial PDF for Main Engine
   * @param {FormData} formData - Contains 'file' and 'imo_number'
   */
  async uploadShopTrialReport(formData) {
    console.log('📤 Upload Shop Trial Report');
    
    const token = this.getToken();
    
    // Using direct fetch to ensure Content-Type header is handled automatically by browser for FormData
    const response = await fetch(`${this.baseURL}/upload-shop-trial-report/`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Upload failed (${response.status})`;
      
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail) {
          errorMessage = errorJson.detail;
        }
      } catch (e) {
        errorMessage += `: ${errorText}`;
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('✅ Shop Trial upload successful:', result);
    return result;
  }
   /**
   * Get the View URL for a specific vessel's Shop Trial PDF
   * @param {string|number} imoNumber 
   */
  async getShopTrialUrl(imoNumber) {
    console.log('🔍 Get Shop Trial URL for IMO:', imoNumber);
    return this.request(`/api/shop-trial-url/${imoNumber}`);
  }
  async getShopTrialDataValues(imoNumber) {
    console.log('📊 Get Shop Trial Data Values for IMO:', imoNumber);
    return this.request(`/api/shop-trial-details/${imoNumber}`);
  }
  // ==================== AE SHOP TRIAL ENDPOINTS ====================

  /**
   * Upload Shop Trial PDF for a specific Auxiliary Engine
   * @param {FormData} formData - Contains 'file' and 'generator_id'
   */
  async uploadAEShopTrialReport(formData) {
    console.log('📤 Upload AE Shop Trial Report');
    const token = this.getToken();
    
    // ✅ FIX: Updated URL to match api.py
    const response = await fetch(`${this.baseURL}/api/aux/upload-shop-trial/`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Improved error parsing
      let errorMessage = `Upload failed (${response.status})`;
      try {
          const jsonError = JSON.parse(errorText);
          if(jsonError.detail) errorMessage = jsonError.detail;
      } catch(e) {}
      
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('✅ AE Shop Trial upload successful:', result);
    return result;
  }

  /**
   * Get the View URL for a specific Generator's Shop Trial PDF
   * @param {number} generatorId 
   */
  async getAEShopTrialUrl(generatorId) {
    console.log('🔍 Get AE Shop Trial URL for Generator:', generatorId);
    
    // ✅ FIX: Updated URL to match api.py
    return this.request(`/api/aux/shop-trial-url/${generatorId}`);
  }

  /**
   * Get the Data Values for a specific Generator's Shop Trial
   * @param {number} generatorId 
   */
  async getAEShopTrialDataValues(generatorId) {
    console.log('📊 Get AE Shop Trial Data Values for Generator:', generatorId);
    
    // ✅ FIX: Updated URL to match api.py pattern (/api/aux/...)
    return this.request(`/api/aux/shop-trial-details/${generatorId}`);
  }
  

  // ==================== VOYAGE PERFORMANCE ENDPOINTS ====================

  /**
   * Get detailed summary for a specific voyage (The Card view)
   * @param {number} imoNumber 
   * @param {number|string} voyageNo 
   */
  async getVoyageSummary(imoNumber, voyageNo) {
    console.log(`🚢 Fetching Voyage Summary: IMO ${imoNumber}, Voyage ${voyageNo}`);
    return this.request(`/api/voyage/summary/${imoNumber}/${voyageNo}`);
  }

  /**
   * Get chart data for Speed vs Slip and RPM vs Bunker (The Analytics view)
   * @param {number} imoNumber 
   * @param {number|string} voyageNo 
   */
  async getVoyageAnalytics(imoNumber, voyageNo) {
    console.log(`📊 Fetching Voyage Analytics: IMO ${imoNumber}, Voyage ${voyageNo}`);
    return this.request(`/api/voyage/analytics/${imoNumber}/${voyageNo}`);
  }

  /**
   * Get the table data for all voyages (The big table at the bottom)
   * @param {number} imoNumber 
   */
  async getVoyagePerformanceTable(imoNumber) {
    console.log(`📜 Fetching Voyage Performance Table for IMO: ${imoNumber}`);
    return this.request(`/api/voyage/performance-table/${imoNumber}`);
  }

  /**
   * Get the saved weather thresholds (Beaufort/Wave)
   * @param {number} imoNumber 
   */
  async getVoyageWeatherConfig(imoNumber) {
    console.log(`🌡️ Fetching Weather Config for IMO: ${imoNumber}`);
    return this.request(`/api/voyage/weather-config/${imoNumber}`);
  }

  /**
   * Update weather thresholds from the UI
   * @param {number} imoNumber 
   * @param {Object} config - { fairWind, modWind, etc. }
   */
  async updateVoyageWeatherConfig(imoNumber, config) {
    console.log(`💾 Updating Weather Config for IMO: ${imoNumber}`, config);
    return this.request(`/api/voyage/weather-config/${imoNumber}`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  /**
   * Get Emission Details (CII, ETS, Fuel EU)
   * @param {number} imoNumber 
   * @param {number} year 
   */
  async getVoyageEmissions(imoNumber, year) {
    console.log(`🌿 Fetching Emission Details for IMO ${imoNumber}, Year ${year}`);
    return this.request(`/api/voyage/emissions/${imoNumber}/${year}`);
  }
 
}


export const axiosAepms = new ApiService();
export default axiosAepms;