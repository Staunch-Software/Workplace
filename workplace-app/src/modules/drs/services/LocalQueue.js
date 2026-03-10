import { openDB } from 'idb';

const DB_NAME = 'defect_chat_queue';
const DB_VERSION = 1;

export const MESSAGE_STATUS = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  UPLOADING: 'UPLOADING',
  SYNCED: 'SYNCED',
  ERROR: 'ERROR'
};

export const ATTACHMENT_STATUS = {
  PENDING: 'PENDING',
  UPLOADING: 'UPLOADING',
  SYNCED: 'SYNCED',
  ERROR: 'ERROR'
};

export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('pending_defects')) {
        const defectStore = db.createObjectStore('pending_defects', { keyPath: 'local_defect_id' });
        defectStore.createIndex('by_status', 'sync_status');
      }
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'local_id' });
        msgStore.createIndex('by_defect', 'defect_id');
        msgStore.createIndex('by_status', 'sync_status');
      }
      if (!db.objectStoreNames.contains('attachments')) {
        const attachStore = db.createObjectStore('attachments', { keyPath: 'attachment_id' });
        attachStore.createIndex('by_local_id', 'local_id');
        attachStore.createIndex('by_status', 'sync_status');
      }
    },
  });
};

// --- WRITE OPERATIONS ---

export const enqueueDefect = async (formData) => {
  const db = await initDB();
  const localDefectId = `LOCAL-${crypto.randomUUID()}`;
  await db.put('pending_defects', {
    local_defect_id: localDefectId,
    ...formData,
    sync_status: 'READY',
    created_at: new Date().toISOString()
  });
  return localDefectId;
};

export const enqueueMessage = async (defectId, sender, message, hasAttachment = false) => {
  const db = await initDB();
  const localId = crypto.randomUUID();
  await db.put('messages', {
    local_id: localId,
    defect_id: defectId,
    sender,
    message,
    created_at: new Date().toISOString(),
    sync_status: hasAttachment ? MESSAGE_STATUS.DRAFT : MESSAGE_STATUS.READY,
    has_attachment: hasAttachment,
  });
  return localId;
};

export const enqueueAttachment = async (localId, file) => {
  const db = await initDB();
  const attachmentId = crypto.randomUUID();
  await db.put('attachments', {
    attachment_id: attachmentId,
    local_id: localId,
    file_name: file.name,
    file_type: file.type,
    file_size: file.size,
    file_blob: file, 
    sync_status: ATTACHMENT_STATUS.PENDING,
  });
  return attachmentId;
};

export const finalizeMessage = async (localId) => {
  const db = await initDB();
  const tx = db.transaction('messages', 'readwrite');
  const msg = await tx.store.get(localId);
  if (msg) {
    msg.sync_status = MESSAGE_STATUS.READY;
    await tx.store.put(msg);
  }
  await tx.done;
};

// --- READ OPERATIONS (For SyncEngine & UI) ---

export const getPendingMessages = async (defectId = null) => {
  const db = await initDB();
  const allMessages = await db.getAllFromIndex('messages', 'by_status');
  return allMessages.filter(msg => 
    (msg.sync_status === MESSAGE_STATUS.READY || msg.sync_status === MESSAGE_STATUS.ERROR) &&
    (!defectId || msg.defect_id === defectId)
  );
};

export const getPendingAttachments = async (localId) => {
  const db = await initDB();
  const attachments = await db.getAllFromIndex('attachments', 'by_local_id', localId);
  // Return metadata only (exclude blob for memory safety)
  return attachments.map(({ file_blob, ...metadata }) => metadata);
};

export const getAttachmentBlob = async (attachmentId) => {
  const db = await initDB();
  const attachment = await db.get('attachments', attachmentId);
  return attachment ? attachment.file_blob : null;
};

// --- UPDATE OPERATIONS (For SyncEngine) ---

export const markMessageAsSynced = async (localId, status = 'SYNCED', serverId = null) => {
  const db = await initDB();
  const tx = db.transaction('messages', 'readwrite');
  const msg = await tx.store.get(localId);
  if (msg) {
    msg.sync_status = status;
    if (serverId) msg.server_id = serverId;
    await tx.store.put(msg);
  }
  await tx.done;
};

export const markAttachmentAsSynced = async (attachmentId, status = 'SYNCED') => {
  const db = await initDB();
  const tx = db.transaction('attachments', 'readwrite');
  const attach = await tx.store.get(attachmentId);
  if (attach) {
    attach.sync_status = status;
    await tx.store.put(attach);
  }
  await tx.done;
};