
/**
 * Author: Alexander Kytmanov
 * Modernized by Allan + Copilot (axios & async/await)
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dateformat = require('dateformat');
const log4js = require('log4js');

const logger = log4js.getLogger('debug');
const config = require('./config.json');

const APIKEYS = Array.isArray(config.api_keys) ? config.api_keys : []; // array of Postman API keys
const PATHCOL = config.path?.collections || 'files/collections';       // base folder for collections
const PATHENV = config.path?.environments || 'files/environments';     // base folder for environments
const TIMEOUT = Number(config.time_between_requests ?? 1000);          // ms delay between API requests
const USEDATE = !!config.use_date_subfolder;                           // boolean
const USEID   = !!config.use_id_subfolder;                             // boolean
const APIURL  = String(config.api_url || 'https://api.getpostman.com/').replace(/\/+$/, '/') // ensure trailing slash

log4js.configure(config.debug || {});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create an axios client for a given API key.
 */
function createClient(key) {
  const client = axios.create({
    baseURL: APIURL,                // e.g., https://api.getpostman.com/
    headers: { 'X-Api-Key': key },
    timeout: 30_000,
  });

  // Optional: basic retry for rate limit / transient errors
  client.interceptors.response.use(
    (resp) => resp,
    async (error) => {
      const status = error?.response?.status;
      const url = error?.config?.url;
      const method = (error?.config?.method || 'GET').toUpperCase();

      // Simple backoff for 429 or 5xx (up to 3 retries)
      const cfg = error.config || {};
      cfg.__retryCount = (cfg.__retryCount || 0) + 1;

      const isRetryable = status === 429 || (status >= 500 && status <= 599);
      if (isRetryable && cfg.__retryCount <= 3) {
        const backoffMs = Math.min(10_000, 1_000 * cfg.__retryCount); // 1s, 2s, 3s (capped)
        logger.warn(`Retry ${cfg.__retryCount} for ${method} ${url} after ${backoffMs}ms (status ${status})`);
        await sleep(backoffMs);
        return client(cfg); // retry the original request using this client
      }

      // Log and rethrow
      const msg = status
        ? `HTTP ${status} on ${method} ${url}`
        : `Network error on ${method} ${url || '(unknown url)'}`;
      logger.error(msg, error.message);
      throw error;
    }
  );

  return client;
}

/**
 * GET helper (returns JSON body or throws on error).
 */
async function getJson(client, endpoint) {
  const { data } = await client.get(endpoint);
  return data;
}

/**
 * Build destination directory path, respecting USEID/USEDATE.
 */
function buildTargetDir(basePath, key) {
  let full = basePath;

  if (USEID) {
    full = path.join(full, key);
  }

  if (USEDATE) {
    const dateStr = dateformat(new Date(), 'mm-dd-yyyy'); // keep MM-DD-YYYY layout
    full = path.join(full, dateStr);
  }

  return full;
}

/**
 * Sanitize filenames: remove path separators and trim.
 */
function safeFilename(name) {
  return (name || '')
    .toString()
    .replace(/[\/\\:"*?<>|]+/g, '-')    // replace illegal chars with dash
    .replace(/\s+/g, ' ')               // collapse whitespace
    .trim();
}

/**
 * Save JSON object to disk.
 */
async function saveJson(basePath, key, filename, json) {
  const fullDir = buildTargetDir(basePath, key);
  await fs.ensureDir(fullDir);
  const filePath = path.join(fullDir, filename);
  const content = JSON.stringify(json);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

/**
 * Process a single API key: fetch collections and environments and save them.
 */
async function processKey(key) {
  const client = createClient(key);

  // --- Collections ---
  try {
    const colList = await getJson(client, 'collections/');
    const items = Array.isArray(colList?.collections) ? colList.collections : [];
    logger.info(`Key ${key}: ${items.length} collections found.`);

    for (const el of items) {
      const uid = el.uid;
      const owner = safeFilename(el.owner);

      await sleep(TIMEOUT); // respect rate limit

      try {
        const colJson = await getJson(client, `collections/${uid}`);
        const name = safeFilename(colJson?.collection?.info?.name || `collection-${uid}`);
        const filename = `${owner}-${name}.json`;
        const pathSaved = await saveJson(PATHCOL, key, filename, colJson);
        logger.info(`Collection: ${uid}: ${filename} → ${pathSaved}`);
      } catch (err) {
        logger.error(`Failed to fetch/save collection ${uid}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`Failed to list collections for key ${key}: ${err.message}`);
  }

  // --- Environments ---
  try {
    const envList = await getJson(client, 'environments/');
    const envs = Array.isArray(envList?.environments) ? envList.environments : [];
    logger.info(`Key ${key}: ${envs.length} environments found.`);

    for (const el of envs) {
      const uid = el.uid;
      const owner = safeFilename(el.owner);

      await sleep(TIMEOUT);

      try {
        const envJson = await getJson(client, `environments/${uid}`);
        const name = safeFilename(envJson?.environment?.name || `environment-${uid}`);
        const filename = `${owner}-${name}.json`;
        const pathSaved = await saveJson(PATHENV, key, filename, envJson);
        logger.info(`Environment: ${uid}: ${filename} → ${pathSaved}`);
      } catch (err) {
        logger.error(`Failed to fetch/save environment ${uid}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`Failed to list environments for key ${key}: ${err.message}`);
  }
}

/**
 * Main: iterate all API keys in series (simpler rate limits).
 */
(async () => {
  try {
    if (APIKEYS.length === 0) {
      logger.warn('No API keys found in config.api_keys. Nothing to do.');
      return;
    }

    for (const key of APIKEYS) {
      await processKey(key);
    }
    logger.info('Backup completed.');
  } catch (err) {
    logger.error('Unexpected error in backup run:', err.message);
    process.exit(1);
  }
})();
