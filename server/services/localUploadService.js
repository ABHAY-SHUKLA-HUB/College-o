const fs = require('fs');
const path = require('path');

const uploadsRoot = path.join(__dirname, '..', '..', 'uploads');

function normalizeFolder(folder = '') {
  return String(folder || '')
    .replace(/\\+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.\./g, '');
}

async function saveBufferToLocal({ buffer, fileName, folder = '' }) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Missing upload buffer');
  }
  if (!fileName) {
    throw new Error('Missing upload file name');
  }

  const cleanFolder = normalizeFolder(folder);
  const targetDir = cleanFolder ? path.join(uploadsRoot, cleanFolder) : uploadsRoot;
  await fs.promises.mkdir(targetDir, { recursive: true });

  const filePath = path.join(targetDir, fileName);
  await fs.promises.writeFile(filePath, buffer);

  const relativeUrl = cleanFolder
    ? `/uploads/${cleanFolder}/${fileName}`
    : `/uploads/${fileName}`;

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const configuredBaseUrl = String(
    process.env.PUBLIC_UPLOAD_URL ||
    process.env.API_UPLOAD_URL ||
    process.env.VITE_UPLOAD_URL ||
    process.env.API_URL ||
    (isProduction ? 'https://college-o.onrender.com' : '')
  ).trim().replace(/\/+$/, '');

  const finalUrl = configuredBaseUrl && !relativeUrl.startsWith('http')
    ? `${configuredBaseUrl}${relativeUrl}`
    : relativeUrl;

  return {
    provider: 'local',
    path: filePath,
    key: cleanFolder ? `${cleanFolder}/${fileName}` : fileName,
    url: finalUrl
  };
}

module.exports = {
  saveBufferToLocal
};