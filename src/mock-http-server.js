/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const http          = require('http');
const https         = require('https');
const url           = require('url');
const fs            = require('fs');
let path          = require('path');
const crypto        = require('crypto');
const querystring   = require('querystring');
const recording     = require('../src/recording-proxy');
const playback      = require('../src/playback-server');

const FILEVERSION = 2;

exports.createRecordingProxyServer = function(options) {
  const recordingProxy = new recording.RecordingProxy(options);
  const handler = (req, res) => recordingProxy.proxyRequest(req, res);
  const server = (options.https ? https.createServer(options.https, handler) : http.createServer(handler));
  server.recordingProxy = recordingProxy;
  server.listen(options.port, options.bind);
  return server;
};

exports.createPlaybackServer = function(options) {
  const playbackServer = new playback.PlaybackServer(options);
  const handler = (req, res) => playbackServer.playbackRequest(req, res);
  const server = (options.https ? https.createServer(options.https, handler) : http.createServer(handler));
  server.playbackServer = playbackServer;
  server.listen(options.port, options.bind);
  return server;
};

exports._generateFixturesPath = function(fixtures) {
  fixtures = path.resolve(fixtures);
  if (!fs.existsSync(fixtures)) {
    console.error(`Fixtures path ${fixtures} does not exist`); 
    process.exit(1);
  }

  if (!fs.statSync(fixtures).isDirectory()) {
    console.error(`Fixtures path ${fixtures} must be a directory`); 
    process.exit(1);
  }

  return path.resolve(fixtures);
};

exports._generateResponseFilename = function(req, hash) {
  const requestPath = url.parse(req.url);
  ({ path } = requestPath);

  if (path.length > 100) {
    // Hash URL query parameters if the path is too long
    const searchHash = crypto.createHash('sha1');
    searchHash.update(requestPath.href);
    const sha1min = searchHash.digest('hex').slice(0, 6);
    const shortPathname = requestPath.pathname.slice(0, 10);
    path = `${shortPathname}-${sha1min}`;
  }

  let host = '';
  if (req.headers != null ? req.headers.host : undefined) {
    host = req.headers.host.split(':')[0];
  }

  // Dangerous characters stripped
  let filename = querystring.escape(`${req.method}-${path}-${host}`.replace(/[\/.:\\?&\[\]'"= ]+/g, '-'));
  
  // Append the hash of the body
  if (hash) {
    filename += '-';
    filename += hash;
  }
  filename += '.response';
  return { filename, FILEVERSION, path };
};

