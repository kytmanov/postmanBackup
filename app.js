
/**
 * Author: Alexander Kytmanov
 * Modernized by Allan + Copilot (axios & async/await, concurrent)
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const async = require('async');               // <— add async back for mapLimit
const dateformat = require('dateformat');
const log4js = require('log4js');

const logger = log4js.getLogger('debug');
const config = require('./config.json');

const APIKEYS = Array.isArray(config.api_keys) ? config.api_keys : [];
const PATHCOL = config.path?.collections || 'files/collections';
const PATHENV = config.path?.environments || 'files/environments';
const TIMEOUT = Number(config.time_between_requests ?? 1000); // legacy pacing (optional)
const USEDATE = !!config.use_date_subfolder;
const USEID   = !!config.use_id_subfolder;
const APIURL  = String(config.api_url || 'https://api.getpostman.com/').replace(/\/+$/, '/');

const CONCURRENCY = Number(process.env.CONCURRENCY || 5);    // tuneable
const STAGGER_MS  = Number(process.env.STAGGER_MS  || 200);  // spacing between launches
const RETRY_5XX   = String(process.env.RETRY_5XX || 'true') === 'true';

log4js.configure(config.debug || {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createClient(key) {
  const client = axios.create({
    baseURL: APIURL,
    headers: { 'X-Api-Key': key },
    timeout: 30_000,
  });

  client.interceptors.response.use(
    (resp) => resp,
    async (error) => {
      const status = error?.response?.status;
      const url = error?.config?.url;
      const method = (error?.config?.method || 'GET').toUpperCase();

      const cfg = error.config || {};
      cfg.__retryCount = (cfg.__retryCount || 0) + 1;

      const is429 = status === 429;
      const is5xx = status >= 500 && status <= 599;

      // Only retry 429 always; retry 5xx optionally
      if ((is429 || (RETRY_5XX && is5xx)) && cfg.__retryCount <= 3) {
        const backoffMs = Math.min(6_000, 1_000 * cfg.__retryCount); // 1s, 2s, 3s
        logger.warn(`Retry ${cfg.__retryCount} for ${method} ${url} after ${backoffMs}ms (status ${status})`);
        await sleep(backoffMs);
        return client(cfg);
      }

      logger.error(
        status
          ? `HTTP ${status} on ${method} ${url} (retries: ${cfg.__retryCount - 1 || 0})`
          : `Network error on ${method} ${url || '(unknown url)'}`
      );
      throw error;
    }
  );

  return client;
}

async function getJson(client, endpoint) {
  const { data } = await client.get(endpoint);
  return data;
}

function buildTargetDir(basePath, key) {
  let full = basePath;
  if (USEID) full = path.join(full, key);
  if (USEDATE) full = path.join(full, dateformat(new Date(), 'mm-dd-yyyy'));
  return full;
}

function safeFilename(name) {
  return (name || '')
    .toString()
    .replace(/[\/\\:"*?<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

async function saveJson(basePath, key, filename, json) {
  const fullDir = buildTargetDir(basePath, key);
  await fs.ensureDir(fullDir);
  const filePath = path.join(fullDir, filename);
  await fs.writeFile(filePath, JSON.stringify(json), 'utf8');
  return filePath;
}

async function fetchCollections(client) {
  const list = await getJson(client, 'collections/');
  return Array.isArray(list?.collections) ? list.collections : [];
}

async function fetchEnvironments(client) {
  const list = await getJson(client, 'environments/');
  return Array.isArray(list?.environments) ? list.environments : [];
}

/**
 * Run tasks with limited concurrency and small stagger to smooth bursts.
 * tasks: array of functions () => Promise<void>
 */
async function runWithLimit(tasks, limit, staggerMs) {
  let i = 0;
  // Wrap each task to add stagger on launch
  const wrapped = tasks.map((fn) => async () => {
    // stagger based on index to avoid burst at t=0
    const startDelay = staggerMs > 0 ? staggerMs * (i++) : 0;
    if (startDelay > 0) await sleep(startDelay);
    return fn();
  });

  await new Promise((resolve, reject) => {
    async.mapLimit(
      wrapped,
      limit,
      async (task) => {
        // Optionally retain the legacy TIMEOUT pacing inside the task
        // await sleep(TIMEOUT); // uncomment only if needed; otherwise rely on stagger
        return task();
      },
      (err /*, results */) => (err ? reject(err) : resolve())
    );
  });
}

async function processKey(key) {
  const client = createClient(key);

  // Collections
  try {
    const items = await fetchCollections(client);
    logger.info(`Key ${key}: ${items.length} collections found.`);

    const colTasks = items.map((el) => async () => {
      const uid = el.uid;
      const owner = safeFilename(el.owner);
      try {
        const colJson = await getJson(client, `collections/${uid}`);
        const name = safeFilename(colJson?.collection?.info?.name || `collection-${uid}`);
        const filename = `${owner}-${name}.json`;
        const saved = await saveJson(PATHCOL, key, filename, colJson);
        logger.info(`Collection: ${uid}: ${filename} → ${saved}`);
      } catch (err) {
        logger.error(`Failed collection ${uid}: ${err.message}`);
      }
    });

    await runWithLimit(colTasks, CONCURRENCY, STAGGER_MS);
  } catch (err) {
    logger.error(`Failed to list collections for key ${key}: ${err.message}`);
  }

  // Environments
  try {
    const envs = await fetchEnvironments(client);
    logger.info(`Key ${key}: ${envs.length} environments found.`);

    const envTasks = envs.map((el) => async () => {
      const uid = el.uid;
      const owner = safeFilename(el.owner);
      try {
        const envJson = await getJson(client, `environments/${uid}`);
        const name = safeFilename(envJson?.environment?.name || `environment-${uid}`);
        const filename = `${owner}-${name}.json`;
        const saved = await saveJson(PATHENV, key, filename, envJson);
        logger.info(`Environment: ${uid}: ${filename} → ${saved}`);
      } catch (err) {
        logger.error(`Failed environment ${uid}: ${err.message}`);
      }
    });

    await runWithLimit(envTasks, CONCURRENCY, STAGGER_MS);
  } catch (err) {
    logger.error(`Failed to list environments for key ${key}: ${err.message}`);
  }
}

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
