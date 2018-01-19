/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// **recording-proxy.coffee**
// Proxy request to the target server and store responses in a file
// specific to the request.
// 

let RecordingProxy;
const fs          = require('fs');
let path        = require('path');
const crypto      = require('crypto');
const url         = require('url');
const querystring = require('querystring');
const request     = require('request');
const mock        = require('../src/mock-http-server');
const http        = require('http');

http.globalAgent.maxSockets = 1;

const RETRY_TIMEOUT     = 30000; // Time in seconds before responding to original request
const RETRY_MAX_BACKOFF = 3000;  // Max time in seconds to randomize request retry

exports.RecordingProxy = (RecordingProxy = class RecordingProxy {
  constructor(options) {
    if (options == null) { options = {}; }
    this.options = options;
    this.target = options.target;
    this.retryTimeout = this.options.retryTimeout || RETRY_TIMEOUT;
    this.retryMaxBackoff = this.options.retryMaxBackoff || RETRY_MAX_BACKOFF;

    // Set up directory
    this.fixturesPath = mock._generateFixturesPath(options.fixtures);
    if (!fs.existsSync(this.fixturesPath)) { fs.mkdirSync(this.fixturesPath); }
  }

  // Called once for each request to the HTTP server.
  proxyRequest(req, res) {
    const self = this;

    const sendTargetRequest = function() {
      const filepath = `${self.fixturesPath}/${req.filename}`;

      const logErrorToConsole = function(error) {
        if (!self.options.quietMode) {
          console.error(`Error with request ${req.method} ${req.url} to ${filepath}`);
          console.error(error);
        }
        res.writeHead(500, {"Content-Type": "text/plain"});
        res.write(error.toString());
        return res.end();
      };

      const isLocalHost = host => (host != null) && (host.match(/localhost/) || host.match('127.0.0.1') || host.match('::1'));

      const validateTarget = function() {
        let target = null;
        if (self.target) {
          ({ target } = self);
        } else if ((req.headers != null ? req.headers.host : undefined)) {
          if (isLocalHost(req.headers.host)) {
            logErrorToConsole("localhost used without --record=target");
          } else {
            target = req.headers.host;
          }
        } else {
          logErrorToConsole("no host in request");
        }

        if (target && !target.match(/^http/i)) {
          target = `http://${target}`;
        }
        return target;
      };


      const target = validateTarget(req);
      if (!target) { return; }

      const validateRequestPath = function() {
        const requestPath = url.parse(req.url);
        ({ path } = requestPath);
        if (requestPath.hash) { path += requestPath.hash; }
        return path;
      };

      const outgoing = {
        uri: `${target}${validateRequestPath(req.url)}`,
        method: req.method,
        headers: req.headers,
        body: req.body,
        encoding: null,
        jar: false,
        firstSentAt: (new Date()).getTime()
      };

      if (isLocalHost(outgoing.headers != null ? outgoing.headers.host : undefined)) { delete outgoing.headers.host; }
      delete outgoing.headers['Connection'];
      delete outgoing.headers['connection'];

      // Issue request to target
      var sendOutgoingRequest = function() {
        outgoing.sentAt = (new Date()).getTime();
        return request(outgoing, function(error, response, body) {
          if (error) {
            const resendOutgoingRequest = function() {
              const timeNow = (new Date()).getTime();
              const randomDelay = Math.random() * self.retryMaxBackoff;
              const retryTime = (timeNow - outgoing.firstSentAt) + randomDelay;
              const timedOut = retryTime > self.retryTimeout;
              if (timedOut) { return false; }
              setTimeout(sendOutgoingRequest, randomDelay);
              return true;
            };

            if (((error.code === 'ECONNRESET') || (error.code === 'HPE_INVALID_CONSTANT')) && resendOutgoingRequest()) {
              return; // the request will be reissued after a delay
            } else {
              if (!self.options.quietMode) {
                console.error("HTTP Error");
                console.error(outgoing);
                console.error("response");
                console.error(response);
                console.error("body");
                console.error(body);
              }
              return logErrorToConsole(error);
            }
          }

          // Remove HTTP 1.1 headers for HTTP 1.0
          if (req.httpVersion === "1.0") { delete response.headers["transfer-encoding"]; }

          // Save recorded data to file
          const recordingData = {
            filepath: req.filename,
            fileversion: req.fileversion,
            method: req.method,
            target,
            uri: outgoing.uri,
            statusCode: response.statusCode,
            headers: response.headers,
            host: __guard__(outgoing != null ? outgoing.headers : undefined, x => x.host),
            latency: (new Date()).getTime() - outgoing.sentAt
          };
          if (response.body) { recordingData.body64 = response.body.toString('base64'); }
          if (response.headers.expires) { recordingData.expiresOffset = ((new Date(response.headers.expires)) - Date.now()); }

          const recordingJSON = JSON.stringify(recordingData, true, 2);
          return fs.writeFile(filepath, recordingJSON, function(error) {
            if (error) { return logErrorToConsole(error); }
            res.writeHead(response.statusCode, response.headers);
            if (body) { res.write(body); }
            return res.end();
          });
        });
      };
      return sendOutgoingRequest();
    };

    // When receiving data from the client, save the
    // request body from the client so that we can reissue
    // the request and calculate
    // the hash of the request body and write the chunk
    // to the request of the target.
    req.on("data", function(chunk) {
      if (!req.chunks) { req.chunks = []; }
      return req.chunks.push(chunk);
    });

    return req.on("end", function() {
      // Form complete body to send to target
      let bodyHash = null;
      if (req.chunks) {
        bodyHash = crypto.createHash('sha1');
        let totalLength = 0;
        for (var chunk of Array.from(req.chunks)) {
          totalLength += chunk.length;
        }
        req.body = new Buffer(totalLength);
        let offset = 0;
        for (chunk of Array.from(req.chunks)) {
          bodyHash.update(chunk);
          chunk.copy(req.body, offset);
          offset += chunk.length;
        }
        delete req.chunks;
        bodyHash = bodyHash.digest('hex');
      }
      // Calculate filename once the request is finished.
      const { filename, FILEVERSION } = mock._generateResponseFilename(req, bodyHash);
      req.filename = filename;
      req.fileversion = FILEVERSION;
      return sendTargetRequest();
    });
  }
});


function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}