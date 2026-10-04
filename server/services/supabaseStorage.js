const { createClient } = require('@supabase/supabase-js');
const { pool } = require('../db/pool');

const DEFAULT_BUCKET = 'college-os';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

let client = null;
const verifiedBuckets = new Set();
let bucketEnsurePromise = null;

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

async function ensureBucketExists(requestedBucket = getBucket()) {
  const targetBucket = String(requestedBucket || DEFAULT_BUCKET).trim();
  if (verifiedBuckets.has(targetBucket)) {
    return targetBucket;
  }

  const supabase = getClient();

  try {
    // 1. Check if the bucket already exists
    const { data: bucketData, error: getError } = await supabase.storage.getBucket(targetBucket);
    if (!getError && bucketData) {
      verifiedBuckets.add(targetBucket);
      return targetBucket;
    }

    // 2. List buckets to see if it exists in the list or find an alternative active bucket
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (!listError && Array.isArray(buckets)) {
      const match = buckets.find((b) => b.name === targetBucket || b.id === targetBucket);
      if (match) {
        verifiedBuckets.add(targetBucket);
        return targetBucket;
      }
    }

    // 3. Create the bucket via service role key
    console.info(`[SupabaseStorage] Creating missing storage bucket '${targetBucket}'...`);
    const { data: created, error: createError } = await supabase.storage.createBucket(targetBucket, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024 // 50MB
    });

    if (createError) {
      const isAlreadyExists = /already exists/i.test(createError.message) ||
        createError.statusCode === '409' ||
        createError.status === 409;
      if (isAlreadyExists) {
        verifiedBuckets.add(targetBucket);
        return targetBucket;
      }

      console.warn(`[SupabaseStorage] createBucket('${targetBucket}') returned:`, createError.message);

      // If existing buckets exist, use the first available bucket as fallback
      if (Array.isArray(buckets) && buckets.length > 0) {
        const fallbackBucket = buckets[0].name || buckets[0].id;
        console.info(`[SupabaseStorage] Using existing bucket '${fallbackBucket}' as active bucket`);
        verifiedBuckets.add(fallbackBucket);
        return fallbackBucket;
      }
    } else {
      console.info(`[SupabaseStorage] Successfully provisioned storage bucket '${targetBucket}'`);
      verifiedBuckets.add(targetBucket);
      return targetBucket;
    }
  } catch (err) {
    console.warn('[SupabaseStorage] Bucket check/provision error:', err.message);
  }

  verifiedBuckets.add(targetBucket);
  return targetBucket;
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

  // Pre-provision bucket asynchronously on startup
  if (!bucketEnsurePromise) {
    bucketEnsurePromise = ensureBucketExists(bucket).catch((err) => {
      console.warn('[SupabaseStorage] Initial bucket ensure non-fatal warning:', err.message);
    });
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

  const configuredBucket = getBucket();
  const bucket = await ensureBucketExists(configuredBucket);
  const storagePath = normalizePath(`${folder}/${fileName}`);
  if (!storagePath) throw new Error('Missing Supabase Storage path');

  const storage = getClient().storage.from(bucket);
  let { error: uploadError } = await storage.upload(storagePath, buffer, {
    contentType,
    upsert: false,
    cacheControl: '3600'
  });

  // If Supabase reports bucket not found, retry once after explicitly creating the bucket
  if (uploadError && /bucket not found/i.test(uploadError.message)) {
    console.warn(`[SupabaseStorage] Bucket '${bucket}' not found during upload. Auto-creating and retrying...`);
    verifiedBuckets.delete(bucket);
    await ensureBucketExists(bucket);
    const retryResult = await storage.upload(storagePath, buffer, {
      contentType,
      upsert: false,
      cacheControl: '3600'
    });
    uploadError = retryResult.error;
  }

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

  const targetBucket = bucket || getBucket();
  const { data, error } = await getClient().storage.from(targetBucket).createSignedUrl(
    normalizedPath,
    Math.max(60, Number(expiresIn) || DEFAULT_SIGNED_URL_TTL_SECONDS)
  );

  if (error) {
    // If signed URL creation failed, try getting public URL if bucket is public
    try {
      const { data: pubData } = getClient().storage.from(targetBucket).getPublicUrl(normalizedPath);
      if (pubData?.publicUrl) return pubData.publicUrl;
    } catch (_) {}
    throw new Error(`Supabase Storage signed URL failed: ${error.message}`);
  }

  return data.signedUrl;
}

module.exports = {
  createSignedSupabaseUrl,
  deleteUploadedFileById,
  deleteFileFromSupabase,
  ensureBucketExists,
  getBucket,
  isSupabaseStorageConfigured,
  normalizePath,
  validateSupabaseStorageConfiguration,
  uploadBufferToSupabase
};