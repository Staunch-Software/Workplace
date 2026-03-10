// services/blobUploadService.js
import { defectApi } from './defectApi';

export const blobUploadService = {
  /**
   * Uploads a binary file (image, PDF, etc.) to Azure Blob Storage
   * @param {File} file - The file object from input
   * @param {string} defectId - The defect ID (used for folder structure)
   * @param {string} attachmentId - Unique ID for this attachment
   * @returns {string} The blob path (WITHOUT SAS token)
   */
  uploadBinary: async (file, defectId, attachmentId) => {
    try {
      // 1. Generate the blob name (path in Azure)
      const timestamp = Date.now();
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const blobName = `defects/${defectId}/attachments/${attachmentId}_${timestamp}_${sanitizedFileName}`;

      console.log('📤 [BLOB] Uploading file:', {
        fileName: file.name,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        type: file.type,
        blobName
      });

      // 2. Get SAS URL from backend (includes authentication)
      const { url: sasUrl } = await defectApi.getUploadSasUrl(blobName);
      
      console.log('🔐 [BLOB] Got SAS URL from backend');

      // 3. Upload to Azure Blob Storage using SAS URL
      const uploadResponse = await fetch(sasUrl, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': file.type || 'application/octet-stream'
          // DO NOT include Authorization header - SAS token is already in the URL
        },
        body: file
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('❌ [BLOB] Upload failed:', {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          error: errorText
        });
        throw new Error(`Blob upload failed: ${uploadResponse.status} - ${uploadResponse.statusText}`);
      }

      console.log('✅ [BLOB] File uploaded successfully to Azure');

      // 4. Return ONLY the blob path (WITHOUT SAS token)
      // Backend will generate READ SAS URLs when fetching threads
      return blobName;

    } catch (error) {
      console.error('❌ [BLOB] Upload error:', error);
      throw new Error(`Failed to upload file "${file.name}": ${error.message}`);
    }
  },

  /**
   * Uploads JSON metadata backup to Azure Blob Storage
   * @param {Object} jsonData - The JSON object to upload
   * @param {string} defectId - The defect ID
   * @returns {string} The blob path
   */
  uploadMetadataJSON: async (jsonData, defectId) => {
    try {
      const timestamp = Date.now();
      const blobName = `defects/${defectId}/metadata_backup_${timestamp}.json`;
      
      console.log('📝 [BLOB] Uploading JSON metadata...');

      // Convert JSON to Blob
      const jsonBlob = new Blob([JSON.stringify(jsonData, null, 2)], { 
        type: 'application/json' 
      });
      
      // Create a File object from Blob
      const jsonFile = new File([jsonBlob], `metadata_${timestamp}.json`, { 
        type: 'application/json' 
      });

      // Use the same upload logic
      const path = await blobUploadService.uploadBinary(jsonFile, defectId, `metadata_${timestamp}`);
      
      console.log('✅ [BLOB] JSON metadata uploaded successfully');
      return path;

    } catch (error) {
      console.error('❌ [BLOB] JSON upload error:', error);
      throw error;
    }
  }
};