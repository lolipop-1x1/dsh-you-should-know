import { build } from 'esbuild'
import { createServer } from 'node:http'

const result = await build({
  entryPoints: [new URL('client.tsx', import.meta.url).pathname], bundle: true,
  platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
})
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>客户端回归测试</title>
<style>body{font:14px system-ui;margin:24px;color-scheme:light}button,select{padding:6px}#dock{position:relative;margin-top:420px}#results{white-space:pre-wrap}#settings{max-width:640px}</style>
<h1>You Should Know 客户端回归</h1><p>真实 React 组件与确定性模拟接口；不连接 Harness 会话或模型。</p>
<button id="run">运行回归</button><pre id="results" role="status"></pre><div id="settings"></div><div id="dock"></div>
<script>${result.outputFiles[0].text.replace(/<\/script/giu, '<\\/script')}</script></html>`
const port = Number(process.env.YSK_TEST_PORT ?? 3100)
const server = createServer((_, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(html)
})
server.listen(port, '127.0.0.1', () => console.log(`客户端回归：http://127.0.0.1:${port}`))
process.on('SIGINT', () => server.close())
process.on('SIGTERM', () => server.close())
