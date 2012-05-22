vows      = require 'vows'
assert    = require 'assert'
http      = require 'http'
{_}       = require 'underscore'
helpers   = require '../test/helpers'
mock      = require '../src/mock-http-server'

{responseWrapper, testHTTPRunning, requestOptions, postJSONOptions} = helpers
{createRecordingProxyServer, createPlaybackServer} = mock

HOSTNAME      = '127.0.0.1'
HTTPPORT      = 7771  # Target HTTP server
PROXYPORT     = 7772  # Recording Proxy Server
PLAYBACKPORT  = 7773  # Playback HTTP server

#
# Binary data used for testing large HTTP response bodies
#

createBinaryImageData = ->
  size = 1 * 1024 * 1024
  data = new Buffer(size)
  i = 0
  while i < size
    data.writeUInt8((i % 256), i)
    i++
  data

TEST_IMAGE_DATA = createBinaryImageData()

#
# A simple HTTP server that is used as the target
# for the recording proxy
#
# Note: Add new test APIs to this server
#

writeUnknownRequest = (res) -> res.writeHead 404

respondToGETRequest = (req, res) ->
  switch req.url
    when '/'
      res.writeHead 200, "Content-Type": "text/plain"
    when '/texttest'
      res.writeHead 200, "Content-Type": "text/plain"
      res.write "texttest"
    when '/jsontest'
      res.writeHead 200, "Content-Type": "application/json"
      res.write JSON.stringify({ jsontest: true })
    when '/imagetest'
      res.writeHead 200, "Content-Type": "image/png"
      res.write TEST_IMAGE_DATA
    when '/checkhost'
      expectedHost = "#{HOSTNAME}:#{HTTPPORT}"
      if req.headers.host == expectedHost
        res.writeHead 200, "Content-Type": "text/plain"
      else
        res.writeHead 500, "Content-Type": "text/plain"
        res.write("host should be #{expectedHost}")
      res.end('\n')
    else
      writeUnknownRequest res
  res.end()

respondToPOSTRequest = (req, res) ->
  switch req.url
    when '/posttest'
      body = JSON.parse(req.body)
      if body.test == 'posttest'
        res.writeHead 200, "Content-Type": "application/json"
        res.write JSON.stringify({ posttest: true })
      else
        res.writeHead 422, "Unprocessable Entity", "Content-Type": "text/plain"
    else
      writeUnknownRequest res
  res.end()

http.createServer((req, res) ->
  switch req.method
    when 'GET'
      # Respond immediately
      respondToGETRequest(req, res)
    when 'POST'
      # Collect the body
      req.body = ''
      req.on 'data', (chunk) -> req.body += chunk
      req.on 'end', -> respondToPOSTRequest(req, res)
    else
      writeUnknownRequest res
      res.end()
).listen HTTPPORT, HOSTNAME

#
# Recording Proxy Server
# Captures requests to Target HTTP Server (above)
#

recordingProxyOptions =
  port: PROXYPORT             # port to listen on
  fixtures: 'test/fixtures'   # directory where the fixture files are
  target:                     # target server to proxy
    host: HOSTNAME
    port: HTTPPORT
createRecordingProxyServer recordingProxyOptions

#
# Playback Server
# Loads requests captured by Recording Proxy
#

playbackServerOptions =
  port: PLAYBACKPORT          # port to listen on
  fixtures: 'test/fixtures'   # directory where the fixture files are
  hideUnknownRequests: true   # do not show them on screen during testing
createPlaybackServer playbackServerOptions

#
# Test Macros
#

getRawRequest = (port, path, callback, encoding) ->
  options = requestOptions(HOSTNAME, port, path)
  http.request(options, responseWrapper(callback, encoding)).end()
  return

getRequest = (port, path, callback) -> getRawRequest(port, path, callback, 'utf8')
getImageRequest = (port, path, callback) -> getRawRequest(port, path, callback)

postRequest = (port, path, params, callback) ->
  {options, body} = postJSONOptions HOSTNAME, port, path, params
  req = http.request options, responseWrapper(callback, 'utf8')
  req.write body
  req.end()
  return

#
# Parameterized tests
# We run the same tests on different ports to make sure that the proxy
# and playback return the original results from the target server
#

testGETUnknown = (port) ->
  return {
    topic: ->
      getRequest port, '/does-not-exist', @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 404': (results) ->
      assert.equal results.statusCode, 404    
  }

testGETUnrecorded = (port) ->
  return {
    topic: ->
      getRequest port, '/was-not-recorded', @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 404': (results) ->
      assert.equal results.statusCode, 404    
  }

testGETText = (port) ->
  return {
    topic: ->
      getRequest port, '/texttest', @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 200 and have text data': (results) ->
      assert.equal results.statusCode, 200
      assert.equal results.headers['content-type'], "text/plain"
      assert.equal results.body, 'texttest'    
  }

testGETJSON = (port) ->
  return {
    topic: ->
      getRequest port, '/jsontest', @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 200 and have JSON data': (results) ->
      assert.equal results.statusCode, 200
      assert.equal results.headers['content-type'], "application/json"
      assert.deepEqual JSON.parse(results.body), { jsontest: true }
  }

testGETCheckHost = (port) ->
  return {
    topic: ->
      getRequest port, '/checkhost', @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 200': (results) ->
      assert.equal results.statusCode, 200
      assert.equal results.body, '\n'
  }

testGETImage = (port) ->
  return {
    topic: ->
      getImageRequest port, '/imagetest', @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 200 and have image data': (results) ->
      assert.equal results.statusCode, 200
      assert.equal results.headers['content-type'], "image/png"
    'should have the same binary image sent by the server': (results) ->
      if results.body.toString('base64') != TEST_IMAGE_DATA.toString('base64')
        assert.isTrue false, "Image received (#{results.body.length} bytes) is not the same as file (#{TEST_IMAGE_DATA.length} bytes)"
  }

testPOSTUnknown = (port) ->
  return {
    topic: ->
      postRequest port, '/does-not-exist', {}, @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 404': (results) ->
      assert.equal results.statusCode, 404   
  }

testPOSTJSON = (port) ->
  return {
    topic: ->
      postRequest port, '/posttest', { test: 'posttest' }, @callback
    'should not have errors': (error, results) ->
      assert.isNull error
    'should respond with HTTP 200': (results) ->
      assert.equal results.statusCode, 200
    'should respond with JSON': (results) ->
      assert.equal results.headers['content-type'], "application/json"
      assert.deepEqual JSON.parse(results.body), { posttest: true }    
  }

#
# Test Suite
#

vows.describe('Mock HTTP Server Test (mock-http-server-test)')
  #
  # Check if all servers have started
  #
  .addBatch
    'The Target HTTP Server': testHTTPRunning "ERROR: could not connect to Target HTTP Server", HTTPPORT
  .addBatch
    'The Recording Proxy Server': testHTTPRunning "ERROR: could not connect to Recording Proxy Server", PROXYPORT

  #
  # Verify that the Target HTTP Server (running on HTTPPORT) returns known data
  #
  .addBatch
    'Getting an unknown page from the target server': testGETUnknown HTTPPORT
    'Getting text from an API from the target server': testGETText HTTPPORT
    'Getting JSON from an API from the target server': testGETJSON HTTPPORT
    'Getting large binary data from the target server': testGETImage HTTPPORT
    'Posting to an unknown page on the target server': testPOSTUnknown HTTPPORT
    'Posting JSON to an API on the target server': testPOSTJSON HTTPPORT

  #
  # Verify that the Recording Proxy (running PROXYPORT) passes through the requests to the Target HTTP Server
  #
  .addBatch
    'Getting an unknown page from the recording proxy': testGETUnknown PROXYPORT
    'Getting text from an API from the recording proxy': testGETText PROXYPORT
    'Getting JSON from an API from the recording proxy': testGETJSON PROXYPORT
    'Getting large binary data from the recording proxy': testGETImage PROXYPORT
    'Posting to an unknown page on the recording proxy': testPOSTUnknown PROXYPORT
    'Posting JSON to an API on the recording proxy': testPOSTJSON PROXYPORT
    'Getting from the proxy should change host to target': testGETCheckHost PROXYPORT

  #
  # Verify that the Playback Server (running on PLAYBACKPORT) loads the recorded responses
  #
  .addBatch
    'Getting an unknown page from the playback server': testGETUnknown PLAYBACKPORT
    'Getting text from an API from the playback server': testGETText PLAYBACKPORT
    'Getting JSON from an API from the playback server': testGETJSON PLAYBACKPORT
    'Getting large binary data from the playback server': testGETImage PLAYBACKPORT
    'Posting to an unknown page on the playback server': testPOSTUnknown PLAYBACKPORT
    'Posting JSON to an API on the playback server': testPOSTJSON PLAYBACKPORT
    'Getting an unrecorded page from the playback server': testGETUnrecorded PLAYBACKPORT

  .export(module)

