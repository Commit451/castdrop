#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from 'fs'
import { join, relative, dirname } from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const CONFIG = {
  distDir: join(__dirname, '../dist'),
  bucketName: 'castdrop',
} as const

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

function log(message: string, indent = 0): void {
  console.log('  '.repeat(indent) + message)
}

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

async function main() {
  log('=== CastDrop Deployment ===')

  if (!existsSync(CONFIG.distDir)) {
    log('Error: dist/ not found. Run "npm run build" first.')
    process.exit(1)
  }

  // Upload site files
  log('\nStep 1: Uploading site files...')
  const files = getAllFiles(CONFIG.distDir)
  for (const file of files) {
    const key = relative(CONFIG.distDir, file)
    const ext = '.' + key.split('.').pop()
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
    log(`Uploading: ${key}`, 1)
    exec(
      `wrangler r2 object put ${escapeShellArg(CONFIG.bucketName + '/' + key)} ` +
      `--file=${escapeShellArg(file)} ` +
      `--content-type=${escapeShellArg(contentType)}`
    )
  }
  log(`Uploaded ${files.length} files`)

  // Deploy worker
  log('\nStep 2: Deploying worker...')
  process.chdir(__dirname)
  exec('wrangler deploy')

  // Purge Cloudflare cache for index.html
  log('\nStep 3: Purging cache...')
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (accountId && apiToken) {
    try {
      // Get zone ID for commit451.com
      const zonesRaw = exec(
        `curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=commit451.com" ` +
        `-H "Authorization: Bearer ${apiToken}" -H "Content-Type: application/json"`
      )
      const zones = JSON.parse(zonesRaw)
      if (zones.result?.[0]?.id) {
        const zoneId = zones.result[0].id
        exec(
          `curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache" ` +
          `-H "Authorization: Bearer ${apiToken}" -H "Content-Type: application/json" ` +
          `-d '{"files":["https://castdrop.commit451.com/","https://castdrop.commit451.com/index.html"]}'`
        )
        log('Cache purged for index.html')
      } else {
        log('Warning: Could not find zone ID, skipping cache purge')
      }
    } catch {
      log('Warning: Cache purge failed (non-fatal)')
    }
  }

  log('\n=== Deployment Complete ===')
}

main().catch((e) => {
  console.error('Deployment failed:', e)
  process.exit(1)
})
