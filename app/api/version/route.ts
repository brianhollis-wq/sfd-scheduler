/**
 * GET /api/version
 *
 * Reports which build is actually serving the request.
 *
 * Vercel gives every deployment its own immutable URL, so a bookmarked
 * deployment URL keeps serving that build forever however many times the
 * project is redeployed. That is indistinguishable from a fix not working:
 * the same error comes back, from code that no longer exists on main.
 *
 * Hit this to settle it. If `commit` is not the SHA you just merged, the URL
 * is old — the fix is fine, the page is stale.
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // Whether the PDF worker resolved is the specific thing that has been
  // failing, so report it here rather than making someone upload a file to
  // find out.
  let pdfWorker: string
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const worker = require('pdfjs-dist/legacy/build/pdf.worker.js')
    pdfWorker = typeof worker?.WorkerMessageHandler === 'function'
      ? 'loaded'
      : 'loaded but WorkerMessageHandler missing'
  } catch (err) {
    pdfWorker = `FAILED — ${err instanceof Error ? err.message : String(err)}`
  }

  return NextResponse.json({
    commit:      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    commitFull:  process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    branch:      process.env.VERCEL_GIT_COMMIT_REF ?? null,
    message:     process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    environment: process.env.VERCEL_ENV ?? 'local',
    deploymentUrl: process.env.VERCEL_URL ?? null,
    pdfWorker,
    now: new Date().toISOString(),
  })
}
