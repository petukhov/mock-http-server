http          = require 'http'
https         = require 'https'
url           = require 'url'
crypto        = require 'crypto'
querystring   = require 'querystring'
recording     = require '../src/recording-proxy'
playback      = require '../src/playback-server'

FILEVERSION = 2

exports.createRecordingProxyServer = (options) ->
  recordingProxy = new recording.RecordingProxy(options)
  handler = (req, res) -> recordingProxy.proxyRequest(req, res)
  server = (if options.https then https.createServer(options.https, handler) else http.createServer(handler))
  server.recordingProxy = recordingProxy
  server.listen(options.port)
  server

exports.createPlaybackServer = (options) ->
  playbackServer = new playback.PlaybackServer(options)
  handler = (req, res) -> playbackServer.playbackRequest(req, res)
  server = (if options.https then https.createServer(options.https, handler) else http.createServer(handler))
  server.playbackServer = playbackServer
  server.listen(options.port)
  server

exports._generateFixturesPath = (fixtures) ->
  return if fixtures[0] == '/' then fixtures else "#{__dirname}/../#{fixtures}"

exports._generateResponseFilename = (req, hash) ->
  requestPath = url.parse(req.url)
  path = requestPath.path

  if path.length > 100
    # Hash URL query parameters if the path is too long
    searchHash = crypto.createHash 'sha1'
    searchHash.update requestPath.search
    sha1min = searchHash.digest('hex')[0...6]
    path = "#{requestPath.pathname}-#{sha1min}"

  host = ''
  if req.headers?.host
    host = req.headers.host.split(':')[0]

  # Dangerous characters stripped
  filename = querystring.escape("#{req.method}-#{path}-#{host}".replace(/[\/.:\\?&\[\]'"= ]+/g, '-'))
  
  # Append the hash of the body
  if hash
    filename += '-'
    filename += hash
  filename += '.response'
  { filename, FILEVERSION, path }

