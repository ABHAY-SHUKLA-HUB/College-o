const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { saveBufferToLocal } = require('./localUploadService');
const { uploadBufferToAzure } = require('./blobService');

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

async function saveUploadedFile({ file, folder = '', prefix = 'upload' }) {
  if (!file) return null;

  const fileName = createSafeFileName(file, prefix);
  const provider = getStorageProvider();

  if (provider === 'azure') {
    return uploadBufferToAzure({
      buffer: file.buffer,
      fileName,
      folder,
      contentType: file.mimetype || 'application/octet-stream'
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
  createSafeFileName
};