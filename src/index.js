const net = require('net')
const tls = require('tls')
const http = require('http')
const {
  parseHTTP,
  serializeHTTP,
  Deffer,
  isSocks4HandshakeData,
  isSocks5HandshakeData,
  socks4ResponseData,
  socks5ResponseData,
  toHex,
  oneTime,
} = require('./tool');
const { ReadBuffer } = require('./read-buffer');

/**
 * @typedef {import('./tool').HttpRequestOptions} HttpRequestOptions
 * @typedef {(info: ConnectionInfo, options?: HttpRequestOptions) => Promise<import('stream').Duplex>} CreateProxyConnection
 * @typedef {(userid: string, password: string, callback: (isAuth: boolean) => void, socket: net.Socket) => any} OnAuth
 * @typedef {{
 *  on(event: 'http-proxy', listener: (socket: net.Socket, data: Buffer, options: HttpRequestOptions) => any): ProxyServer;
 *  on(event: 'http-proxy-connection', listener: (socket: net.Socket, data: Buffer, options: HttpRequestOptions) => any): ProxyServer;
 *  on(event: 'socks4-proxy', listener: (socket: net.Socket, data: Buffer) => any): ProxyServer;
 *  on(event: 'socks5-proxy', listener: (socket: net.Socket, data: Buffer) => any): ProxyServer;
 *  on(event: 'socks5-proxy-connection', listener: (socket: net.Socket, data: Buffer) => any): ProxyServer;
 *  on(event: 'proxy-auth', listener: OnAuth): ProxyServer;
 *  on(event: 'proxy-connection', listener: (connection: import('stream').Duplex, info: ConnectionInfo)): ProxyServer;
 * } & net.Server} ProxyServer
 * @typedef {{ dstHost: string, dstPort: number; srcHost: string; srcPort: number }} ConnectionInfo
 * @typedef {{
 *  createProxyConnection?: CreateProxyConnection;
 *  auth?: boolean;
 * }} ProxyServerOptions
 */


/**
 * @param {ProxyServerOptions} [options]
 */
function createProxyServer(options) {
  const auth = { enabled: options && options.auth }
  const createProxyConnection = options && options.createProxyConnection || createTCPConnection
  /** @type {ProxyServer} */
  const server = net.createServer();
  server.on('connection', (socket) => {
    socket._server = server;
    socket.on('error', onSocketError)
    socket.once('data', onConnectionHandshake)
  })
  server.on('http-proxy', (socket, data, options) => {
    if (!auth.enabled) {
      server.emit('http-proxy-connection', socket, data, options)
      return;
    }
    const proxyAuthHead = options.headers['proxy-authorization'];
    const [type, token] = (proxyAuthHead || '').split(/\s+/g);
    if (!proxyAuthHead || !type || type.toLowerCase() !== 'basic' || !token) {
      socket.end([
        'HTTP/1.1 407 Proxy Authentication Required',
        'Proxy-Authenticate: Basic realm="Proxy Authentication Required"',
        '\r\n'
      ].join('\r\n'), 'utf-8')
      return;
    }
    const [username, password] = Buffer.from(token, 'base64').toString('utf-8').split(':');
    if (!server.listenerCount('proxy-auth')) {
      socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n', 'utf-8');
      server.emit('error', new Error('require "proxy-auth" event listener'))
      return;
    }
    socket.pause()
    server.emit('proxy-auth', username, password, oneTime((isAuth) => {
      socket.resume()
      if (isAuth) {
        server.emit('http-proxy-connection', socket, data, options)
      } else {
        socket.end('HTTP/1.1 401 Unathorized\r\n\r\n', 'utf-8')
      }
    }), socket)
  })
  server.on('http-proxy-connection', async (socket, data, options) => {
    try {
      const { remoteAddress: srcHost, remotePort: srcPort } = socket;
      const { method, url } = options;
      /** @type {import('stream').Duplex} */
      let conn;
      socket.pause()
      if (method.toLowerCase() === 'connect') {
        const [dstHost, dstPort] = url.split(':')
        conn = await createProxyConnection({ srcHost, srcPort, dstHost, dstPort: +dstPort }, options)
        server.emit('proxy-connection', conn, { dstHost, dstPort: +dstPort, srcHost, srcPort })
        socket.write('HTTP/1.1 200 OK\r\n\r\n', 'utf-8')
      } else {
        const { host: dstHost, port: dstPort } = new URL(url);
        conn = await createProxyConnection({ srcHost, srcPort, dstHost, dstPort: dstPort || 80 }, options)
        server.emit('proxy-connection', conn, { dstHost, dstPort, srcHost, srcPort })
        if (options.headers['proxy-authorization']) {
          delete options.headers['proxy-authorization']
          conn.write(serializeHTTP(options))
        } else {
          conn.write(data)
        }
      }
      socket.resume();
      conn.pipe(socket)
      socket.pipe(conn)
      socket.on('close', () => conn.destroy())
      conn.on('error', onProxyError)
    } catch (e) {
      server.emit('error', e)
      socket.resume()
      socket.end(`HTTP/1.1 500 Internal Server Error\r\n\r\n`, 'utf-8')
    }
  })
  server.on('socks4-proxy', async (socket, data) => {
    try {
      const { remoteAddress: srcHost, remotePort: srcPort } = socket;
      const buf = new ReadBuffer(data)
      buf.seek(1) // version byte
      const command = buf.readUInt8();
      const dstPort = buf.readUInt16BE()
      const ip = buf.readArrayBuffer(4).join('.');
      const userid = buf.readStringNT('ascii');
      if (!userid) {
        socket.end(socks4ResponseData(0x5D)) // NOUSERID
        return;
      }
      let dstHost = ip
      if (/^0\.0\.0\./.test(ip)) {
        dstHost = buf.readStringNT('ascii');
      }
      if (!dstHost) {
        socket.end(socks4ResponseData(0x5B)) // REJECTED
        return;
      }
      /** @type {import('stream').Duplex} */
      let conn;
      socket.pause()
      if (command === 0x01) {
        conn = await createProxyConnection({ dstHost, dstPort, srcHost, srcPort })
        server.emit('proxy-connection', conn, { dstHost, dstPort, srcHost, srcPort })
      } else {
        socket.resume()
        socket.end(socks4ResponseData(0x5B)) // REJECTED
        return;
      }
      socket.resume()
      socket.write(socks4ResponseData(0x5A)) // SUCCESS
      conn.pipe(socket).pipe(conn)
      socket.on('close', () => conn.destroy())
      conn.on('error', onProxyError)
    } catch (e) {
      server.emit('error', e)
      socket.resume()
      socket.end(socks4ResponseData(0x5C))
    }
  })
  server.on('socks5-proxy', (socket, data) => {
    const buf = new ReadBuffer(data)
    buf.seek(1) // version byte
    const size = buf.readUInt8()
    const authTypes = buf.readArrayBuffer(size)
    if (auth.enabled) {
      if (authTypes.includes(0x02)) {
        socket.write(socks5ResponseData(0x02)) // PWD AUTH
        socket.once('data', onSocks5PasswordAuth)
        return;
      }
      if (authTypes.includes(0x00)) {
        socket.pause()
        server.emit('proxy-auth', '', '', oneTime((isAuth) => {
          socket.resume()
          if (isAuth) {
            socket.write(socks5ResponseData(0x00)) // NO AUTH
            socket.once('data', onSocks5Connection)
          } else {
            socket.end(socks5ResponseData(0x01))
          }
        }), socket)
        return;
      }
    } else if (authTypes.includes(0x00)) {
      socket.resume()
      socket.write(socks5ResponseData(0x00)) // NO AUTH
      socket.once('data', onSocks5Connection)
      return;
    }
    socket.end(socks5ResponseData(0xFF)) // NOT SUPPORTED AUTHENTICATION
  })
  server.on('socks5-proxy-connection', async (socket, data) => {
    const { remoteAddress: srcHost, remotePort: srcPort } = socket;
    const buf = new ReadBuffer(data)
    buf.seek(1) // version byte
    const command = buf.readUInt8();
    buf.seek(1)
    const addressType = buf.readUInt8();
    let dstPort, dstHost, address, domSize;
    switch (addressType) {
      case 0x01:
        address = buf.readArrayBuffer(buf.length, buf.position);
        dstHost = buf.readArrayBuffer(4).join('.'); // IPv4
        dstPort = buf.readUInt16BE()
        break;
      case 0x03:
        address = buf.readArrayBuffer(buf.length, buf.position);
        domSize = buf.readUInt8()
        dstHost = buf.readArrayBuffer(domSize).toString('ascii'); // Name
        dstPort = buf.readUInt16BE()
        break;
      case 0x04:
        address = buf.readArrayBuffer(buf.length, buf.position)
        dstHost = buf.readArrayBuffer(16).map(toHex).join(':') // IPv6
        dstPort = buf.readUInt16BE()
        break;
      default:
        socket.end(socks5ResponseData(0x08, 0)) // ADDRESS TYPE UNSUPPORTED
        return;
    }
    try {
      /** @type {net.Socket} */
      let conn;
      if (command === 0x01) { // CONNECT
        socket.pause()
        conn = await createProxyConnection({ dstHost, dstPort, srcHost, srcPort })
        server.emit('proxy-connection', conn, { dstHost, dstPort, srcHost, srcPort })
        socket.resume()
        socket.write(socks5ResponseData(0x00, 0, addressType, ...address)) // SUCCESS
      } else {
        socket.end(socks5ResponseData(0x07, 0)) // COMMAND UNSUPPORTED
        return;
      }
      conn.on('error', onProxyError)
      conn.pipe(socket)
      socket.pipe(conn)
      socket.on('close', () => conn.destroy())
    } catch (e) {
      server.emit('error', e)
      socket.end(socks5ResponseData(0x01, 0)) // FAILED
    }
  })
  return server;
}

/**
 * @this {net.Socket}
 * @param {Buffer} data 
 */
function onConnectionHandshake(data) {
  const socket = this;
  /** @type {ProxyServer} */
  const server = socket._server;
  if (isSocks4HandshakeData(data)) {
    server.emit('socks4-proxy', socket, data)
    return;
  }
  if (isSocks5HandshakeData(data)) {
    server.emit('socks5-proxy', socket, data)
    return;
  }
  const options = parseHTTP(data)
  if (http.METHODS.includes(options.method)) {
    server.emit('http-proxy', socket, data, options)
    return;
  }
  socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n', 'utf-8')
}

/** @type {CreateProxyConnection} */
function createTCPConnection(info, options) {
  const socket = net.createConnection({ host: info.dstHost, port: info.dstPort })
  const conn = options && options.url.indexOf('https:') === 0 ? new tls.TLSSocket(socket, { rejectUnauthorized: false }) : socket;
  /** @type {Deffer<net.Socket>} */
  const deffer = new Deffer()
  conn.on('connect', () => deffer.resolve(conn))
  conn.on('error', (err) => deffer.reject(err))
  return deffer.promise;
}

/**
 * @this {net.Socket}
 * @param {Buffer} data
 */
function onSocks5PasswordAuth(data) {
  const socket = this;
  const buf = new ReadBuffer(data)
  buf.seek(1) // version byte
  const useridSize = buf.readUInt8()
  const userid = buf.readArrayBuffer(useridSize).toString('ascii')
  const passwordSize = buf.readUInt8()
  const password = buf.readArrayBuffer(passwordSize).toString('ascii');
  /** @type {ProxyServer} */
  const server = socket._server;
  socket.pause()
  server.emit('proxy-auth', userid, password, oneTime((isAuth) => {
    socket.resume()
    if (isAuth) {
      socket.write(socks5ResponseData(0x00)) // SUCCESS
      socket.once('data', onSocks5Connection)
    } else {
      socket.end(socks5ResponseData(0x01)) // FAILED
    }
  }), socket)
}

/**
 * @this {net.Socket}
 * @param {Buffer} data
 */
function onSocks5Connection(data) {
  /** @type {ProxyServer} */
  const server = this._server;
  server.emit('socks5-proxy-connection', this, data)
}

/**
 * @this {net.Socket}
 * @param {Error} error
 */
function onSocketError(error) { }

/**
 * @this {import('stream').Duplex}
 * @param {Error} error
 */
function onProxyError(error) { }

module.exports = { createProxyServer }
