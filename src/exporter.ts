import { createObjectCsvWriter } from 'csv-writer';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Lead, ExportFormat } from './types.js';

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
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');

  XLSX.writeFile(workbook, filepath);
}
