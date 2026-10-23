// tokenGenerator.js
const crypto = require('crypto');

function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateVivoxToken({ key, issuer, expirySeconds, action, requestId, from, to }) {
  const exp = Math.floor(Date.now() / 1000) + expirySeconds;
  const claims = { iss: issuer, exp, vxa: action, vxi: requestId, f: from, t: to };
  const header = base64UrlEncode(Buffer.from('{}'));
  const payload = base64UrlEncode(Buffer.from(JSON.stringify(claims)));
  const toSign = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', key).update(toSign).digest();
  return `${header}.${payload}.${base64UrlEncode(signature)}`;
}

module.exports = { generateVivoxToken };
