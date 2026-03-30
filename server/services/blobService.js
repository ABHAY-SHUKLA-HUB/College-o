const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');

function getBlobServiceClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    return BlobServiceClient.fromConnectionString(connectionString);
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

  if (!accountName || !accountKey) {
    throw new Error('Azure storage configuration is missing');
  }

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const url = `https://${accountName}.blob.core.windows.net`;
  return new BlobServiceClient(url, credential);
}

function getContainerName() {
  const container = String(process.env.AZURE_STORAGE_CONTAINER || '').trim();
  if (!container) {
    throw new Error('AZURE_STORAGE_CONTAINER is required for Azure uploads');
  }
  return container;
}

async function uploadBufferToAzure({ buffer, fileName, folder = '', contentType = 'application/octet-stream' }) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Missing upload buffer');
  }
  if (!fileName) {
    throw new Error('Missing upload file name');
  }

  const client = getBlobServiceClient();
  const containerName = getContainerName();
  const containerClient = client.getContainerClient(containerName);
  await containerClient.createIfNotExists();

  const cleanFolder = String(folder || '')
    .replace(/\\+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.\./g, '');
  const blobName = cleanFolder ? `${cleanFolder}/${fileName}` : fileName;

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType
    }
  });

  return {
    provider: 'azure',
    key: blobName,
    url: blockBlobClient.url
  };
}

module.exports = {
  uploadBufferToAzure
};