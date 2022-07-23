const net = require('net');
const { createHttpProxy } = require('../src/http-proxy');
const { createSocksProxy } = require('../src/socks-proxy');

const time = () => new Date().toISOString();
const port = 8080;

const server = net.createServer()

createSocksProxy(server, {
  keepAliveMsecs: 5000,
  onAuth: (username, password, callback) => {
    if (username === 'test' && password === '123') {
      callback(true)
    } else {
      callback(false)
    }
  },
})
createHttpProxy(server, {
  authType: 'Basic',
  authRealm: 'Proxy AUTH',
  keepAliveMsecs: 5000,
  onAuth: (auth, callback) => {
    if (auth.username === 'test' && auth.password === '123') {
      callback(true)
    } else {
      callback(false)
    }
  },
})

server.listen(port, () => console.log(time(), 'server listening port', port))