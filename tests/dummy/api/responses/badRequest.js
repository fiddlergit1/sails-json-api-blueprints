/**
 * 400 (Bad Request) Handler
 *
 * Usage:
 * return res.badRequest();
 * return res.badRequest(data);
 * return res.badRequest(data, 'some/specific/badRequest/view');
 *
 * e.g.:
 * ```
 * return res.badRequest(
 *   'Please choose a valid `password` (6-12 characters)',
 *   'trial/signup'
 * );
 * ```
 */

module.exports = function badRequest(data, options) {

  // Get access to `req`, `res`, & `sails`
  var req = this.req;
  var res = this.res;
  var sails = req._sails;

  // Set status code
  res.status(400);

  // Log error to console
  if (data !== undefined) {
    sails.log.verbose('Sending 400 ("Bad Request") response: \n',data);
  }
  else sails.log.verbose('Sending 400 ("Bad Request") response');

  // Only include errors in response if application environment
  // is not set to 'production'.  In production, we shouldn't
  // send back any identifying information about errors.
  if (sails.config.environment === 'production' && sails.config.keepResponseErrors !== true) {
    data = undefined;
  }

  // If the user-agent wants JSON, always respond with JSON
  // If views are disabled, revert to json
  if (req.wantsJSON || sails.config.hooks.views === false) {
    return res.json(data);
  }

  // If second argument is a string, we take that to mean it refers to a view.
  // If it was omitted, use an empty object (`{}`)
  options = (typeof options === 'string') ? { view: options } : options || {};

  // Attempt to prettify data for views, if it's a non-error object
  var viewData = data;
  if (!(viewData instanceof Error) && 'object' == typeof viewData) {
    try {
      viewData = require('util').inspect(data, {depth: null});
    }
    catch(e) {
      viewData = undefined;
    }
  }

  // If a view was provided in options, serve it.
  if (options.view) {
    return res.view(options.view, { data: viewData, title: 'Bad Request' });
  }

  // If no view provided send JSON(P)
  return res.json(data);

};

