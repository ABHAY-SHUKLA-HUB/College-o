const assert = require('assert/strict');

const poolModulePath = require.resolve('../server/db/pool');
require.cache[poolModulePath] = {
  id: poolModulePath,
  filename: poolModulePath,
  loaded: true,
  exports: { pool: { query: async () => ({ rows: [], rowCount: 0 }) } }
};

const { requireAuth, requireAdmin } = require('../server/middleware/rbac');
const { assertValidUploadBuffer, createSafeFileName } = require('../server/services/uploadService');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function invoke(middleware, session) {
  const response = responseRecorder();
  let called = false;
  middleware({ session }, response, () => { called = true; });
  return { response, called };
}

const unauthenticated = invoke(requireAuth, null);
assert.equal(unauthenticated.response.statusCode, 401);
assert.equal(unauthenticated.called, false);

const student = invoke(requireAdmin, { userId: 10, role: 'student' });
assert.equal(student.response.statusCode, 403);
assert.equal(student.called, false);

const admin = invoke(requireAdmin, { userId: 11, role: 'admin' });
assert.equal(admin.response.statusCode, 200);
assert.equal(admin.called, true);

const superAdmin = invoke(requireAdmin, { userId: 12, role: 'super_admin' });
assert.equal(superAdmin.called, true);

const validPdf = { originalname: '../notes.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') };
assert.equal(assertValidUploadBuffer(validPdf).detectedMime, 'application/pdf');
assert.match(createSafeFileName(validPdf, '../notes'), /^\d+-notes-[a-f0-9]{16}\.pdf$/);

assert.throws(
  () => assertValidUploadBuffer({ originalname: 'notes.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf') }),
  (error) => error.code === 'INVALID_UPLOAD_FILE' && error.statusCode === 400
);

console.log('Portal security boundary tests passed.');
