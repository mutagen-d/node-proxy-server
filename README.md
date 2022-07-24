# node-proxy-server

## Http and socks proxy server

This module provides `http` and `socks` proxy server implementation that can run both protocols in one server instance.

## Installation

```bash
npm install node-proxy-server
```

## Example

```js
const net = require('net')
const { createHttpProxy, createSocksProxy } = require('node-proxy-server')

const server = net.createServer();

const options = {
  keepAlive: true,
  keepAliveMsecs: 5000,
}
createHttpProxy(server, options)
createSocksProxy(server, options)

server.listen(8080)
```