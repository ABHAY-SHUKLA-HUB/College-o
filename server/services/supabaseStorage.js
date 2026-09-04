const { createClient } = require('@supabase/supabase-js');
const { pool } = require('../db/pool');

const DEFAULT_BUCKET = 'college-os';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

let client = null;

function getConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase Storage configuration is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  return { url, serviceRoleKey, bucket };
}

function getClient() {
  if (!client) {
    const { url, serviceRoleKey } = getConfig();
    client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return client;
}

function normalizePath(value) {
  return String(value || '')
    .replace(/\\+/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function getBucket() {
  return getConfig().bucket;
}

function isSupabaseStorageConfigured() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return Boolean(url && serviceRoleKey && /^https:\/\//i.test(url) && serviceRoleKey.length >= 20);
}

function validateSupabaseStorageConfiguration() {
  const { url, serviceRoleKey, bucket } = getConfig();
  if (!/^https:\/\//i.test(url)) {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL.');
  }
  if (serviceRoleKey.length < 20) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is invalid or incomplete.');
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(bucket)) {
    throw new Error('SUPABASE_STORAGE_BUCKET contains invalid characters.');
  }
  return { bucket };
}

function getVisibility(folder, requestedVisibility) {
  if (requestedVisibility === 'public' || requestedVisibility === 'private') {
    return requestedVisibility;
  }

  const normalizedFolder = normalizePath(folder).toLowerCase();
  return normalizedFolder.startsWith('users/') || normalizedFolder.startsWith('support/')
    ? 'private'
    : 'public';
}

async function uploadBufferToSupabase({
  buffer,
  fileName,
  folder = '',
  contentType = 'application/octet-stream',
  visibility,
  signedUrlTtlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
  userId = null,
  uploadedBy = null,
  ownerType = 'user',
  entityType = null,
  entityId = null,
  originalName = fileName,
  fileExtension = null
}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Missing upload buffer');
  if (!fileName) throw new Error('Missing upload file name');

  const bucket = getBucket();
  const storagePath = normalizePath(`${folder}/${fileName}`);
  if (!storagePath) throw new Error('Missing Supabase Storage path');

  const storage = getClient().storage.from(bucket);
  const { error: uploadError } = await storage.upload(storagePath, buffer, {
    contentType,
    upsert: false,
    cacheControl: '3600'
  });
  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }

  const fileVisibility = getVisibility(folder, visibility);
  let metadataResult;
  try {
    metadataResult = await pool.query(
      `INSERT INTO uploaded_files (
         user_id, uploaded_by, owner_type, entity_type, entity_id, bucket,
         storage_path, original_name, stored_name, mime_type, file_extension,
         file_size, visibility
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        userId,
        uploadedBy,
        ownerType,
        entityType,
        entityId,
        bucket,
        storagePath,
        String(originalName || fileName),
        fileName,
        contentType,
        fileExtension,
        buffer.length,
        fileVisibility
      ]
    );
  } catch (error) {
    await storage.remove([storagePath]).catch(() => {});
    throw new Error(`Supabase Storage metadata write failed: ${error.message}`);
  }

  const metadataId = metadataResult.rows[0]?.id;
  const url = `/api/files/${metadataId}`;

  return {
    provider: 'supabase',
    bucket,
    key: storagePath,
    path: storagePath,
    visibility: fileVisibility,
    url
  };
}

async function deleteFileFromSupabase({ bucket = getBucket(), path: storagePath, key }) {
  const normalizedPath = normalizePath(storagePath || key);
  if (!normalizedPath) return { deleted: false, reason: 'missing_path' };

  const { error } = await getClient().storage.from(bucket).remove([normalizedPath]);
  if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
  return { deleted: true, bucket, key: normalizedPath };
}

async function deleteUploadedFileById(fileId) {
  const normalizedId = Number(fileId);
  if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) return false;

  const result = await pool.query(
    `SELECT bucket, storage_path
     FROM uploaded_files
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [normalizedId]
  );
  const file = result.rows[0];
  if (!file) return false;

  await deleteFileFromSupabase({ bucket: file.bucket, path: file.storage_path });
  await pool.query(
    'UPDATE uploaded_files SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [normalizedId]
  );
  return true;
}

async function createSignedSupabaseUrl({ bucket = getBucket(), path: storagePath, key, expiresIn = DEFAULT_SIGNED_URL_TTL_SECONDS }) {
  const normalizedPath = normalizePath(storagePath || key);
  if (!normalizedPath) throw new Error('Missing Supabase Storage path');
  const { data, error } = await getClient().storage.from(bucket).createSignedUrl(
    normalizedPath,
    Math.max(60, Number(expiresIn) || DEFAULT_SIGNED_URL_TTL_SECONDS)
  );
  if (error) throw new Error(`Supabase Storage signed URL failed: ${error.message}`);
  return data.signedUrl;
}

module.exports = {
  createSignedSupabaseUrl,
  deleteUploadedFileById,
  deleteFileFromSupabase,
  getBucket,
  isSupabaseStorageConfigured,
  normalizePath,
  validateSupabaseStorageConfiguration,
  uploadBufferToSupabase
};