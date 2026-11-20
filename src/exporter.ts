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
 * Node fs for JSON, and the xlsx library for Excel output.
 *
 * Columns are normalized and ordered consistently across formats.
 *
 * @param leads - Array of leads to export (must be non-empty)
 * @param format - Explicit format (csv | json | xlsx)
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
      default:
        throw new Error(`Unsupported export format "${format}". Must be csv, json or xlsx.`);
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
