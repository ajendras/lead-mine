import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import { ScrapeOptionsSchema } from './types.js';
import type { ScrapeOptions } from './types.js';

/**
 * Default path for the optional user configuration file.
 */
export const CONFIG_PATH = path.join(os.homedir(), '.leadmine', 'config.json');

/**
 * Loads and validates options from a JSON configuration file.
 *
 * If the file does not exist, returns an empty object (no defaults applied).
 * Validation errors are logged as warnings and result in an empty object.
 * All fields from ScrapeOptions are supported (including source, category,
 * location and verifyEmails). CLI flags and explicit function arguments
 * override values from the config file.
 */
export async function loadConfig(
  configPath: string = CONFIG_PATH
): Promise<Partial<ScrapeOptions>> {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);

    const PartialConfigSchema = ScrapeOptionsSchema.partial().passthrough();
    return PartialConfigSchema.parse(parsed) as Partial<ScrapeOptions>;
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      // File or directory missing – normal for first-time users
      return {};
    }

    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof z.ZodError || message.includes('JSON')) {
      console.warn(`⚠️  Invalid configuration in ${configPath}. Using defaults.`);
      if (err instanceof z.ZodError && err.errors.length > 0) {
        console.warn(`   • ${err.errors[0]!.message}`);
      }
      return {};
    }

    console.warn(
      `⚠️  Could not load config from ${configPath}: ${message}. Using defaults.`
    );
    return {};
  }
}

/**
 * Saves a partial configuration to the user config file.
 *
 * Creates the parent directory (~/.leadmine) if it does not exist.
 * Validates values against the ScrapeOptions schema (partial + passthrough)
 * before writing a clean JSON file. Used by the interactive wizard and
 * can be called programmatically.
 */
export async function saveConfig(
  config: Partial<ScrapeOptions>,
  configPath: string = CONFIG_PATH
): Promise<void> {
  try {
    const dir = path.dirname(configPath);
    await fs.mkdir(dir, { recursive: true });

    const PartialConfigSchema = ScrapeOptionsSchema.partial().passthrough();
    const validated = PartialConfigSchema.parse(config);

    await fs.writeFile(configPath, JSON.stringify(validated, null, 2), 'utf8');
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      throw new Error(`Invalid configuration values: ${err.errors[0]?.message}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to save configuration to ${configPath}: ${message}`);
  }
}
