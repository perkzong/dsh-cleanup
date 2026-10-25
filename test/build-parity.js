/**
 * 为「与 CLI --health 对账」准备一份独立夹具，并输出它的 DSH_HOME。
 * 用法：node test/build-parity.js
 * 然后由 PowerShell 跑 CLI：
 *   $env:DSH_HOME='<输出的路径>'; node C:\dsh\dsh-tool.js --health | Out-File -Encoding utf8 ...\_test\cases\parity\cli-health.txt
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixture } from './fixture.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(HERE, '..', '_test', 'cases', 'parity')
const meta = buildFixture(root)
fs.writeFileSync(path.join(root, 'meta.json'), JSON.stringify({ dshHome: meta.dshHome }, null, 2))
console.log(meta.dshHome)
