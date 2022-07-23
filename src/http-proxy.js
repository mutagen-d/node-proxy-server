const crypto = require('crypto')
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const {
  _parseRequest,
  _getRawHeaders,
  _setKeepAlive,
  _onError,
  _onClose,
  _status407,
  _setTimeout,
} = require('./tools')

module.exports = { createHttpProxy }

/**
 * @template T
 * @typedef {import('./tools').IfAny<T>} IfAny
 */

/**
 * @typedef {{
 *  type: 'Basic' | 'Bearer';
 *  token?: string;
 *  username?: string;
 *  password?: string;
 * }} AuthParams
 */

/**
 * @typedef {import('./tools').IRequest} IRequest
 */

/**
 * @typedef {(auth: AuthParams, callback: (authorized: boolean) => void) => void} OnAuth
 * @typedef {(req: Pick<IRequest, 'method' | 'url' | 'headers'>, callback: (opts?: SSLProxyOptions & HttpProxyOptions) => void) => void} RewriteOptions
 * @typedef {{
 *  onAuth?: OnAuth;
 *  keepAlive?: boolean;
 *  keepAliveMsecs?: number;
 *  authType?: 'Basic' | 'Bearer';
 *  authRealm?: string;
 *  useHttpRequest?: boolean;
 * }} HttpProxyOptions
 * @typedef {{
 *  rejectUnauthorized?: boolean;
 *  ca?: string;
 *  cert?: string;
 *  key?: string;
 * }} SSLProxyOptions
 * @typedef {HttpProxyOptions & { rewriteOptions?: RewriteOptions }} HttpProxyServerOptions
 */

/**
 * @typedef {net.Server & { _http: HttpProxyOptions; _rewriteOptions?: RewriteOptions }} HttpProxyServer
 * @typedef {net.Socket & { _http: HttpProxyOptions & SSLProxyOptions }} HttpProxySocket
 */

/**
 * @template T
 * @param {IfAny<T> extends true ? HttpProxyServerOptions : Extract<T, net.Server | HttpProxyServerOptions>} [server]
 * @param {IfAny<T> extends true ? never : HttpProxyServerOptions} [opts]
 * @return {HttpProxyServer}
 */
function createHttpProxy(server, opts) {
  if (server instanceof http.Server) {
    throw new Error('WARNING! http.Server not allowed, use net.Server instead')
  }
  /** @type {HttpProxyServer} */
  const proxy = server instanceof net.Server ? server : net.createServer();
  /** @type {HttpProxyServerOptions} */
  const _opts = server instanceof net.Server ? opts : server;
  proxy._http = Object.assign({ keepAlive: true, keepAliveMsecs: 1000 }, _opts)
  proxy._rewriteOptions = _opts ? _opts.rewriteOptions : undefined
  proxy.on('connection', _onConnection)
  return proxy;
}

/**
 * @this {HttpProxyServer}
 * @param {HttpProxySocket} socket 
 */
function _onConnection(socket) {
  const server = this;
  _setTimeout(socket, server._http.keepAliveMsecs)

  socket._http = Object.assign({}, server._http);
  socket._rewriteOptions = server._rewriteOptions;

  socket.once('data', _onceData)

  socket.on('proxy-headers', _onProxyHeaders)
  socket.on('proxy-authorization', _onProxyAuthorization)
  socket.on('proxy-request', _onProxyRequest)
}

/**
 * @this {net.Socket}
 * @param {Buffer} data 
 */
function _onceData(data) {
  const socket = this;
  const string = data.toString('utf-8')
  const line = string.split('\n', 1)[0].trim()
  const [method] = line.split(' ', 1)
  if (http.METHODS.includes(method)) {
    socket.emit('proxy-headers', _parseRequest(data))
  }
}

/**
 * @this {HttpProxySocket}
 * @param {import('./tools').IRequest} req
 */
function _onProxyHeaders(req) {
  const socket = this;
  /** @type {RewriteOptions} */
  const rewriteOptions = socket._rewriteOptions
  if (rewriteOptions) {
    rewriteOptions(req, (opts) => {
      Object.assign(socket._http, opts)
    })
  }
  socket.on('error', _onError)
  socket.on('close', _onClose)
  const { keepAlive, keepAliveMsecs } = socket._http;
  if (keepAlive && req.headers['connection'] && req.headers['connection'].toLowerCase() === 'keep-alive') {
    _setKeepAlive(socket, keepAliveMsecs)
  }
  socket.emit('proxy-authorization', req)
}
/**
 * @this {HttpProxySocket}
 * @param {import('./tools').IRequest} req
 */
function _onProxyAuthorization(req) {
  const socket = this;
  const { authType, authRealm } = socket._http;
  if (!authType) {
    socket.emit('proxy-request', req)
    return;
  }
  if (authType && !req.headers['proxy-authorization']) {
    socket.end(_status407(authType, authRealm))
    return;
  }
  const [type, token = ''] = req.headers['proxy-authorization'].split(/\s+/g)
  if (type !== authType || !token) {
    socket.end(_status407(authType, authRealm))
    return;
  }
  const authCallback = (authorized) => {
    if (authorized) {
      socket.emit('proxy-request', req)
    } else {
      socket.end(_status407(authType, authRealm))
    }
  }
  const { onAuth = _unAuth } = socket._http;
  let username, password;
  switch (type) {
    case 'Basic':
      ([username, password] = Buffer.from(token, 'base64').toString('utf-8').split(':'))
      onAuth({ type, username, password }, authCallback)
      break;
    case 'Bearer':
      onAuth({ type, token }, authCallback)
      break;
  }
}


/**
 * @this {HttpProxySocket}
 * @param {import('./tools').IRequest} req
 */
function _onProxyRequest(req) {
  const socket = this;
  const { keepAlive, keepAliveMsecs } = socket._http;
  if (req.method === 'CONNECT') {
    const [host, port] = req.url.split(':');
    const proxy = net.createConnection({ host, port })
    if (keepAlive && req.headers['proxy-connection'] && req.headers['proxy-connection'].toLowerCase() === 'keep-alive') {
      _setKeepAlive(proxy, keepAliveMsecs)
    } else {
      _setTimeout(proxy, keepAliveMsecs)
    }
    socket.pause();
    proxy._name = `${host}:${port}`
    proxy.on('error', _onError)
    proxy.on('close', _onClose)
    proxy.on('connect', () => {
      socket.write('HTTP/1.1 200 OK\r\n\r\n', 'utf-8')
      socket.resume();
      socket.pipe(proxy, { end: false })
      proxy.pipe(socket, { end: false })
    })
  } else {
    if (req.url.indexOf('http://') !== 0 && req.url.indexOf('https://') !== 0) {
      socket.end(_getRawHeaders({ statusCode: 400 }), 'utf-8')
      return;
    }
    const url = new URL(req.url)
    const defaultPort = url.protocol === 'http:' ? 80 : 443;
    const { useHttpRequest } = socket._http;
    if (useHttpRequest) {
      const headers = Object.assign({}, req.headers)
      delete headers['proxy-authorization']
      socket.resume()
      const httpx = url.protocol === 'https:' ? https : http;
      const { httpAgent, httpsAgent } = _getAgent(socket._http)
      const xReq = httpx.request({
        agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
        method: req.method,
        headers,
        hostname: url.hostname,
        protocol: url.protocol,
        port: url.port,
        path: url.pathname + url.search + url.hash,
      }, (xRes) => {
        socket.write(_getRawHeaders(xRes), 'utf-8')
        if (xRes.headers['transfer-encoding'] === 'chunked') {
          xRes.on('data', (chunk) => {
            socket.write(chunk.length.toString(16) + '\r\n' + chunk + '\r\n')
          })
          xRes.on('end', () => socket.end('0\r\n\r\n'))
        } else {
          xRes.pipe(socket)
        }
      })
      xReq.end(req.body.toString('utf-8'))
      socket.pipe(xReq)
      const _name = `${url.hostname}:${url.port || defaultPort}`
      xReq._name = _name;
      xReq.on('error', _onError)
    } else {
      const { rejectUnauthorized } = socket._http;
      const port = url.port || defaultPort;
      const conn = net.createConnection({ host: url.hostname, port });
      const proxy = url.protocol === 'https:' ? new tls.TLSSocket(conn, { rejectUnauthorized }) : conn;
      if (keepAlive && req.headers['connection'] && req.headers['connection'].toLowerCase() === 'keep-alive') {
        _setKeepAlive(proxy, keepAliveMsecs)
      } else {
        _setTimeout(proxy, keepAliveMsecs)
      }
      const _name = `${url.hostname}:${port}`
      proxy._name = _name;
      const headers = Object.assign({}, req.headers)
      delete headers['proxy-authorization']
      const rawHeaders = _getRawHeaders({ ...req, headers })
      proxy.write(Buffer.from(rawHeaders, 'utf-8'))
      proxy.write(req.body)
      proxy.on('error', _onError)
      proxy.on('close', _onClose)
      proxy.pipe(socket, { end: false })
      socket.pipe(proxy, { end: false })
    }
  }
}

/** @type {OnAuth} */
function _unAuth(_auth, callback) {
  callback(false)
}

function _hash(value) {
  if (!value) {
    return value;
  }
  /** @type {Record<string, string>} */
  const results = _hash.results = _hash.results || {}
  if (!results[value]) {
    results[value] = crypto.createHash('sha256').update(value).digest('hex');
  }
  return results[value]
}
/**
 * @param {HttpProxyOptions & { maxSockets?: number; ca?: string; cert?: string; key?: string; }} opts
 */
function _getAgent(opts) {
  /** @type {Record<string, http.Agent>} */
  const _httpAgents = _getAgent._httpAgents = _getAgent._httpAgents || {}
  /** @type {Record<string, https.Agent>} */
  const _httpsAgents = _getAgent._httpsAgents = _getAgent._httpsAgents || {}

  const { keepAlive, keepAliveMsecs, rejectUnauthorized, maxSockets, ca, cert, key } = opts;
  const name = `${keepAlive}:${keepAliveMsecs}:${maxSockets}:${rejectUnauthorized}:${_hash(ca)}:${_hash(cert)}:${_hash(key)}`

  const httpAgent = _httpAgents[name] || new http.Agent({ keepAlive, keepAliveMsecs, maxSockets })
  const httpsAgent = _httpsAgents[name] || new https.Agent({ keepAlive, keepAliveMsecs, maxSockets, rejectUnauthorized, ca, cert, key })

  _httpAgents[name] = httpAgent;
  _httpsAgents[name] = httpsAgent;

  return { httpAgent, httpsAgent }
}