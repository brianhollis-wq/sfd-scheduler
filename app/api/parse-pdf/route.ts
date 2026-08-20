/**
 * POST /api/parse-pdf
 *
 * Accepts a multipart/form-data body with a "pdf" file field.
 * pdfjs-dist/legacy/build/pdf.js is declared as a webpack external (commonjs)
 * in next.config.mjs, so this require() becomes a real native Node.js call
 * in the server bundle — no bundling, no CJS/ESM interop issues.
 */

import { NextRequest, NextResponse } from 'next/server'
import { parseScheduleText } from '@/lib/parse-schedule'
import { createAdminClient } from '@/lib/supabase/admin'
import { TABLES } from '@/lib/db/tables'
import { findEmployee, type EmployeeRow } from '@/lib/employees/find'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Minimal type shim for pdfjs-dist v3 legacy build ─────────────

interface PdfjsLib {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (params: {
    data:            Uint8Array
    useSystemFonts?: boolean
    disableFontFace?: boolean
    verbosity?:      number
  }) => { promise: Promise<PdfjsDoc> }
}

interface PdfjsDoc {
  numPages: number
  getPage: (n: number) => Promise<PdfjsPage>
}

interface PdfjsPage {
  getTextContent: () => Promise<{
    items: Array<{ str?: string; transform: number[] }>
  }>
}

// ── PDF text extraction ───────────────────────────────────────────

async function extractPDFText(buffer: Buffer): Promise<string> {
  // webpack externals config marks this as "commonjs pdfjs-dist/legacy/build/pdf.js",
  // so the compiled bundle contains: const pdfjsMod = require('pdfjs-dist/legacy/build/pdf.js')
  // That is a real Node.js native require — no webpack bundling.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjsMod = require('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs: PdfjsLib = pdfjsMod.default ?? pdfjsMod

  // Hand pdf.js its worker directly instead of letting it find one.
  //
  // Under Node it runs the worker in-process, and PDFWorker resolves it in one
  // of two ways: it uses globalThis.pdfjsWorker if that is set, and otherwise
  // falls back to eval("require")("./pdf.worker.js") relative to pdf.js itself.
  // That fallback is a dynamic require the bundler cannot see, so the worker
  // was left out of the serverless deployment and the route died at run time
  // with: Setting up fake worker failed: "Cannot find module './pdf.worker.js'".
  //
  // Requiring it here fixes both halves at once. The require is a literal in
  // this file, so output tracing follows it and ships the file; and assigning
  // the module to globalThis means pdf.js takes the worker it is given and
  // never resolves a path at all.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjsWorker = require('pdfjs-dist/legacy/build/pdf.worker.js')
  ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker

  pdfjs.GlobalWorkerOptions.workerSrc = '' // in-process worker for Node.js

  const doc = await pdfjs
    .getDocument({
      data:            new Uint8Array(buffer),
      useSystemFonts:  true,
      disableFontFace: true,
      verbosity:       0,
    })
    .promise

  const pages: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page    = await doc.getPage(i)
    // Use same options as pdf-parse to maximise text compatibility
    const content = await page.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    } as Parameters<typeof page.getTextContent>[0])

    // Reconstruct lines using EXACT Y equality — same algorithm pdf-parse uses
    // (see pdf-parse/lib/pdf-parse.js render_page).
    // NOTE: pdfjs-dist v3 does not insert inter-item spaces automatically; we
    // insert one whenever adjacent same-line items are not already space-separated.
    let lastY: number | undefined
    let pageText = ''

    for (const item of content.items) {
      if (!item.str) continue
      const y = item.transform[5]
      if (lastY === y || lastY === undefined) {
        // Same line — add a separator space if neither side already has one
        if (lastY !== undefined && !pageText.endsWith(' ') && !item.str.startsWith(' ')) {
          pageText += ' '
        }
        pageText += item.str
      } else {
        pageText += '\n' + item.str
      }
      lastY = y
    }

    pages.push(pageText)
  }

  return pages.join('\n')
}

// ── Route handler ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('pdf') as File | null

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 })
    }

    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const text   = await extractPDFText(buffer)

    const parsed = parseScheduleText(text)

    if (!parsed.shiftDate) {
      return NextResponse.json(
        { error: 'Could not detect shift date. Make sure this is an SFD daily schedule PDF.' },
        { status: 422 },
      )
    }

    const supabase = createAdminClient()
    const rows = []

    for (const row of parsed.rows) {
      const emp = await findEmployee(supabase, row.firstName, row.lastName)

      // CCC interns return a synthetic row with _isCccIntern flag.
      // They have no real employee_id but are still "matched" for display/accountability.
      const isCccIntern = !!(emp as (EmployeeRow & { _isCccIntern?: boolean }) | null)?._isCccIntern

      rows.push({
        ...row,
        // Override assignment_type for interns regardless of what the PDF type code was
        assignmentType:  isCccIntern ? 'ccc_intern' : row.assignmentType,
        employeeId:      isCccIntern ? null : (emp?.id ?? null),
        employeeDisplay: isCccIntern
          ? `${row.firstName} ${row.lastName} (CCC Intern)`
          : emp ? `${emp.first_name} ${emp.last_name}` : null,
        matched:         !!emp,
        isCccIntern,
      })
    }

    return NextResponse.json({
      shiftDate: parsed.shiftDate,
      rows,
      warnings:  parsed.warnings,
      // Debug: first 60 lines of raw extracted text, shown in UI when 0 rows parsed
      debugLines: parsed.rows.length === 0 ? text.split('\n').slice(0, 60) : undefined,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[parse-pdf]', msg)
    return NextResponse.json({ error: `Parse failed: ${msg}` }, { status: 500 })
  }
}
