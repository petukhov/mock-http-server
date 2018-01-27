/*
 * decaffeinate suggestions:
 * DS001: Remove Babel/TypeScript constructor workaround
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// **playback-server.coffee**
// Playback requests recorded into fixtures directory.
// 

let PlaybackServer;
const events      = require('events');
const http        = require('http');
const fs          = require('fs');
let path        = require('path');
const crypto      = require('crypto');
const {_}         = require('underscore');
const mock        = require('../src/mock-http-server');
const simulator   = require('../src/request-simulator');
const url         = require('url');
path        = require('path');

exports.PlaybackServer = (PlaybackServer = class PlaybackServer extends events.EventEmitter {

  constructor(options) {
    super();
    if (options == null) { options = {}; }
    this.options = options;
    this.responses = {};
    // Store previous requests that were not recorded
    this.notfound = {};
    // Directory to store fixtures
    this.fixturesPath = mock._generateFixturesPath(options.fixtures);

    this.loadSimulator(options.simulator);
  }

  // if specified, load request simulator script
  loadSimulator(simulatorPath) {

    if (simulatorPath) {
      simulatorPath = path.resolve(simulatorPath);
      const simulatorPathRelative = path.relative(".", simulatorPath);

      if (!fs.existsSync(simulatorPath)) {
        console.error(`Simulator ${simulatorPath} does not exist`); 
        process.exit(1);
      }

      if (!fs.statSync(simulatorPath).isFile()) {
        console.error(`Simulator ${simulatorPath} must be a javascript file`); 
        process.exit(1);
      }
        
      this.simulator = new simulator.RequestSimulator({simulatorPath});

      try {
        // load the simulator script
        // the script should make register() calls on the passed-in simulator object
        require(simulatorPath)(this.simulator);
        console.log(`  Simulator: ${simulatorPathRelative}`);
        return console.log(`             loaded with ${this.simulator.router.routes.length} rules`);
      } catch (e) {
        // continue gracefully if the simulator file has errors
        console.log(`  Simulator: ${simulatorPathRelative}`);
        return console.error(`             ${e}`);
      }

    } else {
      return console.log("  Simulator: none");
    }
  }
  // Called once for each request that comes into the HTTP server.
  playbackRequest(req, res) {
    this.requestReceivedAt = (new Date()).getTime();

    // Set event handlers to calculate sha1 hash of body while it is
    // being sent from the client.
    // The Playback Server ignores the request, but the hash
    // is used to differentiate post requests to the same endpoint
    req.on("data", function(chunk) {
      if (!req.bodyHash) { req.bodyHash = crypto.createHash('sha1'); }
      return req.bodyHash.update(chunk);
    });

    // Event emitted once the entire request has been received.
    // Calculate a unique filename for this request and
    // send the response from the file
    return req.on("end", () => {
      const bodyHash = req.bodyHash != null ? req.bodyHash.digest('hex') : undefined;
      const { filename, FILEVERSION } = mock._generateResponseFilename(req, bodyHash);
      return this._playbackResponseFromFilename(req, res, filename, FILEVERSION);
    });
  }

  // When a response has not been recorded, this
  // method will log that to the console and
  // return a 404 (Not Found)
  _respondWithNotFound(req, res, filename) {
    if (!this.options.hideUnknownRequests) {
      if (!this.notfound[filename]) {
        if (_.isEmpty(this.notfound)) {
          console.log("Unrecorded requests:");
          console.log(` Fixtures Path: ${this.fixturesPath}`);
        }
        this.notfound[filename] = true;
        // Debug data
        console.log(` Method: ${req.method}`);
        console.log(` Host: ${(req.headers != null ? req.headers.host : undefined) || 'localhost'}`);
        console.log(` Path: ${req.url}`);
        console.log(` Filename: ${filename}`);
      }
    }
    res.writeHead(404);
    return res.end();
  }

  // Send the recorded response to the client
  // The recorded response has the request body
  // in the original chunks sent from the client
  // encoded into base64 for serialization
  _playbackRecordedResponse(req, res, recordedResponse) {
    const { statusCode, headers, body, latency, expiresOffset } = recordedResponse;
    
    // avoid massive perf problems with connection header set to anything
    // but 'keep-alive'
    if (headers['connection']) {
      delete headers['connection'];
    }

    if (expiresOffset != null) {
      headers['date'] = (new Date(Date.now())).toUTCString();
      headers['expires'] = (new Date(Date.now() + expiresOffset)).toUTCString();
    }

    let waitForLatency = 0;
    if (this.options.latencyEnabled != null) {
      const currentTime = (new Date()).getTime();
      waitForLatency = latency - (currentTime - this.requestReceivedAt);
      if (waitForLatency < 0) { waitForLatency = 0; }
    }

    return setTimeout(function() { 
      res.writeHead(statusCode, headers);
      if (body) { res.write(body); }
      return res.end();
    }
    , waitForLatency);
  }

  // Check if file exists and if so parse and send it.
  _playbackResponseFromFile(req, res, filename, minimumFileversion) {
    const filepath = `${this.fixturesPath}/${filename}`;
    return fs.exists(filepath, exists => {
      if (exists) {
        return fs.readFile(filepath, (err, data) => {
          try {
            if (err) { throw err; }
            const recordedResponse = JSON.parse(data);
            const actualFileversion = recordedResponse.fileversion || 0;
            if (actualFileversion < minimumFileversion) {
              throw `Fixture file version was ${actualFileversion} expecting ${minimumFileversion}.  Update server with latest code.`;
            }
            if (recordedResponse.body64) {
              recordedResponse.body = new Buffer(recordedResponse.body64, 'base64');
              delete recordedResponse.body64;
            }
            if (this.options.cacheFixtures) { this.responses[filename] = recordedResponse; }
            delete this.notfound[filename];
            return this._playbackRecordedResponse(req, res, recordedResponse);
          } catch (e) {
            console.log(`Error loading ${filename}: ${e}`);
            res.writeHead(500);
            return res.end();
          }
        });
      } else {
        // Try serving the request using the simulator
        if (this.simulator) {
          const requestPath = url.parse(req.url);
          const pathname = path.normalize(requestPath.path);
          const self = this;

          // respondTo returns true if the simulator can handle the request
          const handled = this.simulator.respondTo(pathname, req.method, function(data) {
            // serve data returned by the simulator
            const recordedResponse = JSON.parse(data);
            if (recordedResponse.body64) {
              recordedResponse.body = new Buffer(recordedResponse.body64, 'base64');
              delete recordedResponse.body64;
            }
            return self._playbackRecordedResponse(req, res, recordedResponse);
          });

          if (!handled) {
            return this._respondWithNotFound(req, res, filename);
          }
        } else {
          return this._respondWithNotFound(req, res, filename);
        }
      }
    });
  }


  // Determines if request is not recorded or in the cache
  // before loading it from a file.
  _playbackResponseFromFilename(req, res, filename, fileversion) {
    // Get file contents out of cache unless options have it turned off
    const recordedResponse = this.responses[filename];
    if (recordedResponse) {
      return this._playbackRecordedResponse(req, res, recordedResponse);
    } else {
      return this._playbackResponseFromFile(req, res, filename, fileversion);
    }
  }
});

