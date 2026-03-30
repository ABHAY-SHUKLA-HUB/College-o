(function () {
  if (typeof window === 'undefined') return;

  // Keep existing implementation if a compatible QRCode object already exists.
  if (window.QRCode && typeof window.QRCode.toDataURL === 'function') return;

  if (typeof window.qrcode !== 'function') {
    console.error('QR code generator library is not available.');
    return;
  }

  window.QRCode = {
    toDataURL: function (text, options) {
      return new Promise(function (resolve, reject) {
        try {
          const value = String(text || '');
          const width = Number(options && options.width) || 128;
          const margin = Number(options && options.margin) || 1;
          const cellSize = Math.max(1, Math.floor(width / 33));

          const qr = window.qrcode(0, 'M');
          qr.addData(value);
          qr.make();

          // qrcode-generator outputs a data URL image directly.
          const dataUrl = qr.createDataURL(cellSize, margin);
          resolve(dataUrl);
        } catch (error) {
          reject(error);
        }
      });
    }
  };
})();
