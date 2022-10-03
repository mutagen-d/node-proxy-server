const { createProxyServer } = require('../../src');
const { connectionLogger } = require('../tool/connection.logger');

const port = 8080;
const time = () => new Date().toISOString()

const server = createProxyServer({ auth: true });

server.on('proxy-auth', (username, password, callback) => {
  callback(true)
})

server.on('error', (error) => {
  console.log(time(), 'server error', error)
})
server.on('connection', (socket) => {
  socket.setTimeout(15 * 1000, () => socket.destroy())
})

connectionLogger(server)

server.listen(port, '0.0.0.0', () => console.log(time(), 'proxy-server listening port', port))
