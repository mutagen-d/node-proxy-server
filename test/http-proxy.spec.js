const fs = require('fs')
const path = require('path')
const net = require('net')
const http = require('http')
const https = require('https')
const axios = require('axios').default
const ProxyAgent = require('proxy-agent')
const { describe, beforeAll, afterAll, it, expect, afterEach } = require('@jest/globals')
const { createHttpProxy } = require('../src/http-proxy')

const time = () => new Date().toISOString()

/**
 * @param {net.Server} server
 */
const trackSockets = (server) => {
  /** @type {Record<string, net.Socket>} */
  const sockets = {}
  server.on('connection', (socket) => {
    const name = socket.remoteAddress + ':' + socket.remotePort
    sockets[name] = socket;
    socket.on('close', () => {
      delete sockets[name]
    })
  })
  server.on('destroy', () => {
    for (const name in sockets) {
      sockets[name].destroy()
    }
  })
}

describe('http-proxy', () => {
  /** @template T */
  function Deffer() {
    /** @type {Promise<T>} */
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    })
  }
  /** @param {import('net').Server} server */
  const serverListen = async (server) => {
    const deffer = new Deffer();
    server.listen(() => {
      const address = server.address();
      deffer.resolve(address ? address.port : null)
    })
    server.on('error', (e) => {
      console.log(time(), 'server-error', e)
    })
    trackSockets(server)
    return deffer.promise;
  }
  /** @param {import('net').Server} server */
  const serverClose = async (server) => {
    const deffer = new Deffer();
    server.emit('destroy')
    server.close((error) => {
      error ? deffer.reject(error) : deffer.resolve();
    })
    return deffer.promise;
  }

  /**
   * @type {{
   *  server: import('../src/http-proxy').HttpProxyServer;
   *  port: number;
   *  auth: { username: string; password: string; }
   *  options: import('../src/http-proxy').HttpProxyServerOptions;
   * }}
   */
  const proxy = {
    auth: {
      username: 'test',
      password: '1234',
    },
    options: {
      keepAlive: true,
      keepAliveMsecs: 1000,
      authType: 'Basic',
      authRealm: 'Need authentication',
      onAuth: myAuth,
    }
  }
  /**
   * @type {{
   *  server: http.Server;
   *  port: number;
   *  onRequest: http.RequestListener;
   * }}
   */
  const _http = {
    onRequest: function onRequest(req, res) {
      if (req.url.includes('/json')) {
        const json = { foo: 'bar' }
        res.writeHead(200, {
          'Server': 'test-server',
          'Content-Type': 'application/json',
          'Content-Length': JSON.stringify(json).length,
        })
        res.end(JSON.stringify(json))
      } else {
        res.writeHead(200, { 'Server': 'test-server', 'Content-Type': 'text/plain' })
        res.end('test-body')
      }
    },
  }
  /**
   * @type {{
   *  server: https.Server;
   *  port: number;
   *  ssl: {
   *    cert: string;
   *    key: string;
   *  }
   * }}
   */
  const _https = {
    ssl: {
      cert: fs.readFileSync(path.join(__dirname, './public-cert.pem'), 'utf-8'),
      key: fs.readFileSync(path.join(__dirname, './private-key.pem'), 'utf-8'),
    }
  }

  /**
   * @type {{
   *  proxy: import('axios').AxiosProxyConfig;
   * }}
   */
  const _client = {}

  /** @type {import('../src/http-proxy').OnAuth */
  function myAuth(auth, callback) {
    switch (auth.type) {
      case 'Basic':
        callback(auth.username === proxy.auth.username && auth.password === proxy.auth.password);
        break;
      case 'Bearer':
        callback(auth.token === proxy.auth.password)
        break;
      default:
        callback(false)
    }
  }
  /**
 * @param {{ method?: string; url: string; data?: any; headers?: Record<string, string>; } | string} config
 * @param {import('axios').AxiosRequestConfig} [opts]
 */
  const request = async (config, opts) => {
    config = typeof config === 'string' ? { method: 'GET', url: config } : Object.assign({ method: 'GET' }, config)
    const res = await axios.request({
      ...config,
      validateStatus: (status) => {
        return status >= 200 && status < 600;
      },
      proxy: { ..._client.proxy },
      ...opts,
      headers: {
        ...config.headers,
        ...(opts ? opts.headers : undefined),
        'connection': 'keep-alive',
      },
    })
    return res
  }

  beforeAll(async () => {

    proxy.server = createHttpProxy({ ...proxy.options })
    _http.server = http.createServer(_http.onRequest)
    _https.server = https.createServer(_https.ssl, _http.onRequest)

    proxy.port = await serverListen(proxy.server);
    _http.port = await serverListen(_http.server)
    _https.port = await serverListen(_https.server)

    _client.proxy = {
      protocol: 'http:',
      host: '127.0.0.1',
      port: proxy.port,
    }
  })
  afterAll(async () => {
    await serverClose(proxy.server)
    await serverClose(_http.server)
    await serverClose(_https.server)
  })

  afterEach(() => {
    proxy.server._rewriteOptions = proxy.options.rewriteOptions;
  })

  describe('create', () => {
    it('http.Server', () => {
      expect.assertions(1)
      try {
        const server = http.createServer()
        const _proxy = createHttpProxy(server)
      } catch (e) {
        expect(e.message).toMatch(/http\.Server not allowed/i)
      }
    })
    it('net.Server', () => {
      const server = net.createServer()
      const proxy = createHttpProxy(server)
      expect(proxy).toEqual(server)
    })
  })
  describe('Proxy Authentication Required', () => {
    it('Basic', async () => {
      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
        opts: {
          proxy: { ..._client.proxy },
        }
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise;

        const res = await request(url, opts)

        expect(res.status).toBe(407)

        expect(proxy.options.authRealm).toBeDefined()
        expect(res.headers['proxy-authenticate']).toMatch('Basic')
        expect(res.headers['proxy-authenticate']).not.toMatch('Bearer')
        expect(res.headers['proxy-authenticate']).toMatch(proxy.options.authRealm)
      }, Promise.resolve())
    })

    it('Bearer', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        callback({ authType: 'Bearer' })
      }

      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise

        const res = await request(url, opts)

        expect(res.status).toBe(407)

        expect(proxy.options.authRealm).toBeDefined()
        expect(res.headers['proxy-authenticate']).toMatch('Bearer')
        expect(res.headers['proxy-authenticate']).not.toMatch('Basic')
        expect(res.headers['proxy-authenticate']).toMatch(proxy.options.authRealm)
      }, Promise.resolve())
    })

    it('Type mismatch', async () => {

      proxy.server._rewriteOptions = (req, callback) => {
        callback({ authType: 'Basic' })
      }

      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
        opts: {
          headers: { 'proxy-authorization': 'Basic' },
        }
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
        opts: {
          headers: { 'proxy-authorization': 'Basic' },
        }
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise

        const res = await request(url, opts)

        expect(res.status).toBe(407)

        expect(proxy.options.authRealm).toBeDefined()
        expect(res.headers['proxy-authenticate']).toMatch('Basic')
        expect(res.headers['proxy-authenticate']).not.toMatch('Bearer')
        expect(res.headers['proxy-authenticate']).toMatch(proxy.options.authRealm)
      }, Promise.resolve())
    })
    it('Wrong credentials - Bearer', async () => {

      proxy.server._rewriteOptions = (req, callback) => {
        callback({ authType: 'Bearer' })
      }

      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
        opts: {
          headers: { 'proxy-authorization': 'Bearer 1' },
        }
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
        opts: {
          headers: { 'proxy-authorization': 'Bearer 321' },
        }
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise

        const res = await request(url, opts)

        expect(res.status).toBe(407)

        expect(proxy.options.authRealm).toBeDefined()
        expect(res.headers['proxy-authenticate']).toMatch('Bearer')
        expect(res.headers['proxy-authenticate']).not.toMatch('Basic')
        expect(res.headers['proxy-authenticate']).toMatch(proxy.options.authRealm)
      }, Promise.resolve())
    })
    it('Wrong credentials - Basic', async () => {

      proxy.server._rewriteOptions = (req, callback) => {
        callback({ authType: 'Basic' })
      }

      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
        opts: {
          headers: { 'proxy-authorization': 'Basic ' + Buffer.from('user:321').toString('base64') },
        }
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
        opts: {
          headers: { 'proxy-authorization': 'Basic ' + Buffer.from('user:321').toString('base64') },
        }
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise

        const res = await request(url, opts)

        expect(res.status).toBe(407)

        expect(proxy.options.authRealm).toBeDefined()
        expect(res.headers['proxy-authenticate']).toMatch('Basic')
        expect(res.headers['proxy-authenticate']).not.toMatch('Bearer')
        expect(res.headers['proxy-authenticate']).toMatch(proxy.options.authRealm)
      }, Promise.resolve())
    })
  })

  describe('Proxy authorization', () => {
    it('Basic', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        const opts = {}
        if (req.url.includes('https://') && req.method !== 'CONNECT') {
          Object.assign(opts, { rejectUnauthorized: false })
        }
        callback({ ...opts, authType: 'Basic' })
      }

      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise
        const res = await request(url, {
          proxy: {
            ..._client.proxy,
            auth: proxy.auth,
          },
          headers: {
            connection: 'keep-alive',
          },
          ...opts,
        })
        expect(res.status).toBe(200)
        expect(res.headers['server']).toBe('test-server')
        expect(res.headers['content-type']).toBe('text/plain')
        expect(res.data).toBe('test-body')
      }, Promise.resolve())
    })
    it('Bearer', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        const opts = {}
        if (req.url.includes('https://') && req.method !== 'CONNECT') {
          Object.assign(opts, { rejectUnauthorized: false })
        }
        callback({ ...opts, authType: 'Bearer' })
      }

      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise
        const res = await request(url, {
          ...opts,
          headers: {
            'proxy-authorization': 'Bearer ' + proxy.auth.password,
          }
        })

        expect(res.status).toBe(200)
        expect(res.headers['server']).toBe('test-server')
        expect(res.headers['content-type']).toBe('text/plain')
        expect(res.data).toBe('test-body')
      }, Promise.resolve())
    })
  })
  describe('Proxy https', () => {
    it('google.com', async () => {
      proxy.server._rewriteOptions = (_req, callback) => {
        callback({ authType: undefined })
      }
      const res = await request('https://google.com', {
        proxy: false,
        httpsAgent: new ProxyAgent({
          ..._client.proxy,
        })
      })
      expect(res.status).toBe(200)
    })
  })
  describe('useHttpRequest', () => {
    it('true', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        const opts = {}
        if (req.url.includes('https:')) {
          Object.assign(opts, { rejectUnauthorized: false })
        }
        callback({ ...opts, useHttpRequest: true })
      }
      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise
        const res = await request(url, {
          ...opts,
          proxy: {
            ..._client.proxy,
            auth: proxy.auth,
          }
        })

        expect(res.status).toBe(200)
        expect(res.headers['server']).toBe('test-server')
        expect(res.headers['content-type']).toBe('text/plain')
        expect(res.data).toBe('test-body')
      }, Promise.resolve())
    })
  })
  describe('keepAlive', () => {
    it('false', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        callback({ keepAlive: false, rejectUnauthorized: false, keepAliveMsecs: 400 })
      }

      const requests = [{
        url: `http://127.0.0.1:${_http.port}/path?_=123`,
      }, {
        url: `https://127.0.0.1:${_https.port}/path?_=123`,
      }]

      await requests.reduce(async (promise, { url, opts }) => {
        await promise
        const res = await request(url, {
          ...opts,
          proxy: {
            ..._client.proxy,
            auth: proxy.auth,
          }
        })

        expect(res.status).toBe(200)
        expect(res.headers['server']).toBe('test-server')
        expect(res.headers['content-type']).toBe('text/plain')
        expect(res.data).toBe('test-body')
      }, Promise.resolve())
    })
  })
  describe('Bad request', () => {
    it('Wrong url', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        callback({ keepAlive: false, authType: undefined })
      }

      const url = `http://127.0.0.1:${proxy.port}/path?_=1`
      const res = await request(url, { proxy: false })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })
  })
  describe('Proxy misc', () => {

    it('json', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        callback({ keepAlive: false, authType: undefined, useHttpRequest: true })
      }

      const url = `http://127.0.0.1:${_http.port}/json?_=1`
      const res = await request(url)
      expect(res.status).toBe(200)
      expect(res.data).toBeDefined()
      expect(res.data).toHaveProperty('foo')
    })

    it('onAuth defaults', async () => {
      proxy.server._rewriteOptions = (req, callback) => {
        callback({ keepAlive: false, authType: 'Bearer', onAuth: undefined })
      }

      const url = `http://127.0.0.1:${_http.port}/json?_=1`
      const res = await request(url, {
        headers: {
          'proxy-authorization': 'Bearer ' + proxy.auth.password,
        }
      })

      expect(res.status).toBe(407)
    })
  })
})