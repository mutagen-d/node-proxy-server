const time = () => new Date().toISOString()

/** @param {import('../../src').ProxyServer} server */
const connectionLogger = (server) => {
  let count = 0;
  server.on('connection', (socket) => {
    count += 1;
    const { remoteAddress: srcHost, remotePort: srcPort } = socket;
    console.log(time(), count, 'connect', { srcHost, srcPort })
    socket.on('close', () => {
      count -= 1;
      console.log(time(), count, 'disconnect', { srcHost, srcPort })
    })
  })
  let pcount = 0;
  server.on('proxy-connection', (stream, info) => {
    const { dstHost, dstPort } = info;
    pcount += 1;
    console.log(time(), pcount, 'connect-proxy', { dstHost, dstPort })
    stream.on('close', () => {
      pcount -= 1;
      console.log(time(), pcount, 'disconnect-proxy', { dstHost, dstPort })
    })
  })
  return server;
}

module.exports = { connectionLogger }
