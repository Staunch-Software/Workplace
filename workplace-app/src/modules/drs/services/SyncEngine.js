import * as LocalQueue from './LocalQueue';

const SYNC_LOCK_NAME = 'vessel_sync_lock';
const MAX_RETRIES = 5;
const SYNC_INTERVAL = 15000; // Check every 15 seconds

// --- MOCK API (Replace with real fetch/axios later) ---
const API = {
  postDefect: async (data) => {
    console.log("📡 API: Syncing Defect...", data);
    return new Promise((res) => setTimeout(() => res({ server_id: "SRV-" + Math.floor(Math.random() * 1000) }), 1000));
  },
  postMessage: async (data) => {
    console.log("📡 API: Syncing Message...", data);
    return new Promise((res) => setTimeout(() => res({ server_id: "MSG-" + Math.floor(Math.random() * 1000) }), 800));
  },
  postAttachment: async (formData) => {
    console.log("📡 API: Uploading File...");
    return new Promise((res) => setTimeout(() => res({ success: true }), 2000));
  }
};

/**
 * 1. Start the Engine
 */
export const startSyncEngine = async () => {
  // Multi-tab protection: Only one tab runs the sync
  navigator.locks.request(SYNC_LOCK_NAME, async () => {
    console.log("🔄 SyncEngine: Started (Lock Acquired)");
    
    await sanitizeStuckUploads();

    // Run immediately, then every X seconds
    attemptSync();
    setInterval(attemptSync, SYNC_INTERVAL);

    // Also run whenever the browser says we are back online
    window.addEventListener('online', () => {
      console.log("🌐 Internet is back! Triggering sync...");
      attemptSync();
    });
  });
};

/**
 * 2. Reset items stuck in 'UPLOADING' (e.g. after a crash)
 */
async function sanitizeStuckUploads() {
  const db = await LocalQueue.initDB();
  const stores = ['pending_defects', 'messages', 'attachments'];

  for (const storeName of stores) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const items = await store.getAll();

    for (const item of items) {
      if (item.sync_status === 'UPLOADING') {
        item.sync_status = 'READY'; 
        await store.put(item);
      }
    }
    await tx.done;
  }
}

/**
 * 3. The Sync Logic
 */
async function attemptSync() {
  if (!navigator.onLine) {
    console.log("☁️ Offline: Sync skipped.");
    return;
  }

  try {
    await syncDefects();
    await syncMessages();
    await syncAttachments();
  } catch (err) {
    console.error("❌ Sync Cycle Error:", err);
  }
}

async function syncDefects() {
  const db = await LocalQueue.initDB();
  const pending = await db.getAllFromIndex('pending_defects', 'by_status', 'READY');

  for (const defect of pending) {
    try {
      await updateStatus('pending_defects', defect.local_defect_id, 'UPLOADING');
      const res = await API.postDefect(defect);
      await updateStatus('pending_defects', defect.local_defect_id, 'SYNCED', { server_id: res.server_id });
    } catch (e) { await handleSyncError('pending_defects', defect.local_defect_id); }
  }
}

async function syncMessages() {
  const messages = await LocalQueue.getPendingMessages();
  const db = await LocalQueue.initDB();

  for (const msg of messages) {
    const parent = await db.get('pending_defects', msg.defect_id);
    if (!parent || parent.sync_status !== 'SYNCED') continue;

    try {
      await LocalQueue.markMessageAsSynced(msg.local_id, 'UPLOADING'); // We'll use a helper
      const res = await API.postMessage({ ...msg, defect_server_id: parent.server_id });
      await LocalQueue.markMessageAsSynced(msg.local_id, 'SYNCED', res.server_id);
    } catch (e) { await handleSyncError('messages', msg.local_id); }
  }
}

async function syncAttachments() {
  const db = await LocalQueue.initDB();
  const pending = await db.getAllFromIndex('attachments', 'by_status', 'PENDING');

  for (const attach of pending) {
    const parentMsg = await db.get('messages', attach.local_id);
    if (!parentMsg || parentMsg.sync_status !== 'SYNCED') continue;

    try {
      await LocalQueue.markAttachmentAsSynced(attach.attachment_id, 'UPLOADING');
      const blob = await LocalQueue.getAttachmentBlob(attach.attachment_id);
      
      const fd = new FormData();
      fd.append('file', blob);
      fd.append('msg_id', parentMsg.server_id);

      await API.postAttachment(fd);
      await LocalQueue.markAttachmentAsSynced(attach.attachment_id, 'SYNCED');
    } catch (e) { await handleSyncError('attachments', attach.attachment_id); }
  }
}

// --- Helpers ---
async function updateStatus(store, id, status, extra = {}) {
  const db = await LocalQueue.initDB();
  const item = await db.get(store, id);
  if (item) {
    Object.assign(item, { sync_status: status, ...extra });
    await db.put(store, item);
  }
}

async function handleSyncError(store, id) {
  const db = await LocalQueue.initDB();
  const item = await db.get(store, id);
  if (item) {
    item.sync_status = 'ERROR';
    await db.put(store, item);
  }
}