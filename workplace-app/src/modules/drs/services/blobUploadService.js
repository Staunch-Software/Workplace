// services/blobUploadService.js - DIAGNOSTIC VERSION
import { defectApi } from './defectApi';

/**
 * Extracts clean blob path from potentially corrupted URL
 * Handles cases where URL has been recursively appended
 */
const extractCleanPath = (input) => {
  if (!input) return null;
  
  // If it's already a clean path (no http), return it
  if (!input.includes('http://') && !input.includes('https://')) {
    return input;
  }
  
  console.log('⚠️ [BLOB] Detected URL in path, extracting clean path...');
  console.log('   Input:', input.substring(0, 200) + '...');
  
  // Extract the actual path using regex
  // Pattern: find "defects/..." before any query parameters
  const match = input.match(/defects\/[^?]+/);
  
  if (match) {
    const cleanPath = match[0];
    console.log('✅ [BLOB] Extracted clean path:', cleanPath);
    return cleanPath;
  }
  
  console.error('❌ [BLOB] Could not extract clean path from:', input);
  throw new Error('Invalid blob path format - unable to extract clean path');
};

/**
 * Helper function to upload any blob to Azure Storage
 * @param {Blob} blob - The blob to upload
 * @param {string} blobPath - The blob path in Azure (e.g., "defects/123/attachments/file.pdf")
 * @returns {string} The blob path (without SAS token)
 */
const uploadToAzure = async (blob, blobPath) => {
  console.log('🔧 [BLOB] Starting upload process...');
  console.log('   Blob path:', blobPath);
  console.log('   Blob size:', blob.size);
  console.log('   Blob type:', blob.type);

  // CRITICAL: Validate that blobPath is clean
  if (blobPath.startsWith('http://') || blobPath.startsWith('https://')) {
    const error = `❌ CRITICAL: blobPath must be a relative path, not a URL: ${blobPath}`;
    console.error(error);
    throw new Error(error);
  }

  // STEP 1: Request signed URL from backend
  console.log('📡 [BLOB] Step 1: Requesting signed URL from backend...');
  console.log('   Calling defectApi.getUploadSasUrl with:', blobPath);
  
  let sasResponse;
  try {
    sasResponse = await defectApi.getUploadSasUrl(blobPath);
    console.log('✅ [BLOB] Signed URL response received');
    console.log('   Response type:', typeof sasResponse);
    console.log('   Response keys:', Object.keys(sasResponse || {}));
    console.log('   Full response:', JSON.stringify(sasResponse, null, 2));
  } catch (error) {
    console.error('❌ [BLOB] Failed to get signed URL:', error);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    throw new Error(`Failed to get upload SAS URL: ${error.message}`);
  }

  // Validate response structure
  if (!sasResponse || typeof sasResponse !== 'object') {
    const error = '❌ [BLOB] Invalid response from getUploadSasUrl - not an object';
    console.error(error);
    console.error('   Received:', sasResponse);
    throw new Error(error);
  }

  const signedUrl = sasResponse.url;
  
  if (!signedUrl) {
    const error = '❌ [BLOB] No URL in response from getUploadSasUrl';
    console.error(error);
    console.error('   Response was:', JSON.stringify(sasResponse, null, 2));
    throw new Error(error);
  }

  console.log('✅ [BLOB] Signed URL extracted successfully');
  console.log('   URL length:', signedUrl.length);
  console.log('   URL starts with:', signedUrl.substring(0, 50));
  console.log('   URL ends with:', signedUrl.substring(signedUrl.length - 50));

  // STEP 2: Validate the signed URL format
  if (!signedUrl.startsWith('http://') && !signedUrl.startsWith('https://')) {
    const error = `❌ [BLOB] Invalid signed URL format - must start with https://. Got: ${signedUrl.substring(0, 20)}...`;
    console.error(error);
    throw new Error(error);
  }

  // STEP 3: Upload the file directly to Azure using that signed URL
  console.log('📤 [BLOB] Step 2: Uploading blob to Azure Storage...');
  console.log('   Upload size:', blob.size, 'bytes');
  console.log('   Content type:', blob.type || 'application/octet-stream');
  
  let uploadResponse;
  try {
    uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': blob.type || 'application/octet-stream',
      },
      body: blob,
    });
    
    console.log('📥 [BLOB] Upload response received');
    console.log('   Status:', uploadResponse.status);
    console.log('   Status text:', uploadResponse.statusText);
    console.log('   OK:', uploadResponse.ok);
    console.log('   Headers:', Object.fromEntries(uploadResponse.headers.entries()));
  } catch (error) {
    console.error('❌ [BLOB] Network error during upload:', error);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    throw new Error(`Network error during Azure upload: ${error.message}`);
  }

  // STEP 4: Validate upload response
  if (!uploadResponse.ok) {
    console.error('❌ [BLOB] Upload failed with status:', uploadResponse.status);
    
    let errorText;
    try {
      errorText = await uploadResponse.text();
      console.error('   Error response body:', errorText);
    } catch (textError) {
      console.error('   Could not read error response:', textError);
      errorText = 'Unable to read error response';
    }
    
    throw new Error(`Azure Upload Failed: ${uploadResponse.status} - ${uploadResponse.statusText}. Details: ${errorText}`);
  }

  console.log('✅ [BLOB] Upload successful!');
  console.log('   Uploaded to path:', blobPath);
  
  // STEP 5: Final validation - ensure we return ONLY the path
  if (blobPath.includes('http://') || blobPath.includes('https://')) {
    const error = `❌ [BLOB] CRITICAL: About to return URL instead of path: ${blobPath}`;
    console.error(error);
    throw new Error(error);
  }
  
  console.log('✅ [BLOB] Returning clean path:', blobPath);
  return blobPath;
};

export const blobUploadService = {
  /**
   * Uploads a binary file (image, PDF, etc.) to Azure Blob Storage
   * @param {File} file - The file object from input
   * @param {string} defectId - The defect ID (used for folder structure)
   * @param {string} attachmentId - Unique ID for this attachment
   * @returns {string} The blob path (WITHOUT SAS token or URL)
   */
  uploadBinary: async (file, defectId, attachmentId) => {
    console.log('\n====================================');
    console.log('📤 [BLOB] uploadBinary() called');
    console.log('====================================');
    
    try {
      // Generate clean blob path (IMPORTANT: No URL, just the path!)
      const timestamp = Date.now();
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      // ✅ CRITICAL: This must be ONLY the path, not a full URL
      const blobPath = `defects/${defectId}/attachments/${attachmentId}_${timestamp}_${sanitizedFileName}`;

      console.log('📋 [BLOB] Binary upload details:', {
        fileName: file.name,
        sanitizedName: sanitizedFileName,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        type: file.type,
        defectId,
        attachmentId,
        blobPath
      });

      // ⚠️ VALIDATION: Ensure blob path doesn't contain URL
      if (blobPath.includes('http://') || blobPath.includes('https://')) {
        throw new Error(`❌ CRITICAL: Invalid blob path - contains URL: ${blobPath}`);
      }

      // Verify path structure
      if (!blobPath.startsWith('defects/')) {
        throw new Error(`❌ CRITICAL: Invalid blob path structure: ${blobPath}`);
      }

      console.log('✅ [BLOB] Path validation passed');

      // Upload to Azure
      const resultPath = await uploadToAzure(file, blobPath);
      
      console.log('✅ [BLOB] Binary file uploaded successfully');
      console.log('   Input path:', blobPath);
      console.log('   Result path:', resultPath);
      console.log('   Paths match:', blobPath === resultPath);
      
      // Final validation of returned path
      if (resultPath.includes('http://') || resultPath.includes('https://')) {
        throw new Error(`❌ CRITICAL: Upload returned URL instead of path: ${resultPath}`);
      }
      
      console.log('====================================\n');
      return resultPath;

    } catch (error) {
      console.error('\n====================================');
      console.error('❌ [BLOB] uploadBinary() FAILED');
      console.error('====================================');
      console.error('   File name:', file.name);
      console.error('   Error type:', error.constructor.name);
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
      console.error('====================================\n');
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
    console.log('\n====================================');
    console.log('📄 [BLOB] uploadMetadataJSON() called');
    console.log('====================================');
    
    try {
      const timestamp = Date.now();
      
      // ✅ CRITICAL: Only the path, no URL
      const blobPath = `defects/${defectId}/metadata_backup_${timestamp}.json`;
      
      console.log('📋 [BLOB] JSON upload details:', {
        defectId,
        timestamp,
        blobPath,
        dataKeys: Object.keys(jsonData),
        dataSize: JSON.stringify(jsonData).length + ' characters'
      });

      // Validate
      if (blobPath.includes('http://') || blobPath.includes('https://')) {
        throw new Error(`❌ CRITICAL: Invalid blob path - contains URL: ${blobPath}`);
      }

      // Verify path structure
      if (!blobPath.startsWith('defects/')) {
        throw new Error(`❌ CRITICAL: Invalid blob path structure: ${blobPath}`);
      }

      console.log('✅ [BLOB] Path validation passed');

      // Convert JSON to Blob
      const jsonString = JSON.stringify(jsonData, null, 2);
      console.log('📝 [BLOB] JSON stringified:', jsonString.length, 'characters');
      
      const jsonBlob = new Blob([jsonString], { 
        type: 'application/json' 
      });
      console.log('📦 [BLOB] Blob created:', jsonBlob.size, 'bytes');

      // Upload to Azure
      console.log('📤 [BLOB] Starting Azure upload...');
      const resultPath = await uploadToAzure(jsonBlob, blobPath);
      
      console.log('✅ [BLOB] JSON metadata uploaded successfully!');
      console.log('   Input path:', blobPath);
      console.log('   Result path:', resultPath);
      console.log('   Paths match:', blobPath === resultPath);
      
      // Final validation
      if (resultPath.includes('http://') || resultPath.includes('https://')) {
        throw new Error(`❌ CRITICAL: Upload returned URL instead of path: ${resultPath}`);
      }

      if (!resultPath || resultPath.trim() === '') {
        throw new Error('❌ CRITICAL: Upload returned empty or null path');
      }

      console.log('====================================');
      console.log('🎉 JSON BACKUP UPLOAD COMPLETE');
      console.log('   Path to store in DB:', resultPath);
      console.log('====================================\n');
      
      return resultPath;

    } catch (error) {
      console.error('\n====================================');
      console.error('❌ [BLOB] uploadMetadataJSON() FAILED');
      console.error('====================================');
      console.error('   Defect ID:', defectId);
      console.error('   Error type:', error.constructor.name);
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
      console.error('====================================\n');
      throw error;
    }
  },

  /**
   * Utility function to clean corrupted blob paths
   * Use this to fix existing data
   */
  extractCleanPath
};