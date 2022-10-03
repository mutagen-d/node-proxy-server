const fs = require('fs')
const util = require('util')
const path = require('path')
const os = require('os')
const { Client } = require('ssh2')
const { createProxyServer } = require('../../src')
const { connectionLogger } = require('../tool/connection.logger')

const time = () => new Date().toISOString()

const sshClient = new Client()
const forwardOut = util.promisify(sshClient.forwardOut)

const server = createProxyServer({
  auth: true,
  createProxyConnection: async (info) => {
    const stream = await forwardOut.call(sshClient, info.srcHost, info.srcPort, info.dstHost, info.dstPort)
    return stream;
  },
})

server.on('proxy-auth', (username, password, callback) => {
  callback(true)
})
server.on('error', (e) => {
  console.log(time(), 'server error', e)
})

connectionLogger(server)

sshClient.connect({
  host: 'localhost',
  username: 'username',
  privateKey: fs.readFileSync(path.join(os.homedir(), '.ssh/id_rsa')),
  keepaliveInterval: 0,
})
sshClient.on('ready', () => {
  const port = 8080;
  console.log(time(), 'ssh-client ready')
  server.listen(port, '0.0.0.0', () => console.log(time(), 'proxy-server listening port', port))
})

module.exports = { proxyServer: server, sshClient }
