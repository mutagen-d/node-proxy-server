const net = require('net')

const time = () => new Date().toISOString()

/**
 * @template T
 * @typedef {0 extends (1 & T) ? true : false} IfAny
 * @see https://stackoverflow.com/questions/55541275/typescript-check-for-the-any-type
 */

/**
 * @param {net.Socket} socket
 */
const info = (socket) => {
  const { remoteAddress: address, remotePort: port, remoteFamily: family } = socket;
  if (!address && socket._name) {
    return socket._name;
  }
  return `${address}:${port}:${family}`
}

module.exports = {
  time,
  info,
  _status407,
  _parseRequest,
  _getRawHeaders,
  _setKeepAlive,
  _onError,
  _onClose,
  _onTimeout,
  _readChars,
  _setTimeout,
  toHex,
}

/**
 * @typedef {{
 *  method: string;
 *  url: string;
 *  headers: Record<string, string>;
 *  body: Buffer;
 *  _rawHeaders: string;
 *  _rawData: Buffer;
 * }} IRequest
 */

/**
 */

/**
 * @param {'Basic' | 'Bearer'} [type]
 * @param {string} [realm]
 */
function _status407(type, realm) {
  return ''
    + 'HTTP/1.1 407 Proxy Authentication Required'
    + '\r\n'
    + `Proxy-Authenticate: ${type || 'Basic'} realm="${realm || 'Proxy authentication required'}"`
    + '\r\n\r\n';
}

/**
 * @param {Buffer} data 
 * @return {IRequest}
 */
function _parseRequest(data) {
  let _rawHeaders = ''
  /** @type {Buffer} */
  let body
  for (let i = 0; i < data.length && i < 10000; ++i) {
    if (data[i] === 0x0A && data[i + 1] === 0x0A) {
      _rawHeaders = data.subarray(0, i).toString('utf-8')
      body = data.subarray(i + 2)
    }
    if (data[i] === 0x0D && data[i + 1] === 0x0A && data[i + 2] === 0x0D && data[i + 3] === 0x0A) {
      _rawHeaders = data.subarray(0, i).toString('utf-8')
      body = data.subarray(i + 4)
    }
  }
  if (!_rawHeaders) {
    return { _rawHeaders, body, _rawData: data }
  }
  const [methodLine, ...restLines] = _rawHeaders.split('\n')
  const [method, url] = methodLine.trim().split(' ', 2)
  /** @type {Record<string, string>} */
  const headers = {}
  for (let i = 0, line, index; i < restLines.length; ++i) {
    line = restLines[i].trim()
    index = line.indexOf(':')
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return {
    method,
    url,
    headers,
    body,
    _rawHeaders,
    _rawData: data,
  }
}

/**
 * @param {http.IncomingMessage} message 
 * @param {string} [version] default `1.1`
 */
function _getRawHeaders(message, version = '1.1') {
  const { statusCode, statusMessage, headers, method, url } = message;
  let rawHeaders = ''
  if (method && url) {
    rawHeaders += `${method} ${url} HTTP/${version}\r\n`
  } else if (statusCode) {
    rawHeaders += `HTTP/${version} ${statusCode} ${statusMessage || ''}\r\n`
  }
  for (let key in headers) {
    rawHeaders += `${key}: ${headers[key]}\r\n`
  }
  return rawHeaders + '\r\n';
}

/**
 * @param {net.Socket} socket 
 * @param {number} [msec] default `5000` ms
 */
function _setKeepAlive(socket, msec = 5000) {
  socket.setKeepAlive(true, msec)
  _setTimeout(socket, msec)
}

/**
 * Destory `socket` after `msec` of inactivity
 * @param {net.Socket} socket 
 * @param {number} [msec] default `5000` ms
 */
function _setTimeout(socket, msec = 5000) {
  socket.setTimeout(msec)
  if (!socket.listeners('timeout').includes(_streamDestroy)) {
    socket.once('timeout', _streamDestroy)
  }
}

/**
 * @this {net.Socket}
 * @param {Error} error
 */
function _onError(error) {
  this.destroy(error)
}

/**
 * @this {net.Socket}
 */
function _onClose() {
}

function _onTimeout() {
  this.destroy()
}

/**
 * @this {import('stream').Duplex}
 * @param {Error} [error]
 */
function _streamDestroy(error) {
  this.destroy(error)
}

/**
 * @param {Buffer} chars
 */
function _readChars(chars, start = 0) {
  const maxcount = 1000;
  for (let i = start; i < maxcount && i < chars.length; ++i) {
    if (chars[i] === 0x00) {
      return chars.subarray(start, i);
    }
  }
}

/**
 * 
 * @param {number} v 
 */
function toHex(v) {
  switch (typeof v) {
    case 'number':
      return v.toString(16)
    case 'string':
    default:
      return v;
  }
}
