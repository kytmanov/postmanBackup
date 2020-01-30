/**
 * Author: Alexander Kytmanov
 */

const Client = require('node-rest-client').Client;
const fs = require('fs-extra');
const async = require('async');
const dateformat = require('dateformat');
const log4js = require('log4js');

const logger = log4js.getLogger('debug');

const config = require('./config.json');

const APIKEYS = config.api_keys; //Postman API key. (Allows multiple keys)
const PATHCOL = config.path.collections; //Postman collections folder
const PATHENV = config.path.environments; //Postman environments folder
const TIMEOUT = config.time_between_requests; //Delay between api requests(Postman limitaion - max 60 requests per minute).
const USEDATE = config.use_date_subfolder;
const USEID = config.use_id_subfolder;

const APIURL = config.api_url;

log4js.configure(config.debug);


function getData(url, key, callback) {
  let client = new Client();
  var args = {
    headers: {
      "X-Api-Key": key
    }
  };
  client.get(url, args, function(data, response) {
    if (response.statusCode !== 200) {
      logger.error(`${key} - ${response.statusCode} - ${response.statusMessage} - ${url}`)
    } else {
      if (callback) {
        callback(data, response)
      }
    }
  }).on('error', function(err) {
    logger.error('Request', err.request.options);
  });

  // handling client error events
  client.on('error', function(err) {
    logger.error('Client', err);
  });

}

function saveJson(path, key, filename, json, callback) {
  let fullpath = path;

  if (USEID) {
    fullpath = fullpath + '/' + key;
  }
  
  if (USEDATE) {
    let date = dateformat(new Date(), "mm-dd-yyyy")
    fullpath = fullpath + '/' + date;
  }

  fs.ensureDirSync(fullpath)

  let str = JSON.stringify(json);
  fs.writeFile(fullpath + '/' + filename, str, 'utf8', callback);
}


async.each(APIKEYS, function getAllUids(key) {
  let colUrl = APIURL + 'collections/'
  getData(colUrl, key, (collIdsJson) => {

    async.eachSeries(collIdsJson.collections, function getCollection(el, callback) {
      let urlC = colUrl + el.uid;
      let owner = el.owner;

      setTimeout(() => {
        getData(urlC, key, (colJson) => {
          let name = colJson.collection.info.name;
          let filename = owner + '-' + name + ".json";

          saveJson(PATHCOL, key, filename, colJson, () => {
            logger.info(`Collection: ${el.uid}: ${filename} - done`);
          })
        })
        callback();
      }, TIMEOUT);

    })

  })

  let envUrl = APIURL + 'environments/'
  getData(envUrl, key, (envIdsJson) => {

    async.eachSeries(envIdsJson.environments, function getEnviroments(el, callback) {
      let urlE = envUrl + el.uid;
      let owner = el.owner;

      setTimeout(() => {
        getData(urlE, key, (envJson) => {
          let name = envJson.environment.name;
          let filename = owner + '-' + name + ".json";

          saveJson(PATHENV, key, filename, envJson, () => {
            logger.info(`Enviroment: ${el.uid}: ${filename} - done`);
          })
        })
        callback();
      }, TIMEOUT);

    })

  })
})
