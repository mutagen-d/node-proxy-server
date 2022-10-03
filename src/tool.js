/**
 * @typedef {{
 *  method: string;
 *  url: string;
 *  version: string;
 *  headers: Record<string, string>;
 *  body: Buffer;
 * }} HttpRequestOptions
 */

const LF = 0x0A
const CR = 0x0D
/**
 * @param {Buffer} data 
 */
function parseHTTP(data) {
  let rawHeaders = ''
  /** @type {Buffer} */
  let body
  for (let i = 0; i < data.length; ++i) {
    if (data[i] === LF && data[i + 1] === LF) {
      rawHeaders = data.subarray(0, i).toString('utf-8')
      body = data.subarray(i + 2)
    }
    if (data[i] === CR && data[i + 1] === LF && data[i + 2] === CR && data[i + 3] === LF) {
      rawHeaders = data.subarray(0, i).toString('utf-8')
      body = data.subarray(i + 4)
    }
  }
  const lines = rawHeaders.split(/\r?\n/g).filter(Boolean);
  /** @type {Record<string, string>} */
  const headers = lines.slice(1).reduce((acc, line) => {
    const index = line.indexOf(':')
    const key = line.slice(0, index)
    const value = line.slice(index + 1)
    acc[key.toLowerCase()] = value.trim();
    return acc;
  }, {})
  const [method, url, version] = lines[0].split(/\s/g);
  return {
    method,
    url,
    version,
    headers,
    body,
  }
}

/** @param {HttpRequestOptions} request */
function serializeHTTP(request) {
  const { method, url, version, headers, body } = request;
  const rawHeaders = [
    `${method} ${url} ${version}`,
    ...Object.keys(headers).map(key => `${key}: ${headers[key]}`),
    '\r\n'
  ].join('\r\n');
  const bufferHead = Buffer.from(rawHeaders, 'utf-8')
  return body ? Buffer.concat([bufferHead, body]) : bufferHead
}

/** @template T */
function Deffer() {
  /** @type {Promise<T>} */
  this.promise = new Promise((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  })
}

/** @param {Buffer} data */
const isSocks4HandshakeData = (data) => {
  return data[0] === 0x04 && (data[1] === 0x01 || data[1] === 0x02 || data[1] === 0x03)
}

/** @param {Buffer} data */
const isSocks5HandshakeData = (data) => {
  const size = data[1]
  const auth = data.subarray(2, 2 + size)
  return data[0] === 0x05 && (auth.includes(0x00) || auth.includes(0x02))
}

/** @param {number} code */
const socks4ResponseData = (code) => {
  return Buffer.from([0, code, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01]);
}

/** @param {number[]} code */
const socks5ResponseData = (...code) => {
  return Buffer.from([0x05, ...code])
}

const toHex = (v) => {
  if (typeof v === 'number') {
    return v.toString(16)
  }
  return v;
}

/**
 * @template T
 * @param {Extract<T, (...args: any[]) => any>} callback 
 */
const oneTime = (callback) => {
  let count = 0;
  /** @type {T} */
  const fn = (...args) => {
    if (count++) return;
    return callback(...args)
  }
  return fn;
}

module.exports = {
  Deffer,
  parseHTTP,
  serializeHTTP,
  isSocks4HandshakeData,
  isSocks5HandshakeData,
  socks4ResponseData,
  socks5ResponseData,
  toHex,
  oneTime,
}
