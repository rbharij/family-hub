#!/usr/bin/env node
/**
 * Applies the latest SQL migration to the Supabase project.
 * Requires a Supabase personal access token:
 *   https://app.supabase.com/account/tokens
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-migration.mjs
 * Or set it in .env.local as SUPABASE_ACCESS_TOKEN=...
 */

import { readFileSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname  = dirname(fileURLToPath(import.meta.url))
const projectRef = "welqbxlthzqmyijsfswj"

// Load .env.local for convenience
try {
  const envContent = readFileSync(join(__dirname, "../.env.local"), "utf8")
  for (const line of envContent.split("\n")) {
    const [k, ...rest] = line.split("=")
    if (k && rest.length && !process.env[k.trim()]) {
      process.env[k.trim()] = rest.join("=").trim()
    }
  }
} catch { /* .env.local not found, continue */ }

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error("❌  SUPABASE_ACCESS_TOKEN is not set.")
  console.error("    Get a token at: https://app.supabase.com/account/tokens")
  console.error("    Then run: SUPABASE_ACCESS_TOKEN=<token> node scripts/apply-migration.mjs")
  process.exit(1)
}

// Find latest migration file (or the one passed as argument)
const migrationsDir = join(__dirname, "../supabase/migrations")
const targetFile    = process.argv[2]
  ?? readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort().at(-1)

if (!targetFile) {
  console.error("❌  No migration files found.")
  process.exit(1)
}

const sqlPath = targetFile.startsWith("/") ? targetFile : join(migrationsDir, targetFile)
const sql     = readFileSync(sqlPath, "utf8")

console.log(`📄  Applying migration: ${targetFile}`)
console.log(`🔗  Project: ${projectRef}`)

const resp = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ query: sql }),
  }
)

if (!resp.ok) {
  const body = await resp.text()
  console.error(`❌  Migration failed (HTTP ${resp.status}):`)
  console.error(body)
  process.exit(1)
}

const result = await resp.json().catch(() => ({}))
console.log("✅  Migration applied successfully!")
if (result && Object.keys(result).length > 0) {
  console.log(JSON.stringify(result, null, 2))
}
