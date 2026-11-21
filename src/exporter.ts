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
 * Columns are normalized and ordered consistently across formats.
 *
 * @param leads - Array of leads to export (must be non-empty)
 * @param format - Explicit format (csv | json | xlsx | html)
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
    if ((mkdirErr as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new Error(`Failed to create output directory: ${(mkdirErr as Error).message}`);
    }
  }

  try {
    switch (format) {
      case 'csv':
        await exportToCsv(leads, filepath);
        break;
      case 'json':
        await exportToJson(leads, filepath);
        break;
      case 'xlsx':
        await exportToXlsx(leads, filepath);
        break;
      case 'html':
        await exportToHtml(leads, filepath);
        break;
      default:
        throw new Error(`Unsupported export format "${format}". Must be csv, json, xlsx or html.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Export to ${filepath} failed: ${message}`);
  }
}

async function exportToCsv(leads: Lead[], filepath: string): Promise<void> {
  const csvWriter = createObjectCsvWriter({
    path: filepath,
    header: [
      { id: 'name', title: 'Name' },
      { id: 'address', title: 'Address' },
      { id: 'phone', title: 'Phone' },
      { id: 'email', title: 'Email' },
      { id: 'website', title: 'Website' },
      { id: 'rating', title: 'Rating' },
      { id: 'reviewCount', title: 'Review Count' },
      { id: 'source', title: 'Source' },
      { id: 'category', title: 'Category' },
      { id: 'location', title: 'Location' },
      { id: 'scrapedAt', title: 'Scraped At' },
      { id: 'emailVerified', title: 'Email Verified' },
      { id: 'relevanceScore', title: 'Relevance Score' },
      { id: 'budgetScore', title: 'Budget Score' },
      { id: 'scoringNotes', title: 'Scoring Notes' },
    ],
    alwaysQuote: true,
    encoding: 'utf8',
  });

  await csvWriter.writeRecords(leads);
}

async function exportToJson(leads: Lead[], filepath: string): Promise<void> {
  const payload = JSON.stringify(leads, null, 2);
  await fs.writeFile(filepath, payload, 'utf8');
}

async function exportToXlsx(leads: Lead[], filepath: string): Promise<void> {
  const rows = leads.map((lead) => ({
    Name: lead.name,
    Address: lead.address ?? '',
    Phone: lead.phone ?? '',
    Email: lead.email ?? '',
    Website: lead.website ?? '',
    Rating: lead.rating ?? '',
    'Review Count': lead.reviewCount ?? '',
    Source: lead.source,
    Category: lead.category ?? '',
    Location: lead.location ?? '',
    'Scraped At': lead.scrapedAt,
    'Email Verified': lead.emailVerified !== undefined ? String(lead.emailVerified) : '',
    'Relevance Score': lead.relevanceScore ?? '',
    'Budget Score': lead.budgetScore ?? '',
    'Scoring Notes': lead.scoringNotes ?? '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');

  XLSX.writeFile(workbook, filepath);
}

/**
 * Generates a beautiful, self-contained HTML report with Tailwind CSS,
 * interactive search/filter controls, summary statistics, and embedded
 * Google Maps previews for every lead. The report is a single file with
 * no external dependencies beyond public CDNs. Includes a one-click
 * "Export CSV" button that runs entirely in the browser.
 */
async function exportToHtml(leads: Lead[], filepath: string): Promise<void> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LeadMine Report — ${leads.length} Leads</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Space+Grotesk:wght@500;600&amp;display=swap');
      :root { --primary: 63 42 30; }
      .map-iframe {
        border-radius: 12px;
        box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      }
      .lead-card {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .lead-card:hover {
        transform: translateY(-8px);
        box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
      }
      .stat-card {
        background: linear-gradient(135deg, #3f2a1e, #d9c2a3);
      }
      .active-filter {
        background-color: #d9c2a3 !important;
        color: #3f2a1e !important;
      }
    </style>
</head>
<body class="bg-zinc-950 text-zinc-200 font-sans">
  <div class="max-w-screen-2xl mx-auto">
    <div class="bg-[#3f2a1e] border-b border-[#d9c2a3]/20">
      <div class="px-8 py-6 flex items-center justify-between">
        <div class="flex items-center gap-x-3">
          <div class="w-9 h-9 bg-[#d9c2a3] rounded-2xl flex items-center justify-center text-[#3f2a1e] text-2xl font-bold">L</div>
          <div>
            <h1 class="text-3xl font-semibold tracking-tighter text-white">LeadMine</h1>
            <p class="text-[#d9c2a3] text-sm -mt-1">Business Intelligence Report</p>
          </div>
        </div>
        <div class="flex items-center gap-x-8 text-sm">
          <div class="flex items-center gap-x-8">
            <div>
              <span class="text-[#d9c2a3]">Generated:</span> 
              <span class="font-mono">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
            <div class="h-5 w-px bg-white/20"></div>
            <div onclick="exportToCSV()" class="flex items-center gap-x-2 px-5 py-2.5 bg-white text-[#3f2a1e] hover:bg-amber-100 rounded-3xl font-medium cursor-pointer transition-colors">
              <i class="fa-solid fa-download"></i>
              <span>Export CSV</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="p-8">
      <div class="flex justify-between items-end mb-8">
        <div>
          <h2 class="text-5xl font-semibold tracking-tighter text-white">${leads.length} Targeted Leads</h2>
          <p class="text-zinc-400 mt-2">High-quality prospects • Embedded map previews • Self-hosted &amp; transparent</p>
        </div>
        <div class="flex gap-3 text-sm" id="source-filters">
          <div onclick="filterBySource('all')" id="filter-all" class="active-filter px-6 py-2 rounded-3xl font-medium cursor-pointer">All</div>
          ${Array.from(new Set(leads.map(l => l.source))).map(src => `
            <div onclick="filterBySource('${src}')" id="filter-${src}" class="px-6 py-2 rounded-3xl font-medium cursor-pointer hover:bg-white/10">${src}</div>
          `).join('')}
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <div class="stat-card p-6 rounded-3xl text-white">
          <div class="text-[#d9c2a3] text-sm font-medium tracking-widest">TOTAL LEADS</div>
          <div class="text-5xl font-semibold mt-1">${leads.length}</div>
        </div>
        <div class="bg-zinc-900 p-6 rounded-3xl">
          <div class="text-emerald-400 text-sm font-medium tracking-widest">WITH EMAIL</div>
          <div class="text-5xl font-semibold mt-1">${leads.filter(l => !!l.email).length}</div>
        </div>
        <div class="bg-zinc-900 p-6 rounded-3xl">
          <div class="text-amber-400 text-sm font-medium tracking-widest">AVG RATING</div>
          <div class="text-5xl font-semibold mt-1">
            ${leads.filter(l => typeof l.rating === 'number').length > 0 
              ? (leads.reduce((sum, l) => sum + (l.rating || 0), 0) / leads.filter(l => typeof l.rating === 'number').length).toFixed(1) 
              : '—'}
          </div>
        </div>
        <div class="bg-zinc-900 p-6 rounded-3xl">
          <div class="text-sky-400 text-sm font-medium tracking-widest">SOURCES</div>
          <div class="text-5xl font-semibold mt-1">${new Set(leads.map(l => l.source)).size}</div>
        </div>
      </div>

      <div class="relative mb-8">
        <input 
          id="searchInput" 
          onkeyup="if(event.key==='Enter'||event.key===' ')filterLeads()" 
          type="text" 
          placeholder="Search by name, address, category..." 
          class="w-full bg-zinc-900 border border-zinc-700 focus:border-[#d9c2a3] rounded-3xl px-6 py-4 text-lg placeholder:text-zinc-500 outline-none">
        <div class="absolute right-6 top-1/2 -translate-y-1/2 text-zinc-500">
          <i class="fa-solid fa-magnifying-glass"></i>
        </div>
      </div>

      <div id="leadsContainer" class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        ${leads.map(lead => `
          <div class="lead-card bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden" 
               data-source="${lead.source}" 
               data-name="${(lead.name || '').toLowerCase()}">
            <div class="h-2 bg-gradient-to-r from-[#3f2a1e] via-[#d9c2a3] to-[#3f2a1e]"></div>
            <div class="p-6">
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-semibold text-2xl text-white">${lead.name}</div>
                  ${lead.address ? `<p class="text-zinc-400 text-sm mt-1 line-clamp-2">${lead.address}</p>` : ''}
                </div>
                ${lead.rating ? `
                <div class="flex items-center gap-x-1 bg-zinc-800 text-amber-400 text-sm font-medium px-3 py-1 rounded-2xl">
                  <i class="fa-solid fa-star text-xs"></i>
                  <span>${lead.rating}</span>
                </div>` : ''}
              </div>

              <div class="flex flex-wrap gap-x-5 gap-y-2 mt-6 text-sm">
                ${lead.phone ? `
                <a href="tel:${lead.phone}" class="flex items-center gap-x-2 text-emerald-300 hover:text-emerald-200 transition-colors">
                  <i class="fa-solid fa-phone w-4"></i>
                  <span class="font-mono">${lead.phone}</span>
                </a>` : ''}
                ${lead.email ? `
                <a href="mailto:${lead.email}" class="flex items-center gap-x-2 text-sky-300 hover:text-sky-200 transition-colors">
                  <i class="fa-solid fa-envelope w-4"></i>
                  <span>${lead.email}</span>
                </a>` : ''}
              </div>

              ${lead.website ? `
              <a href="${lead.website}" target="_blank" rel="noopener" 
                 class="mt-5 inline-flex items-center gap-x-2 text-[#d9c2a3] hover:underline text-sm">
                <i class="fa-solid fa-globe"></i>
                <span class="truncate max-w-[260px]">${lead.website.replace(/^https?:\/\//i, '')}</span>
              </a>` : ''}

              ${typeof lead.relevanceScore === 'number' ? `
              <div class="mt-6 pt-5 border-t border-zinc-700 flex gap-3 text-xs">
                <div class="px-4 py-2 bg-emerald-950 text-emerald-400 rounded-3xl">Relevance ${lead.relevanceScore}/10</div>
                ${typeof lead.budgetScore === 'number' ? `<div class="px-4 py-2 bg-amber-950 text-amber-400 rounded-3xl">Budget ${lead.budgetScore}/10</div>` : ''}
              </div>` : ''}

              <div class="mt-8">
                <div class="flex items-center gap-x-2 text-xs uppercase tracking-widest text-zinc-400 mb-3">
                  <i class="fa-solid fa-map-location-dot"></i>
                  <span>Map Preview</span>
                </div>
                <iframe 
                  width="100%" 
                  height="210" 
                  class="map-iframe bg-white"
                  loading="lazy"
                  allowfullscreen
                  src="https://www.google.com/maps?q=${encodeURIComponent(`${lead.name} ${lead.address || lead.location || ''}`)}&amp;output=embed">
                </iframe>
              </div>
            </div>

            <div class="px-6 py-4 bg-black/30 flex items-center justify-between text-[10px] font-mono border-t border-zinc-800 text-zinc-400">
              <div class="flex items-center gap-x-3">
                <span class="px-3 py-0.5 bg-white/10 rounded-3xl">${lead.source}</span>
                ${lead.category ? `<span class="text-zinc-500">${lead.category}</span>` : ''}
              </div>
              <div>${lead.scrapedAt ? new Date(lead.scrapedAt).toLocaleDateString() : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <footer class="bg-zinc-900 border-t border-zinc-800 p-8 text-center text-xs text-zinc-500">
      Generated by <span class="text-[#d9c2a3]">LeadMine</span> • Self-hosted, transparent, polite scraping<br>
      <span class="text-[10px] mt-3 inline-block">Open source on GitHub • Built with ❤️ for sales teams</span>
    </footer>
  </div>

  <script>
    function initializeTailwind() {
      tailwind.config = {
        content: [],
        theme: { extend: { fontFamily: { sans: ['Inter', 'system_ui'] } } }
      };
    }

    function filterLeads() {
      const term = (document.getElementById('searchInput') as HTMLInputElement).value.toLowerCase().trim();
      const cards = document.querySelectorAll('.lead-card');
      cards.forEach(card => {
        const name = card.getAttribute('data-name') || '';
        const visible = !term || name.includes(term);
        (card as HTMLElement).style.display = visible ? 'block' : 'none';
      });
    }

    function filterBySource(source) {
      document.querySelectorAll('#source-filters > div').forEach(el => {
        el.classList.remove('active-filter');
        if (el.id === 'filter-all' && source === 'all') el.classList.add('active-filter');
        if (el.id === 'filter-' + source) el.classList.add('active-filter');
      });

      const cards = document.querySelectorAll('.lead-card');
      cards.forEach(card => {
        if (source === 'all') {
          (card as HTMLElement).style.display = 'block';
        } else {
          const cardSource = card.getAttribute('data-source');
          (card as HTMLElement).style.display = (cardSource === source) ? 'block' : 'none';
        }
      });
    }

    function exportToCSV() {
      const leads = ${JSON.stringify(leads.map(lead => ({
        Name: lead.name,
        Address: lead.address || '',
        Phone: lead.phone || '',
        Email: lead.email || '',
        Website: lead.website || '',
        Rating: lead.rating || '',
        Source: lead.source,
        Category: lead.category || '',
        Location: lead.location || ''
      })))};
      let csvContent = "data:text/csv;charset=utf-8," 
        + "Name,Address,Phone,Email,Website,Rating,Source,Category,Location\\n"
        + leads.map(row => Object.values(row).map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "leadmine-report.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    window.onload = function() {
      initializeTailwind();
      const allFilter = document.getElementById('filter-all');
      if (allFilter) allFilter.classList.add('active-filter');
    };
  </script>
</body>
</html>`;

  await fs.writeFile(filepath, html, 'utf8');
  console.log(`✅ Generated interactive HTML report (${leads.length} leads) with embedded map previews at ${filepath}`);
}

/**
 * Exports leads directly to a Google Sheet using a service account.
 *
 * The service-account.json must be present (default: ~/.leadmine/service-account.json).
 * The client_email inside that file must be granted Editor access on the target spreadsheet.
 *
 * Overwrites the target sheet starting at A1 with a header row + all leads.
 * Creates the named sheet if it does not already exist.
 */
export async function exportToSheets(
  leads: Lead[],
  spreadsheetId: string,
  options: Omit<GoogleSheetsOptions, 'spreadsheetId'> = {}
): Promise<void> {
  if (!Array.isArray(leads) || leads.length === 0) {
    throw new Error('Cannot export: leads array must be non-empty.');
  }
  if (!spreadsheetId || typeof spreadsheetId !== 'string' || spreadsheetId.length < 10) {
    throw new Error('Valid spreadsheetId is required for Google Sheets export.');
  }

  const sheetName = options.sheetName || 'Leads';
  const keyPath = options.serviceAccountKeyPath || SERVICE_ACCOUNT_PATH;

  try {
    await fs.access(keyPath);
  } catch {
    throw new Error(
      `Service account JSON key not found at ${keyPath}.\n` +
        `Please place your service-account.json (downloaded from Google Cloud Console) ` +
        `in ~/.leadmine/ or supply serviceAccountKeyPath. The client_email from the JSON ` +
        `must be shared on the spreadsheet with Editor permissions.`
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const headerRow = [
    'Name',
    'Address',
    'Phone',
    'Email',
    'Website',
    'Rating',
    'Review Count',
    'Source',
    'Category',
    'Location',
    'Scraped At',
    'Email Verified',
    'Relevance Score',
    'Budget Score',
    'Scoring Notes',
  ];

  const dataRows = leads.map((lead) => [
    lead.name,
    lead.address || '',
    lead.phone || '',
    lead.email || '',
    lead.website || '',
    lead.rating?.toString() || '',
    lead.reviewCount?.toString() || '',
    lead.source,
    lead.category || '',
    lead.location || '',
    lead.scrapedAt || '',
    lead.emailVerified !== undefined ? String(lead.emailVerified) : '',
    lead.relevanceScore !== undefined ? lead.relevanceScore.toString() : '',
    lead.budgetScore !== undefined ? lead.budgetScore.toString() : '',
    lead.scoringNotes || '',
  ]);

  try {
    // Create sheet if it does not exist (ignore error if it already does)
    await sheets.spreadsheets
      .batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      })
      .catch(() => {});

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headerRow, ...dataRows],
      },
    });

    console.log(`✅ Exported ${leads.length} leads to Google Sheet "${sheetName}" (spreadsheet ${spreadsheetId})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Google Sheets export failed: ${message}. ` +
        `Verify the service account has Editor access on the spreadsheet.`
    );
  }
}
