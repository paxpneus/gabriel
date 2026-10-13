import http from 'http'

// Workers have no Express app; docker healthcheck + autoheal need /health on PORT or they restart the container.
export function startHealthServer(): void {
    const port = Number(process.env.PORT)
    if (!port) return

    http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok' }))
            return
        }
        res.writeHead(404)
        res.end()
    }).listen(port, () => console.log(`[HEALTH] /health ouvindo na porta ${port}`))
}
