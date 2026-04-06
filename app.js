/**
 * postmanBackup - Backup Postman collections and environments
 * Author: Alexander Kytmanov
 */

const fs = require('fs-extra');
const path = require('node:path');
const config = require('./config.json');

// Config extraction
const APIKEYS = config.api_keys;
const PATHCOL = config.path.collections;
const PATHENV = config.path.environments;
const TIMEOUT = config.time_between_requests;
const USEDATE = config.use_date_subfolder;
const USEID = config.use_id_subfolder;
const APIURL = config.api_url;

// Inline logger
const log = {
  info: (...args) => console.log('[INFO]', new Date().toISOString(), ...args),
  error: (...args) => console.error('[ERROR]', new Date().toISOString(), ...args),
};

/**
 * Validate config.json structure
 */
function validateConfig(cfg) {
  const errors = [];

  if (!Array.isArray(cfg.api_keys) || cfg.api_keys.length === 0) {
    errors.push('api_keys must be a non-empty array');
  } else if (!cfg.api_keys.every((k) => typeof k === 'string' && k.length > 0)) {
    errors.push('all api_keys must be non-empty strings');
  }

  if (typeof cfg.api_url !== 'string' || !cfg.api_url.startsWith('https://')) {
    errors.push('api_url must be a string starting with https://');
  }

  if (!cfg.path || typeof cfg.path.collections !== 'string' || cfg.path.collections.length === 0) {
    errors.push('path.collections must be a non-empty string');
  }

  if (!cfg.path || typeof cfg.path.environments !== 'string' || cfg.path.environments.length === 0) {
    errors.push('path.environments must be a non-empty string');
  }

  if (typeof cfg.time_between_requests !== 'number' || cfg.time_between_requests <= 0) {
    errors.push('time_between_requests must be a positive number');
  }

  if (typeof cfg.use_date_subfolder !== 'boolean') {
    errors.push('use_date_subfolder must be a boolean');
  }

  if (typeof cfg.use_id_subfolder !== 'boolean') {
    errors.push('use_id_subfolder must be a boolean');
  }

  if (errors.length > 0) {
    throw new Error('Invalid configuration:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  }
}

/**
 * Fetch data from Postman API
 */
async function getData(url, apiKey) {
  const response = await fetch(url, {
    headers: { 'X-Api-Key': apiKey },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build output directory path with optional date/ID subfolders
 */
function buildOutputPath(basePath, apiKey) {
  let dir = basePath;
  if (USEID) dir = path.join(dir, apiKey);
  if (USEDATE) {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    dir = path.join(dir, date);
  }
  return dir;
}

/**
 * Sanitize a string for use as a filename — replaces path-unsafe characters
 */
function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim();
}

/**
 * Save JSON data to file
 */
async function saveJson(basePath, apiKey, filename, data) {
  const dir = buildOutputPath(basePath, apiKey);
  await fs.ensureDir(dir);
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2), 'utf8');
  return fullPath;
}

/**
 * Backup all collections for a given API key
 */
async function backupCollections(apiKey) {
  const list = await getData(`${APIURL}collections/`, apiKey);

  if (!Array.isArray(list.collections)) {
    throw new Error(`Unexpected collections response: missing 'collections' array`);
  }

  for (const col of list.collections) {
    await sleep(TIMEOUT);
    const detail = await getData(`${APIURL}collections/${col.uid}`, apiKey);
    const name = sanitizeFilename(detail.collection.info.name);
    const filename = `${col.owner}-${name}.json`;
    const savedPath = await saveJson(PATHCOL, apiKey, filename, detail);
    log.info(`Collection ${col.uid}: saved to ${savedPath}`);
  }
}

/**
 * Backup all environments for a given API key
 */
async function backupEnvironments(apiKey) {
  const list = await getData(`${APIURL}environments/`, apiKey);

  if (!Array.isArray(list.environments)) {
    throw new Error(`Unexpected environments response: missing 'environments' array`);
  }

  for (const env of list.environments) {
    await sleep(TIMEOUT);
    const detail = await getData(`${APIURL}environments/${env.uid}`, apiKey);
    const name = sanitizeFilename(detail.environment.name);
    const filename = `${env.owner}-${name}.json`;
    const savedPath = await saveJson(PATHENV, apiKey, filename, detail);
    log.info(`Environment ${env.uid}: saved to ${savedPath}`);
  }
}

if (require.main === module) {
  /**
   * Main entry point — only runs when executed directly (node app.js)
   */
  (async () => {
    try {
      validateConfig(config);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }

    for (const apiKey of APIKEYS) {
      log.info(`Starting backup for key: ${apiKey.slice(0, 8)}...`);
      try {
        await backupCollections(apiKey);
        await backupEnvironments(apiKey);
        log.info(`Backup completed successfully for key: ${apiKey.slice(0, 8)}...`);
      } catch (err) {
        log.error(`Backup failed for key ${apiKey.slice(0, 8)}...: ${err.message}`);
        process.exitCode = 1;
      }
    }

    if (process.exitCode === 1) {
      log.error('Backup completed with errors. Check output above.');
    }
  })();
} else {
  // Export for testing (when require'd)
  module.exports = { validateConfig, buildOutputPath, getData };
}
