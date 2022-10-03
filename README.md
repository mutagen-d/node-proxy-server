# Proxy Server

Http and Socks proxy server with zero dependencies

## Content

- [Usage](#usage)
- [Authorization](#authorization)
- [Keep Alive](#keepalive)
- [Custom proxy connection](#custom-proxy-connection)
- [Examples](#examples)

## Usage

```js
const { createProxyServer } = require('./src')
const port = 8080
const server = createProxyServer()
server.on('error', (error) => {
  console.log('server error', error)
})
server.listen(port, '0.0.0.0', () => console.log('proxy-server listening port', port))
```

## Authorization

```js
const server = createProxyServer({ auth: true })
server.on('proxy-auth', (username, password, callback) => {
  callback(username === 'login' && password === '1234')
})
```

Only first `"proxy-auth"` event listener will be envoked

## KeepAlive

```js
server.on('connection', (socket) => {
  socket.setTimeout(30 * 1000, () => socket.destroy())
})
```

## Custom proxy connection

Use `createProxyConnection` method.
By default `net` module is used to create connection, e.i.

```js
const net = require('net')
const { createProxyServer } = require('./src')
const server = createProxyServer({
  createProxyConnection: async (info) => {
    const socket = net.createConnection({ host: info.dstHost, port: info.dstPort })
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket))
      socket.on('error', (error) => reject(error))
    })
  }
})
```
One can also use other methods to create connection, e.i [ssh2-dynamic-port-forwarding](https://github.com/mscdex/ssh2#dynamic-11-port-forwarding-using-a-socksv5-proxy-using-socksv5)

```js
const { createProxyServer } = require('./src')
const { Client } = require('ssh2')
const util = require('util')

const sshClient = new Client()
const forwardOut = util.promisify(sshClient.forwardOut)

const server = createProxyServer({
  createProxyConnection: async (info) => {
    const stream = await forwardOut.call(sshClient, info.srcHost, info.srcPort, info.dstHost, info.dstPort)
    return stream
  },
})

sshClient.connect({
  host: 'localhost',
  username: 'username',
  password: '12345',
})
sshClient.on('ready', () => {
  const port = 8080
  server.listen(port, '0.0.0.0', () => console.log('proxy-server listening port', port))
})
```

## Examples

see [examples](./example)
