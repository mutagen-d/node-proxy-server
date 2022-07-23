const { createHttpProxy } = require('./src/http-proxy')
const { createSocksProxy } = require('./src/socks-proxy')

module.exports = { createHttpProxy, createSocksProxy }
