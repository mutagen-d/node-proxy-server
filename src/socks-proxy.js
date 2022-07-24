const net = require('net')
const http = require('http')
const {
  _setKeepAlive,
  _readChars,
  _onError,
  _onClose,
  toHex,
  _setTimeout,
} = require('./tools')

const CMD = {
  CONNECT: 0x01,
  BIND: 0x02,
  UDP: 0x03,
  [0x01]: 'CONNECT',
  [0x02]: 'BIND',
  [0x03]: 'UDP',
}

const REPv4 = {
  SUCCESS: 0x5A,
  REJECTED: 0x5B,
  UNREACHABLE: 0x5C,
  NOUSERID: 0x5D,
}

const REPv5 = {
  SUCCESS: 0x00,
  FAILED: 0x01,
  NOTALLOWED: 0x02,
  NETUNREACH: 0x03,
  HOSTUNREACH: 0x04,
  CONREFUSED: 0x05,
  TTLEXPIRED: 0x06,
  CMDUNSUPP: 0x07,
  ATYPUNSUPP: 0x08,
}

const ATYP = {
  IPv4: 0x01,
  Name: 0x03,
  IPv6: 0x04,
}

module.exports = { createSocksProxy }

/**
 * @template T
 * @typedef {import('./tools').IfAny<T>} IfAny
 */

/**
 * @typedef {(username: string, password: string, callback: (authorized: boolean) => void) => void} OnAuth
 * @typedef {{ onAuth?: OnAuth, keepAlive?: boolean; keepAliveMsecs?: number; }} SocksProxyOptions
 * @typedef {(opts: { version: 4 | 5; }, callback: (opts: SocksProxyOptions) => void) => void} RewriteOptions
 * @typedef {SocksProxyOptions & { rewriteOptions?: RewriteOptions }} SocksProxyServerOptions
 */

/**
 * @typedef {net.Server & { _socks: SocksProxyOptions; _socksRewriteOptions?: RewriteOptions }} SocksProxyServer
 * @typedef {net.Socket & { _socks: SocksProxyOptions }} SocksProxySocket
 */
/**
 * @template T
 * @param {IfAny<T> extends true ? SocksProxyServerOptions : Extract<T, net.Server | SocksProxyServerOptions>} [server]
 * @param {IfAny<T> extends true ? never : SocksProxyServerOptions} [opts]
 * @return {SocksProxyServer}
 */
function createSocksProxy(server, opts) {
  if (server instanceof http.Server) {
    throw new Error('http.Server not allowed, use net.Server instead')
  }
  const proxy = server instanceof net.Server ? server : net.createServer()
  const _socks = server instanceof net.Server ? opts : server;
  proxy._socks = Object.assign({ keepAlive: true, keepAliveMsecs: 1000 }, _socks)
  proxy._socksRewriteOptions = _socks ? _socks.rewriteOptions : undefined;
  proxy.on('connection', _onConnection)
  return proxy;
}

/**
 * @this {SocksProxyServer}
 * @param {SocksProxySocket} socket
 */
function _onConnection(socket) {
  const _socks = this._socks;
  socket._socks = Object.assign({}, _socks);
  socket._socksRewriteOptions = this._socksRewriteOptions

  socket.once('data', _onceData)

  _setTimeout(socket, _socks.keepAliveMsecs)
  socket.on('socks4', _onSocks4)
  socket.on('socks5', _onSocks5)
}

/**
 * @this {SocksProxySocket}
 * @param {Buffer} data
 */
function _onceData(data) {
  const version = data[0]
  switch (version) {
    case 0x04:
      this.emit('socks4', data)
      break;
    case 0x05:
      this.emit('socks5', data)
      break;
    default:
      return;
  }
}

/**
 * @this {SocksProxySocket}
 * @param {Buffer} data
 */
function _onSocks4(data) {
  const socket = this;
  socket.on('error', _onError)
  socket.on('close', _onClose)
  const command = data[1]
  const port = data.readUint16BE(2)
  const ip = data.subarray(4, 8)
  const userid = _readChars(data, 8)
  if (!userid) {
    socket.end(_socks4Rep(REPv4.NOUSERID))
    return;
  }
  const address = ip.join('.')
  let host = address;
  if (ip[0] === 0x00 && ip[1] === 0x00 && ip[2] === 0x00 && ip[3] !== 0x00) {
    const domain = _readChars(data, 8 + userid.length + 1)
    if (!domain) {
      socket.end(_socks4Rep(REPv4.REJECTED))
      return;
    }
    host = domain.toString('ascii')
  }
  /** @type {RewriteOptions} */
  const rewriteOptions = socket._socksRewriteOptions;
  if (rewriteOptions) {
    rewriteOptions({ version: 4 }, (opts) => {
      Object.assign(socket._socks, opts)
    })
  }
  const { keepAlive, keepAliveMsecs } = socket._socks;
  if (keepAlive) {
    _setKeepAlive(socket, keepAliveMsecs)
  }
  /** @type {net.Socket} */
  let proxy
  switch (command) {
    case CMD.CONNECT:
      proxy = net.createConnection({ host, port })
      proxy._name = `${host}:${port}`
      socket.write(_socks4Rep(REPv4.SUCCESS))
      break;
    case CMD.BIND:
      proxy = net.createConnection({ port })
      proxy._name = `:${port}`
      socket.write(_socks4Rep(REPv4.SUCCESS))
      break;
    default:
      socket.end(_socks4Rep(REPv4.REJECTED))
      return;
  }
  if (keepAlive) {
    _setKeepAlive(proxy, keepAliveMsecs)
  } else {
    _setTimeout(proxy, keepAliveMsecs)
  }
  proxy.on('error', _onError)
  proxy.on('close', _onClose)

  socket.pause()
  proxy.on('connect', () => {
    socket.resume()
    proxy.pipe(socket)
    socket.pipe(proxy)
  })
}

/**
 * @this {SocksProxySocket}
 * @param {Buffer} data
 */
function _onSocks5(data) {
  const socket = this;
  socket.on('error', _onError)
  socket.on('close', _onClose)
  /** @type {RewriteOptions} */
  const rewriteOptions = socket._socksRewriteOptions;
  if (rewriteOptions) {
    rewriteOptions({ version: 5 }, (opts) => {
      Object.assign(socket._socks, opts)
    })
  }
  const { onAuth, keepAlive, keepAliveMsecs } = socket._socks;
  if (keepAlive) {
    _setKeepAlive(socket, keepAliveMsecs)
  }
  const nauth = data[1]
  const auth = data.subarray(2, 2 + nauth)
  if (auth.includes(0x02) && onAuth) {
    socket.write(Buffer.from([0x05, 0x02]))
    socket.once('data', _onPwAuth)
    return;
  }
  if (auth.includes(0x00) && !onAuth) {
    socket.write(Buffer.from([0x05, 0x00]))
    socket.once('data', _onSocks5Connection)
    return;
  }
  socket.end(Buffer.from([0x05, 0xFF]))
}

/**
 * @this {SocksProxySocket}
 * @param {Buffer} data
 */
function _onPwAuth(data) {
  const socket = this;
  const { onAuth } = this._socks;
  const version = data[0]
  const idlen = data[1]
  const id = data.subarray(2, 2 + idlen).toString('ascii')
  const pwlen = data[2 + idlen]
  const pw = data.subarray(3 + idlen, 3 + idlen + pwlen).toString('ascii')

  onAuth(id, pw, (auth) => {
    if (auth) {
      socket.write(Buffer.from([version, 0x00]))
      socket.once('data', _onSocks5Connection)
    } else {
      socket.end(Buffer.from([version, 0x01]))
    }
  })
}

/**
 * @this {SocksProxySocket}
 * @param {Buffer} data
 */
function _onSocks5Connection(data) {
  const socket = this;

  const version = data[0]
  const command = data[1]

  const addrtype = data[3]
  let ipv4, domain, ipv6;
  let port, portBuf;
  let host;
  let addr;
  switch (addrtype) {
    case ATYP.IPv4:
      addr = data.subarray(3, 8)
      ipv4 = data.subarray(4, 8)
      port = data.readUint16BE(8)
      portBuf = data.subarray(8, 10)
      host = ipv4.join('.')
      break;
    case ATYP.Name:
      addr = data.subarray(3, 5 + data[4])
      domain = data.subarray(5, 5 + data[4]).toString('ascii')
      port = data.readUint16BE(5 + data[4])
      portBuf = data.subarray(5 + data[4], 7 + data[4])
      host = domain
      break;
    case ATYP.IPv6:
      addr = data.subarray(3, 20)
      ipv6 = data.subarray(4, 20)
      port = data.readUint16BE(20)
      portBuf = data.subarray(20, 22)
      host = ipv6.map(toHex).join(':')
      break;
    default:
      socket.end(Buffer.from([0x05, REPv5.ATYPUNSUPP, 0]))
      return;
  }
  /** @type {net.Socket} */
  let proxy;
  switch (command) {
    case CMD.CONNECT:
    case CMD.BIND:
      proxy = net.createConnection({ host, port })
      proxy._name = `${host}:${port}`
      // TODO
      socket.write(Buffer.from([0x05, REPv5.SUCCESS, 0, ...addr, ...portBuf]))
      break;
    case CMD.UDP:
      // TODO
      socket.end(Buffer.from([0x05, REPv5.CMDUNSUPP, 0]))
      return;
    default:
      socket.end(Buffer.from([0x05, REPv5.CMDUNSUPP, 0]))
      return;
  }
  const { keepAlive, keepAliveMsecs } = this._socks;
  if (keepAlive) {
    _setKeepAlive(proxy, keepAliveMsecs)
  }
  socket.pause()
  proxy.on('error', _onError)
  proxy.on('close', _onClose)
  proxy.on('connect', () => {
    socket.resume()
    proxy.pipe(socket)
    socket.pipe(proxy)
  })
}

function _socks4Rep(message) {
  return Buffer.from([0, message, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01])
}
