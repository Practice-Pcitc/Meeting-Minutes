const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 5173
const API_HOST = process.env.API_HOST || 'localhost'
const API_PORT = process.env.API_PORT || 3000
const DIST = path.resolve(__dirname, 'dist')

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function staticHandler(req, res) {
  let url = decodeURIComponent(req.url.split('?')[0])
  if (url === '/') url = '/index.html'
  let filePath = path.join(DIST, url)
  if (!filePath.startsWith(DIST)) { filePath = path.join(DIST, 'index.html') }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST, 'index.html')
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

function proxyHandler(req, res) {
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
  }
  const proxy = http.request(options, (pres) => {
    res.writeHead(pres.statusCode, pres.statusMessage, pres.headers)
    pres.pipe(res)
  })
  proxy.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: `API proxy error: ${err.message}` }))
  })
  req.pipe(proxy)
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    proxyHandler(req, res)
  } else {
    staticHandler(req, res)
  }
})

server.listen(PORT, () => {
  console.log(`Static server running at http://localhost:${PORT}`)
})
