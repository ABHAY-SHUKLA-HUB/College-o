const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { saveBufferToLocal } = require('./localUploadService');
const { uploadBufferToAzure } = require('./blobService');
const { uploadBufferToSupabase } = require('./supabaseStorage');

const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

function getStorageProvider() {
  const provider = String(process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowLocalInProduction = String(process.env.ALLOW_LOCAL_UPLOADS_IN_PRODUCTION || '').toLowerCase() === 'true';

  if (isProduction) return 'supabase';
  if (provider === 'supabase') return 'supabase';
  if (provider === 'azure') return 'azure';
  if (provider === 'local') {
    if (isProduction && !allowLocalInProduction) {
      throw new Error('STORAGE_PROVIDER=local is blocked in production unless ALLOW_LOCAL_UPLOADS_IN_PRODUCTION=true');
    }
    return 'local';
  }

  if (isProduction) return 'azure';
  return 'local';
}

function getFileExtension(file) {
  const fromName = path.extname(String(file?.originalname || '')).toLowerCase();
  if (fromName) return fromName;
  return MIME_EXTENSIONS[file?.mimetype] || '';
}

function sanitizeBaseName(name) {
  return String(name || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file';
}

function getDeclaredMime(file) {
  return String(file?.mimetype || '').toLowerCase();
}

function detectBufferSignature(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) {
    return null;
  }

  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand.includes('qt')) {
      return 'video/quicktime';
    }
    return 'video/mp4';
  }

  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'video/webm';
  }

  return null;
}

function buildUploadValidationError(message = 'Unsupported file content') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_UPLOAD_FILE';
  error.exposeInProduction = true;
  return error;
}

function assertValidUploadBuffer(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw buildUploadValidationError('Missing upload buffer');
  }

  const declaredMime = getDeclaredMime(file);
  const originalExt = path.extname(String(file?.originalname || '')).toLowerCase();
  const detectedMime = detectBufferSignature(file.buffer);

  if (!detectedMime) {
    if (declaredMime === 'text/plain' || originalExt === '.txt') {
      if (file.buffer.includes(0x00)) {
        throw buildUploadValidationError('Plain text uploads may not contain binary data');
      }
      return { detectedMime: 'text/plain' };
    }

    throw buildUploadValidationError('Unsupported file content');
  }

  const expectedByExt = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm'
  }[originalExt] || null;

  if (declaredMime && declaredMime !== detectedMime && declaredMime !== expectedByExt) {
    throw buildUploadValidationError('File content does not match the declared file type');
  }

  if (expectedByExt && expectedByExt !== detectedMime) {
    throw buildUploadValidationError('File extension does not match the file content');
  }

  return { detectedMime };
}

function createSafeFileName(file, prefix = 'upload') {
  const ext = getFileExtension(file);
  const cleanPrefix = sanitizeBaseName(prefix);
  const token = crypto.randomBytes(8).toString('hex');
  return `${Date.now()}-${cleanPrefix}-${token}${ext}`;
}

function createUploadMiddleware({
  maxFileSize = 5 * 1024 * 1024,
  allowedMimeTypes = null,
  allowedExtensions = null,
  invalidTypeMessage = 'Unsupported file type'
} = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize },
    fileFilter: (_req, file, cb) => {
      const mime = String(file?.mimetype || '').toLowerCase();
      const ext = getFileExtension(file);

      if (Array.isArray(allowedMimeTypes) && allowedMimeTypes.length && !allowedMimeTypes.includes(mime)) {
        return cb(new Error(invalidTypeMessage));
      }

      if (Array.isArray(allowedExtensions) && allowedExtensions.length && !allowedExtensions.includes(ext)) {
        return cb(new Error(invalidTypeMessage));
      }

      return cb(null, true);
    }
  });
}

async function saveUploadedFile({
  file,
  folder = '',
  prefix = 'upload',
  visibility,
  signedUrlTtlSeconds,
  userId = null,
  uploadedBy = null,
  ownerType = 'user',
  entityType = null,
  entityId = null
}) {
  if (!file) return null;

  const validation = assertValidUploadBuffer(file);

  const fileName = createSafeFileName(file, prefix);
  const provider = getStorageProvider();

  if (provider === 'supabase') {
    return uploadBufferToSupabase({
      buffer: file.buffer,
      fileName,
      folder,
      contentType: validation.detectedMime || file.mimetype || 'application/octet-stream',
      visibility,
      signedUrlTtlSeconds,
      userId,
      uploadedBy,
      ownerType,
      entityType,
      entityId,
      originalName: file.originalname,
      fileExtension: getFileExtension(file)
    });
  }

  if (provider === 'azure') {
    return uploadBufferToAzure({
      buffer: file.buffer,
      fileName,
      folder,
      contentType: validation.detectedMime || file.mimetype || 'application/octet-stream'
    });
  }

  return saveBufferToLocal({
    buffer: file.buffer,
    fileName,
    folder
  });
}

module.exports = {
  createUploadMiddleware,
  saveUploadedFile,
  getStorageProvider,
  createSafeFileName,
  assertValidUploadBuffer,
  detectBufferSignature
};