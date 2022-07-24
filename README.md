# node-proxy-server

## Http and socks proxy server

This module provides `http` and `socks` proxy server implementation that can run both protocols in one server instance.

## Installation

```bash
npm install @mutagen-d/node-proxy-server
```

## Example

```js
const net = require('net')
const { createHttpProxy, createSocksProxy } = require('@mutagen-d/node-proxy-server')

const server = net.createServer()

const options = {
  keepAlive: true,
  keepAliveMsecs: 5000,
}
createHttpProxy(server, options)
createSocksProxy(server, options)

server.listen(8080)
```

## API

### `createHttpProxy([serverOrOptions [, options]])`

- `serverOrOptions` - `net.Server` or `HttpProxyServerOptions`
- `options` - `HttpProxyServerOptions`

`HttpProxyServerOptions`:

| name             | type                  | required | default | description                                                                              |
| ---------------- | --------------------- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| `keepAlive`      | `boolean`             | `no`     | `true`  | controls keep-alive behavior                                                             |
| `keepAliveMsecs` | `number`              | `no`     | `1000`  | inactivity timeout before close connection                                               |
| `authType`       | `"Basic" \| "Bearer"` | `no`     | -       | if defined then proxy authentication required                                            |
| `authRealm`      | `string`              | `no`     | -       |                                                                                          |
| `onAuth`         | `OnAuth`              | `no`     | -       |                                                                                          |
| `useHttpRequest` | `boolean`             | `no`     | -       | if `ture` then use `http.request` for HTTP requests, otherwise directly use `net.Socket` |
| `rewriteOptions` | `RewriteOptions`      | `no`     | -       | if defined then rewrite connection options for each subsequence connections              |

1. Authorization:

```js
const server = createHttpProxy({
  authType: 'Basic',
  onAuth: (auth, callback) => {
    switch (auth.type) {
      case 'Basic':
        // authorize connection
        callback(auth.username === 'test' && auth.password === '1234')
        break
      default:
        // reject connection
        callback(false)
        break
    }
  },
})
```

2. Rewrite options:

```js
const server = createHttpProxy({
  rewriteOptions: (req, callback) => {
    if (req.url === 'localhost:443') {
      callback({ rejectUnauthorized: false })
    }
  },
})
```

### `createSocksProxy([serverOrOptions [, options]])`

- `serverOrOptions` - `net.Server` or `SocksProxyServerOptions`
- `options` - `SocksProxyServerOptions`

`SocksProxyServerOptions`:

| name             | type             | required | default | description                                                                 |
| ---------------- | ---------------- | -------- | ------- | --------------------------------------------------------------------------- |
| `keepAlive`      | `boolean`        | `no`     | `true`  | controls keep-alive behavior                                                |
| `keepAliveMsecs` | `number`         | `no`     | `1000`  | inactivity timeout before close connection                                  |
| `onAuth`         | `OnAuth`         | `no`     | -       | if defined then prefer password authentication                              |
| `rewriteOptions` | `RewriteOptions` | `no`     | -       | if defined then rewrite connection options for each subsequence connections |

1. Authorization

```js
const server = createSocksProxy({
  onAuth: (username, password, callback) => {
    callback(username === 'test' && password === '1234')
  },
})
```

2. Rewrite options:

```js
const server = createSocksProxy({
  rewriteOptions: (_, callback) => {
    callback({ rejectUnauthorized: false })
  },
})
```
