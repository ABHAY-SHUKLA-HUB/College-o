const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const targetFile = path.join(projectRoot, 'assets', 'js', 'runtime-config.js');

function trim(value) {
  return String(value || '').trim();
}

function isLocalhostHost(hostname = '') {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1';
}

function normalizeUrl(value) {
  const raw = trim(value);
  if (!raw) return '';
  try {
    const normalized = new URL(raw).toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  }
}

const environmentMode = String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'production' : 'development';
const host = trim(process.env.HOSTNAME || process.env.HOST || '');
const localFallbackApi = 'http://localhost:3000';
const prodFallbackApi = 'https://college-o.onrender.com';

let apiUrl = normalizeUrl(process.env.VITE_API_URL || process.env.API_URL || process.env.API_BASE_URL || process.env.PUBLIC_API_URL);
let socketUrl = normalizeUrl(process.env.VITE_SOCKET_URL || process.env.API_SOCKET_URL || process.env.PUBLIC_SOCKET_URL);
let uploadUrl = normalizeUrl(process.env.VITE_UPLOAD_URL || process.env.API_UPLOAD_URL || process.env.PUBLIC_UPLOAD_URL);

if (!apiUrl && isLocalhostHost(host)) {
  apiUrl = localFallbackApi;
}

if (!apiUrl && !isLocalhostHost(host)) {
  apiUrl = prodFallbackApi;
}

if (!socketUrl) {
  socketUrl = apiUrl;
}

if (!uploadUrl) {
  uploadUrl = apiUrl;
}

const runtimeConfig = `;(function (global) {
  var environmentMode = ${JSON.stringify(environmentMode)};
  var apiUrl = ${JSON.stringify(apiUrl)};
  var socketUrl = ${JSON.stringify(socketUrl)};
  var uploadUrl = ${JSON.stringify(uploadUrl)};
  var isLocalhost = function (hostname) {
    var value = String(hostname || '').toLowerCase();
    return value === 'localhost' || value === '127.0.0.1';
  };
  var normalizeUrl = function (value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    try {
      var normalized = new URL(raw, global.location && global.location.href ? global.location.href : undefined).toString();
      return normalized.charAt(normalized.length - 1) === '/' ? normalized.slice(0, -1) : normalized;
    } catch {
      return raw.charAt(raw.length - 1) === '/' ? raw.slice(0, -1) : raw;
    }
  };
  if (!apiUrl && global.location && (isLocalhost(global.location.hostname) || global.location.protocol === 'file:')) {
    apiUrl = 'http://localhost:3000';
  }
  if (!apiUrl && global.location && !isLocalhost(global.location.hostname) && global.location.protocol !== 'file:') {
    apiUrl = 'https://college-o.onrender.com';
  }
  if (!socketUrl) socketUrl = apiUrl;
  if (!uploadUrl) uploadUrl = apiUrl;
  global.__COLLEGE_OS_RUNTIME_CONFIG__ = {
    apiUrl: normalizeUrl(apiUrl),
    socketUrl: normalizeUrl(socketUrl),
    uploadUrl: normalizeUrl(uploadUrl),
    environmentMode: environmentMode
  };
  global.VITE_API_URL = global.__COLLEGE_OS_RUNTIME_CONFIG__.apiUrl;
  global.API_URL = global.__COLLEGE_OS_RUNTIME_CONFIG__.apiUrl;
  global.API_BASE_URL = global.__COLLEGE_OS_RUNTIME_CONFIG__.apiUrl;
  global.VITE_SOCKET_URL = global.__COLLEGE_OS_RUNTIME_CONFIG__.socketUrl;
  global.VITE_UPLOAD_URL = global.__COLLEGE_OS_RUNTIME_CONFIG__.uploadUrl;
  global.API_SOCKET_URL = global.__COLLEGE_OS_RUNTIME_CONFIG__.socketUrl;
  global.API_UPLOAD_URL = global.__COLLEGE_OS_RUNTIME_CONFIG__.uploadUrl;
  global.CollegeOSApiConfig = global.CollegeOSApiConfig || {
    apiUrl: global.__COLLEGE_OS_RUNTIME_CONFIG__.apiUrl,
    socketUrl: global.__COLLEGE_OS_RUNTIME_CONFIG__.socketUrl,
    uploadUrl: global.__COLLEGE_OS_RUNTIME_CONFIG__.uploadUrl,
    currentOrigin: global.location && global.location.origin ? global.location.origin : '',
    environmentMode: environmentMode
  };
})(window);`;

fs.writeFileSync(targetFile, `${runtimeConfig}\n`, 'utf8');
console.log(`[build] wrote ${path.relative(projectRoot, targetFile)}`);