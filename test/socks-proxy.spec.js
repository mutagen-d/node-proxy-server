const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { describe, beforeAll, afterAll, it, expect } = require('@jest/globals')
const axios = require('axios').default;
const { SocksProxyAgent } = require('socks-proxy-agent')
const { createSocksProxy } = require('../src/socks-proxy')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('socks-proxy', () => {
  /** @template T */
  function Deffer() {
    /** @type {Promise<T>} */
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    })
  }
  /** @param {import('net').Server} server */
  const trackSockets = (server) => {
    if (server._tracking) {
      return;
    }
    server._tracking = true;
    /** @type {Record<string, import('net').Socket>} */
    const sockets = {}
    server.on('connection', (socket) => {
      const name = `${socket.remoteAddress}:${socket.remotePort}`
      sockets[name] = socket;
      socket.on('close', () => {
        delete sockets[name]
      })
    })
    server.on('destroy', () => {
      for (const name in sockets) {
        sockets[name].destroy()
        delete sockets[name]
      }
    })
  }

  /** @param {import('net').Server} server */
  const serverListen = async (server) => {
    /** @type {Deffer<number>} */
    const deffer = new Deffer()
    server.listen(() => {
      deffer.resolve(server.address().port)
    })
    trackSockets(server)
    return deffer.promise;
  }

  /** @param {import('net').Server} server */
  const serverClose = async (server) => {
    const deffer = new Deffer()
    server.close((error) => {
      error ? deffer.reject(error) : deffer.resolve()
    })
    server.emit('destroy')
    await deffer.promise;
  }
  /**
   * @type {{
   *  server: import('../src/socks-proxy').SocksProxyServer;
   *  port: number;
   *  options: import('../src/socks-proxy').SocksProxyOptions;
   *  auth: { username: string; password: string; };
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
      onAuth: (username, password, callback) => {
        callback(proxy.auth.username === username && proxy.auth.password === password)
      },
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
    onRequest: (req, res) => {
      if (req.url.includes('/json')) {
        const json = JSON.stringify({ foo: 'bar' })
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': json.length,
        })
        res.end(json)
      } else {
        const text = 'test-socks'
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': text.length,
        })
        res.end(text)
      }
    }
  }
  /**
   * @type {{
   *  server: https.Server;
   *  port: number;
   *  cert: string;
   *  key: string;
   * }}
   */
  const _https = {}

  beforeAll(async () => {
    proxy.server = createSocksProxy(proxy.options)
    _http.server = http.createServer(_http.onRequest);
    _https.cert = fs.readFileSync(path.join(__dirname, 'public-cert.pem'), 'utf-8')
    _https.key = fs.readFileSync(path.join(__dirname, 'private-key.pem'), 'utf-8')
    _https.server = https.createServer({ cert: _https.cert, key: _https.key }, _http.onRequest);

    proxy.port = await serverListen(proxy.server)
    _http.port = await serverListen(_http.server)
    _https.port = await serverListen(_https.server)
  })

  afterAll(async () => {
    await serverClose(proxy.server)
    await serverClose(_http.server)
    await serverClose(_https.server)
  })

  it('Invalid params', () => {
    const server = http.createServer()
    expect.assertions(1)
    try {
      const proxy = createSocksProxy(server)
    } catch (e) {
      expect(e.message).toMatch(/http\.Server not allowed/i)
    }
  })
  it('request', async () => {
    const config = {
      hostname: '127.0.0.1',
      port: proxy.port,
      tls: {
        rejectUnauthorized: false,
      },
    }
    const agents = [{
      protocol: 'socks4:'
    }, {
      protocol: 'socks4a:',
    }, {
      protocol: 'socks5:',
      username: proxy.auth.username,
      password: proxy.auth.password,
    }, {
      protocol: 'socks5h:',
    }].map(opts => new SocksProxyAgent({ ...config, ...opts }))

    const run = async () => {
      const requests = [{
        url: `http://localhost:${_http.port}/path?_=${Date.now()}`,
      }, {
        url: `https://localhost:${_https.port}/json?_=${Date.now()}`,
      }, {
        url: `https://example.com/?_=${Date.now()}`,
      }]

      const promises = agents.map(async (agent) => {
        await requests.reduce(async (promise, { url }) => {
          await promise;
          const res = await axios.get(url, {
            httpAgent: agent,
            httpsAgent: agent,
            validateStatus: (status) => status >= 200 && status < 600,
          })
          expect(res.status).toEqual(200)
          expect(res.data).toBeDefined()
          if (url.includes('/json')) {
            expect(res.data).toHaveProperty('foo')
          } else if (!url.includes('example.com')) {
            expect(res.data).toEqual('test-socks')
          }
        }, Promise.resolve())
      })
      await Promise.all(promises)
    }

    await run()
    await sleep(1.5 * 1000)
    proxy.server._socksRewriteOptions = (_, callback) => {
      callback({ keepAlive: false })
    }
    await run()
  }, 10 * 1000)
})