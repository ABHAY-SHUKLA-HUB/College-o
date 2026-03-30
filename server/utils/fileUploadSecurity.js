/**
 * File Upload Security Module
 * Comprehensive file upload validation and security checks
 * Prevents common file upload attacks (MIME type spoofing, arbitrary file execution, etc.)
 */

const path = require('path');

/**
 * MIME type to valid extensions mapping
 * Prevents mismatch attacks (e.g., .php renamed to .jpg)
 */
const SAFE_MIME_EXTENSIONS = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/zip': ['.zip'],
  'application/x-zip-compressed': ['.zip']
};

/**
 * Dangerous MIME types and extensions that should never be allowed
 * regardless of whitelist
 */
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr',           // Executable
  '.asp', '.aspx', '.jsp', '.php', '.php3', '.php4', '.php5', // Server-side scripts
  '.cgi', '.pl', '.py', '.sh', '.bash', '.zsh',             // Server-side scripts
  '.js', '.vbs', '.jse', '.vbe', '.ws', '.wsf', '.wsh',    // Script files
  '.msi', '.mso', '.mrt', '.srp', '.mar', '.dmg', '.pkg',   // Installers
  '.jar', '.class', '.clr',                                  // Java
  '.app', '.apk', '.deb', '.rpm', '.elf',                   // OS-specific binaries
  '.config', '.inf', '.ini', '.sys', '.dll', '.drv', '.lib', // System files
  '.tmp', '.bak', '.old',                                    // Temporary files
  '.swp', '.tmp', '.tmp2',                                   // Editor temp files
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'              // Archives (can contain malicious files)
];

const BLOCKED_MIME_TYPES = [
  'application/x-executable',
  'application/x-mach-binary',
  'application/x-sharedlib',
  'application/x-object',
  'application/x-archive',
  'application/x-windows-dos-executable',
  'application/x-executable-file'
];

/**
 * Validate file uploads for security issues
 * Returns { valid: boolean, error?: string }
 */
function validateFileUpload(file, options = {}) {
  const {
    allowedMimeTypes = [],
    allowedExtensions = [],
    maxFileSize = 5 * 1024 * 1024  // 5MB default
  } = options;

  // Check file object exists
  if (!file || typeof file !== 'object') {
    return { valid: false, error: 'Invalid file object' };
  }

  // Get file info
  const fileName = String(file.originalname || '');
  const mimeType = String(file.mimetype || '').toLowerCase();
  const fileSize = Number(file.size || 0);
  const ext = path.extname(fileName).toLowerCase();

  // Check filename
  if (!fileName || fileName.length === 0) {
    return { valid: false, error: 'Filename required' };
  }

  if (fileName.length > 255) {
    return { valid: false, error: 'Filename too long' };
  }

  // Check for dangerous characters in filename
  if (/[<>:"|?*]/.test(fileName)) {
    return { valid: false, error: 'Filename contains invalid characters' };
  }

  // Check file size
  if (fileSize > maxFileSize) {
    return { 
      valid: false, 
      error: `File too large (max ${Math.round(maxFileSize / 1024 / 1024)}MB)`
    };
  }

  if (fileSize === 0) {
    return { valid: false, error: 'File is empty' };
  }

  // Check for blocked extensions
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `File type not allowed: ${ext}` };
  }

  // Check for blocked MIME types
  if (BLOCKED_MIME_TYPES.includes(mimeType)) {
    return { valid: false, error: 'File type not allowed' };
  }

  // If allowedMimeTypes specified, validate MIME type
  if (allowedMimeTypes.length > 0) {
    if (!allowedMimeTypes.includes(mimeType)) {
      return { valid: false, error: 'File MIME type not allowed' };
    }

    // Validate MIME type matches extension
    const validExts = SAFE_MIME_EXTENSIONS[mimeType] || [];
    if (validExts.length > 0 && !validExts.includes(ext)) {
      return { 
        valid: false, 
        error: `File extension ${ext} doesn't match MIME type ${mimeType}` 
      };
    }
  }

  // If allowedExtensions specified, validate extension
  if (allowedExtensions.length > 0) {
    if (!allowedExtensions.includes(ext)) {
      return { valid: false, error: 'File extension not allowed' };
    }
  }

  // Check for double extensions (e.g., image.php.jpg)
  const nameParts = fileName.split('.');
  if (nameParts.length > 2) {
    const allExts = nameParts.slice(1);
    for (const checkExt of allExts) {
      if (BLOCKED_EXTENSIONS.includes(`.${checkExt.toLowerCase()}`)) {
        return { valid: false, error: 'File has suspicious double extension' };
      }
    }
  }

  return { valid: true };
}

/**
 * Generate safe filename for storage
 * Removes or sanitizes dangerous characters
 */
function generateSafeFileName(originalName = 'file', prefix = '') {
  const ext = path.extname(originalName).toLowerCase();
  const baseName = path.basename(originalName, ext)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const cleanBase = baseName || 'file';
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  
  let fileName = `${timestamp}-${cleanBase}-${random}${ext}`;
  if (prefix) {
    fileName = `${prefix}-${fileName}`;
  }

  return fileName;
}

/**
 * Create safe upload directory path with validation
 * Prevents directory traversal attacks
 */
function createSafeUploadPath(folder = '', baseDir = '') {
  if (!baseDir) {
    throw new Error('Base directory required');
  }

  // Sanitize folder path
  const cleanFolder = String(folder || '')
    .replace(/\\/g, '/')           // Windows path normalization
    .replace(/\/+/g, '/')           // Multiple slashes
    .replace(/^\/+|\/+$/g, '')      // Leading/trailing slashes
    .replace(/\.\./g, '');          // Prevent traversal

  if (!cleanFolder) {
    return baseDir;
  }

  // Ensure path stays within base directory
  const fullPath = require('path').join(baseDir, cleanFolder);
  const resolvedBase = require('path').resolve(baseDir);
  const resolvedFull = require('path').resolve(fullPath);

  if (!resolvedFull.startsWith(resolvedBase)) {
    throw new Error('Invalid upload path - directory traversal detected');
  }

  return resolvedFull;
}

/**
 * Check if file should be served as-is or force download
 * Prevents XSS from user-uploaded files
 */
function shouldForceDownload(mimeType) {
  const dangerousMimes = [
    'text/html',
    'text/html-script',
    'application/javascript',
    'text/javascript',
    'application/x-javascript',
    'text/x-javascript',
    'text/xml',
    'application/xml',
    'text/svg+xml',
    'image/svg+xml'
  ];

  return dangerousMimes.includes(mimeType.toLowerCase());
}

module.exports = {
  validateFileUpload,
  generateSafeFileName,
  createSafeUploadPath,
  shouldForceDownload,
  SAFE_MIME_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  BLOCKED_MIME_TYPES
};
