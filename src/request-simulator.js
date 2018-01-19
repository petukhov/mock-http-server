/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
let RequestSimulator;
const barista    = require("barista");
const fs         = require("fs");
const path       = require("path");
const handlebars = require("handlebars");
const url        = require("url");
const extend     = require("xtend");

//
// RequestSimulator
// =================
// Serves templated responses for registered paths
//
exports.RequestSimulator = (RequestSimulator = class RequestSimulator {
  constructor(options) {
    if (options == null) { options = {}; }
    this.options = options;
    this.router = new barista.Router;
    this.simulatorPath = this.options.simulatorPath; // to locate templates at relative path to the simulator script
    this.templates = {};
  }

  // register()
  //   registers a parameterized path to simulate requests for
  //
  //   path        : rails route style path, e.g. /products/:product_id/users/:id
  //   template    : handlebars template that defines request JSON
  //   method      : http method, e.g. 'GET', optional, defaults to 'GET'
  //   dataHandler : callback function that can pre-process data before it is
  //                 applied to the template, optional, defauls to null
  register(pathName, template, method, dataHandler) {
    if (!pathName || !template) {
      console.error("register() must be called with a path and a template");
      process.exit(1);
    }

    template = path.resolve(this.simulatorPath, "..", template);

    if (!fs.existsSync(template)) {
      console.error(`Template ${template} does not exist`); 
      process.exit(1);
    }

    if (!fs.statSync(template).isFile()) {
      console.error(`Template ${template} must be a file`); 
      process.exit(1);
    }

    this.router.match(pathName, method || "GET").to("", {
      path: pathName,
      template,
      dataHandler
    }
    );

    // read and cache templates
    const self = this;
    return fs.readFile(template, "utf8", function(err, templateContents) {
      if (err) {
        console.error("Could not open template file: %s", err);
        process.exit(1);
      }
      try {
        return self.templates[template] = handlebars.compile(templateContents + "");
      } catch (e) {
        return console.error(`Error using template ${template} - ${e}`);
      }
    });
  }

  // respondTo()
  //   attempts to respond to the given path and http method
  //   returns true if it matches a registed path, false otherwise
  //
  //   path         : actual path to serve, e.g. /products/100/users/3
  //   method       : http method, e.g. 'GET', optional, defaults to 'GET'
  //   callback     : upon successfully creating data for the requested path, this
  //                  function is called, optional, defaults to a function that
  //                  simply outputs the data to console
  respondTo(path, method, callback) {
    if (!callback) {
      callback = data => console.log(data);
    }
    const match = this.router.first(path, method || "GET");

    if (!match) { return false; }  // simulator will not handle this request

    // add url query params to the available vars
    const url_parts = url.parse(path, true);
    const { query } = url_parts;
    extend(match, query);

    // get compiled template from cache
    const template = this.templates[match.template];

    if (match.dataHandler) {
      // allow data handler to process data before applying to template
      match.dataHandler(match, processedData => callback(template(processedData)));

    } else {
      callback(template(match));
    }

    // simulator will handle this request
    return true;
  }
});

