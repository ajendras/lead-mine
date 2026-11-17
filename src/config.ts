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
 * All fields from ScrapeOptions are supported (including verifyEmails).
 * CLI flags and explicit function arguments override values from the config file.
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
