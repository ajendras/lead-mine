import { createObjectCsvWriter } from 'csv-writer';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { google } from 'googleapis';
import { SERVICE_ACCOUNT_PATH } from './config.js';
import type { Lead, ExportFormat, GoogleSheetsOptions } from './types.js';

/**
 * Writes an array of Lead records to disk in the requested format.
 * Creates the destination directory automatically. Uses csv-writer for CSV,
 * Node fs for JSON, the xlsx library for Excel output, and a Tailwind-based
 * self-contained HTML document with embedded Google Maps previews for HTML.
 *
 * Columns are normalized and ordered consistently across formats. New
 * 'hubspot' and 'salesforce' formats produce CRM-ready CSVs with address
 * component parsing.
 *
 * @param leads - Array of leads to export (must be non-empty)
 * @param format - Explicit format (csv | json | xlsx | html | hubspot | salesforce)
 * @param filepath - Destination path on disk
 * @throws {Error} With a clear message when validation or I/O fails
 */
export async function exportLeads(
  leads: Lead[],
  format: ExportFormat,
  filepath: string
): Promise<void> {
  if (!Array.isArray(leads) || leads.length === 0) {
    throw new Error('Cannot export: leads array must be non-empty.');
  }
  if (!filepath || typeof filepath !== 'string') {
    throw new Error('Cannot export: valid filepath string is required.');
  }

  const outputDir = dirname(filepath);
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (mkdirErr) {
    // Ignore if directory already exists
  }

  const normalized = leads.map((lead) => ({
    name: lead.name || '',
    website: lead.website || '',
    email: lead.email || '',
    phone: lead.phone || '',
    address: lead.address || '',
    rating: lead.rating?.toString() || '',
    reviewCount: lead.reviewCount?.toString() || '',
    relevanceScore: lead.relevanceScore?.toString() || '',
    budgetScore: lead.budgetScore?.toString() || '',
    scoringNotes: lead.scoringNotes || '',
    emailVerified: lead.emailVerified !== undefined ? String(lead.emailVerified) : '',
    scrapedAt: lead.scrapedAt || '',
  }));

  try {
    switch (format) {
      case 'csv':
      case 'hubspot':
      case 'salesforce': {
        let headers = [
          { id: 'name', title: 'Name' },
          { id: 'website', title: 'Website' },
          { id: 'email', title: 'Email' },
          { id: 'phone', title: 'Phone' },
          { id: 'address', title: 'Address' },
          { id: 'rating', title: 'Rating' },
          { id: 'reviewCount', title: 'Review Count' },
          { id: 'relevanceScore', title: 'Relevance' },
          { id: 'budgetScore', title: 'Budget Score' },
          { id: 'scoringNotes', title: 'Notes' },
        ];

        if (format === 'hubspot') {
          headers = [
            { id: 'name', title: 'Company name' },
            { id: 'website', title: 'Website' },
            { id: 'email', title: 'Email' },
            { id: 'phone', title: 'Phone number' },
            { id: 'address', title: 'Street address' },
          ];
        } else if (format === 'salesforce') {
          headers = [
            { id: 'name', title: 'Account Name' },
            { id: 'website', title: 'Website' },
            { id: 'email', title: 'Email' },
            { id: 'phone', title: 'Phone' },
            { id: 'address', title: 'Billing Street' },
          ];
        }

        const csvWriter = createObjectCsvWriter({
          path: filepath,
          header: headers,
        });
        await csvWriter.writeRecords(normalized);
        break;
      }

      case 'json':
        await fs.writeFile(filepath, JSON.stringify(leads, null, 2), 'utf8');
        break;

      case 'xlsx': {
        const worksheet = XLSX.utils.json_to_sheet(normalized);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
        XLSX.writeFile(workbook, filepath);
        break;
      }

      case 'html': {
        const html = generateHtmlReport(leads);
        await fs.writeFile(filepath, html, 'utf8');
        break;
      }

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
    console.log(`✅ Exported ${leads.length} leads to ${filepath}`);
  } catch (err: any) {
    throw new Error(`Export failed for ${filepath}: ${err.message}`);
  }
}

/**
 * Generates a self-contained HTML report with Tailwind CDN and embedded map links.
 */
function generateHtmlReport(leads: Lead[]): string {
  const rows = leads
    .map(
      (lead) => `
    <tr>
      <td class="px-6 py-4 whitespace-nowrap">${lead.name}</td>
      <td class="px-6 py-4"><a href="${lead.website}" target="_blank" class="text-blue-600 hover:underline">${lead.website || ''}</a></td>
      <td class="px-6 py-4">${lead.email || ''}</td>
      <td class="px-6 py-4">${lead.phone || ''}</td>
      <td class="px-6 py-4">${lead.address || ''}</td>
      <td class="px-6 py-4">${lead.rating ? lead.rating + '★' : ''}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>LeadMine Report</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-zinc-200">
  <div class="max-w-7xl mx-auto p-8">
    <div class="flex items-center gap-3 mb-8">
      <h1 class="text-4xl font-bold text-amber-300">LeadMine</h1>
      <span class="px-3 py-1 text-xs rounded-full bg-emerald-900 text-emerald-300">Export</span>
    </div>
    <p class="text-zinc-400 mb-6">Generated ${new Date().toLocaleString()} — ${leads.length} leads</p>
    <div class="overflow-x-auto rounded-2xl border border-zinc-800">
      <table class="w-full">
        <thead>
          <tr class="bg-zinc-900 border-b border-zinc-800">
            <th class="px-6 py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Name</th>
            <th class="px-6 py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Website</th>
            <th class="px-6 py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Email</th>
            <th class="px-6 py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Phone</th>
            <th class="px-6 py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Address</th>
            <th class="px-6 py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">Rating</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-800">
          ${rows}
        </tbody>
      </table>
    </div>
    <div class="mt-8 text-center text-xs text-zinc-500">
      Self-hosted • Polite • Transparent • Powered by LeadMine
    </div>
  </div>
</body>
</html>`;
}

/**
 * Writes leads directly to a Google Sheet using a service account.
 * Clears the target sheet first, then writes headers + data.
 */
export async function exportToSheets(
  leads: Lead[],
  spreadsheetId: string,
  options: GoogleSheetsOptions = {}
): Promise<void> {
  if (!leads.length) {
    throw new Error('Cannot export: leads array must be non-empty.');
  }
  if (!spreadsheetId) {
    throw new Error('spreadsheetId is required for Google Sheets export.');
  }

  const {
    sheetName = 'Leads',
    serviceAccountKeyPath = SERVICE_ACCOUNT_PATH,
  } = options;

  try {
    const keyContent = await fs.readFile(serviceAccountKeyPath, 'utf8');
    const credentials = JSON.parse(keyContent);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const headers = [
      'Name',
      'Website',
      'Email',
      'Phone',
      'Address',
      'Rating',
      'Reviews',
      'Relevance',
      'Budget',
      'Notes',
      'Email Verified',
      'Scraped At',
    ];

    const values = leads.map((lead) => [
      lead.name,
      lead.website || '',
      lead.email || '',
      lead.phone || '',
      lead.address || '',
      lead.rating || '',
      lead.reviewCount || '',
      lead.relevanceScore || '',
      lead.budgetScore || '',
      lead.scoringNotes || '',
      lead.emailVerified !== undefined ? String(lead.emailVerified) : '',
      lead.scrapedAt || '',
    ]);

    // Clear existing content
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: sheetName,
    });

    // Write headers + data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers, ...values],
      },
    });

    console.log(`✅ Exported ${leads.length} leads to Google Sheet "${sheetName}"`);
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.message?.includes('no such file')) {
      throw new Error(
        `Service account key not found at ${serviceAccountKeyPath}. ` +
          'See Google Sheets setup instructions in the README.'
      );
    }
    throw new Error(`Google Sheets export failed: ${err.message}`);
  }
}
