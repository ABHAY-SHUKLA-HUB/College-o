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

  return {
    provider: 'local',
    path: filePath,
    key: cleanFolder ? `${cleanFolder}/${fileName}` : fileName,
    url: relativeUrl
  };
}

module.exports = {
  saveBufferToLocal
};