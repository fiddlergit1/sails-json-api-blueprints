/*
 * Copied from https://github.com/balderdashy/sails/blob/master/lib/hooks/blueprints/index.js
 */

var _ = require('lodash');
var util = require('util');
var pluralize = require('pluralize');
var BlueprintController = {
  create  : require('./api/blueprints/create')
  , find    : require('./api/blueprints/find')
  , findone : require('./api/blueprints/findone')
  , update  : require('./api/blueprints/update')
  , destroy : require('./api/blueprints/destroy')
  , populate: require('./api/blueprints/populate')
};
var JsonApiService = require('./api/services/JsonApiService');
var jsonApiValidator = require('./context-aware-jsonapi-validator/validator');
var responseOk = require('./api/responses/ok');
var responseCreated = require('./api/responses/created');
var responseNotFound = require('./api/responses/notFound');
var responseBadRequest = require('./api/responses/badRequest');
var responseUnauthorized = require('./api/responses/unauthorized');
var responseForbidden = require('./api/responses/forbidden');
var responseServerError = require('./api/responses/serverError');
var responseNegotiate = require('./api/responses/negotiate');
var responseInvalid = require('./api/responses/invalid');
var responseInvalidJsonApi = require('./api/responses/invalidJsonApi');

function strncmp(a, b, n){
  return a.substring(0, n) == b.substring(0, n);
}

/**
 * Blueprints (Core Hook)
 *
 * Stability: 1 - Experimental
 * (see http://nodejs.org/api/documentation.html#documentation_stability_index)
 */

module.exports = function(sails) {

  /**
   * Private dependencies.
   * (need access to `sails`)
   */

  var onRoute = require('./onRoute')(sails);



  var hook;

  const patchRoute = {};
  /*
   * Patch method does not redirect to the update blueprint by default
   * (see https://github.com/balderdashy/sails/pull/2006 for more details)
   * We will need to manually redirect all PATCH method to the update blueprint.
   */
  let path = '';
  if (sails.config.blueprints.prefix !== undefined) {
    path = 'PATCH ' + sails.config.blueprints.prefix + '/:model/:id';
  } else {
    path = 'PATCH /:model/:id';
  }

  // Only the patch route if blueprints are in use
  if (sails.config.blueprints.rest === true) {
    patchRoute[path] = function(req, res) {
      return JsonApiService.updateMethod(req, res);
    };
  }

  /**
   * Expose blueprint hook definition
   */
  return {

    configure: function() {
      sails.config.blueprints.pluralize = true;

      sails.services.JsonApiService = JsonApiService;
    },

    routes: {
      after: patchRoute
    },

    /**
     * Initialize is fired first thing when the hook is loaded.
     *
     * @param  {Function} cb
     */
    initialize: function (cb) {

      // Provide hook context to closures
      hook = this;

      // Register route syntax for binding blueprints directly.
      sails.on('route:typeUnknown', onRoute);

      // Set up listener to bind shadow routes when the time is right.
      //
      // Always wait until after router has bound static routes.
      // If policies hook is enabled, also wait until policies are bound.
      // If orm hook is enabled, also wait until models are known.
      // If controllers hook is enabled, also wait until controllers are known.
      var eventsToWaitFor = [];
      eventsToWaitFor.push('router:after');
      if (sails.hooks.policies) {
        eventsToWaitFor.push('hook:policies:bound');
      }
      if (sails.hooks.orm) {
        eventsToWaitFor.push('hook:orm:loaded');
      }
      if (sails.hooks.controllers) {
        eventsToWaitFor.push('hook:controllers:loaded');
      }
      sails.after(eventsToWaitFor, hook.bindShadowRoutes);

      sails.hooks.responses.middleware.ok = responseOk;
      sails.hooks.responses.middleware.created = responseCreated;
      sails.hooks.responses.middleware.notFound = responseNotFound;
      sails.hooks.responses.middleware.badRequest = responseBadRequest;
      sails.hooks.responses.middleware.unauthorized = responseUnauthorized;
      sails.hooks.responses.middleware.forbidden = responseForbidden;
      sails.hooks.responses.middleware.serverError = responseServerError;
      sails.hooks.responses.middleware.negotiate = responseNegotiate;
      sails.hooks.responses.middleware.invalid = responseInvalid;
      sails.hooks.responses.middleware.invalidJsonApi = responseInvalidJsonApi;

      // Load blueprint middleware and continue.
      loadMiddleware(cb);
    },

    extendControllerMiddleware: function() {
      _.each(sails.middleware.controllers, function (controller) {

        // Originally was a call to _.defaults to override non defined controller actions.
        // Here we want to make sure we only override sails default blueprints and not actual
        // user defined controller action
        // For this purpose we look at the Sails blueprints signature
        _.each(hook.middleware, function(middleware, name) {
          if (strncmp(controller[name]._middlewareType, "BLUEPRINT: ", "BLUEPRINT: ".length) === true) {
            controller[name] = function(req, res) {

              if (req.method === 'POST' || req.method === 'PATCH') {

                var context = (req.method === 'POST') ? jsonApiValidator.CONTEXT_CREATE : jsonApiValidator.CONTEXT_UPDATE;

                if (JsonApiService.validate(req.body, context) === false)
                  return res.invalidJsonApi();
              }

              req.body = JsonApiService.deserialize(req.body);

              return middleware(req, res);
            };
          }
        });
      });
    },

    bindShadowRoutes: function() {

      JsonApiService.init();
      var logWarns = function(warns) {
        sails.log.blank();
        _.each(warns, function (warn) {
          sails.log.warn(warn);
        });
        STRINGFILE.logMoreInfoLink(STRINGFILE.get('links.docs.config.blueprints'), sails.log.warn);
      };

      _.each(sails.middleware.controllers, function eachController (controller, controllerId) {
        if ( !_.isObject(controller) || _.isArray(controller) ) return;

        // Get globalId for use in errors/warnings
        var globalId = sails.controllers[controllerId].globalId;

        // Determine blueprint configuration for this controller
        var config = _.merge({},
                             sails.config.blueprints,
                             controller._config || {});

        // Validate blueprint config for this controller
        if ( config.prefix ) {
          if ( !_(config.prefix).isString() ) {
            sails.after('lifted', function () {
              logWarns([
                util.format('Ignoring invalid blueprint prefix configured for controller `%s`.', globalId),
                '`prefix` should be a string, e.g. "/api/v1".'
              ]);
            });
            return;
          }
          if ( !config.prefix.match(/^\//) ) {
            var originalPrefix = config.prefix;
            sails.after('lifted', function () {
              logWarns([
                util.format('Invalid blueprint prefix ("%s") configured for controller `%s` (should start with a `/`).', originalPrefix, globalId),
                util.format('For now, assuming you meant:  "%s".', config.prefix)
              ]);
            });

            config.prefix = '/' + config.prefix;
          }
        }

        // Validate REST route blueprint config for this controller
        if ( config.restPrefix ) {
          if ( !_(config.restPrefix).isString() ) {
            sails.after('lifted', function () {
              logWarns([
                util.format('Ignoring invalid blueprint rest prefix configured for controller `%s`.', globalId),
                '`restPrefix` should be a string, e.g. "/api/v1".'
              ]);
            });
            return;
          }
          if ( !config.restPrefix.match(/^\//) ) {
            var originalRestPrefix = config.restPrefix;
            sails.after('lifted', function () {
              logWarns([
                util.format('Invalid blueprint restPrefix ("%s") configured for controller `%s` (should start with a `/`).', originalRestPrefix, globalId),
                util.format('For now, assuming you meant:  "%s".', config.restPrefix)
              ]);
            });

            config.restPrefix = '/' + config.restPrefix;
          }
        }

        // Determine the names of the controller's user-defined actions
        // IMPORTANT: Note that we use `sails.controllers` rather than
        // `sails.middleware.controllers` (since `sails.middleware.controllers`
        // will have blueprints already mixed-in, and we want the explicit actions
        // defined in the app)
        var actions = Object.keys(sails.controllers[controllerId]);



        // Determine base route
        var baseRouteName = controllerId;

        if (config.pluralize) {
          baseRouteName = pluralize(baseRouteName);
        }

        var baseRoute = config.prefix + '/' + baseRouteName;
        // Determine base route for RESTful service
        // Note that restPrefix will always start with /
        var baseRestRoute = config.prefix + config.restPrefix + '/' + baseRouteName;

        // Build route options for blueprint
        var routeOpts = config;

        // Bind "actions" and "index" shadow routes for each action
        _.each(actions, function eachActionID (actionId) {

          var opts = _.merge({
            action: actionId,
            controller: controllerId
          }, routeOpts);

          // Bind a route based on the action name, if `actions` shadows enabled
          if (config.actions) {
            var actionRoute = baseRoute + '/' + actionId.toLowerCase() + '/:id?';
            sails.log.silly('Binding action ('+actionId.toLowerCase()+') blueprint/shadow route for controller:',controllerId);
            sails.router.bind(actionRoute, controller[actionId.toLowerCase()], null, opts);
          }

          // Bind base route to index action, if `index` shadows are not disabled
          if (config.index !== false && actionId.match(/^index$/i)) {
            sails.log.silly('Binding index blueprint/shadow route for controller:',controllerId);
            sails.router.bind(baseRoute, controller.index, null, opts);
          }
        });

        // Determine the model connected to this controller either by:
        // -> explicit configuration
        // -> on the controller
        // -> on the routes config
        // -> or implicitly by globalId
        // -> or implicitly by controller id
        var routeConfig = sails.router.explicitRoutes[controllerId] || {};
        var modelFromGlobalId = _.find(sails.models, {globalId: globalId});
        var modelId = config.model || routeConfig.model || (modelFromGlobalId && modelFromGlobalId.identity) || controllerId;

        // If the orm hook is enabled, it has already been loaded by this time,
        // so just double-check to see if the attached model exists in `sails.models`
        // before trying to attach any CRUD blueprint actions to the controller.
        if (sails.hooks.orm && sails.models && sails.models[modelId]) {

          // If a model with matching identity exists,
          // extend route options with the id of the model.
          routeOpts.model = modelId;

          var Model = sails.models[modelId];

          // Bind convenience functions for readability below:

          // Given an action id like "find" or "create", returns the appropriate
          // blueprint action (or explicit controller action if the controller
          // overrode the blueprint CRUD action.)
          var _getAction = _.partial(_getMiddlewareForShadowRoute, controllerId);

          // Returns a customized version of the route template as a string.
          var _getRoute = _.partialRight(util.format, baseRoute);

          var _getRestRoute = _getRoute;
          if (config.restPrefix) {
            // Returns a customized version of the route template as a string for REST
            _getRestRoute = _.partialRight(util.format, baseRestRoute);
          }


          // Mix in the known associations for this model to the route options.
          routeOpts = _.merge({ associations: _.cloneDeep(Model.associations) }, routeOpts);

          // Binds a route to the specifed action using _getAction, and sets the action and controller
          // options for req.options
          var _bindRoute = function (path, action, options) {
            options = options || routeOpts;
            options = _.extend({}, options, {action: action, controller: controllerId});
            sails.router.bind ( path, _getAction(action), null, options);

          };

          // Bind URL-bar "shortcuts"
          // (NOTE: in a future release, these may be superceded by embedding actions in generated controllers
          //  and relying on action blueprints instead.)
          if ( config.shortcuts ) {
            sails.log.silly('Binding shortcut blueprint/shadow routes for model ', modelId, ' on controller:', controllerId);

            _bindRoute(_getRoute('%s/find'), 'find');
            _bindRoute(_getRoute('%s/find/:id'), 'findOne');
            _bindRoute(_getRoute('%s/create'), 'create');
            _bindRoute(_getRoute('%s/update/:id'), 'update');
            _bindRoute(_getRoute('%s/destroy/:id?'), 'destroy');

            // Bind add/remove "shortcuts" for each `collection` associations
            _(Model.associations).filter({type: 'collection'}).forEach(function (association) {
              var alias = association.alias;
              var _getAssocRoute = _.partialRight(util.format, baseRoute, alias);
              var opts = _.merge({ alias: alias }, routeOpts);

              sails.log.silly('Binding "shortcuts" to association blueprint `'+alias+'` for',controllerId);
              _bindRoute( _getAssocRoute('%s/:parentid/%s/add/:id?'),      'add' , opts );
              _bindRoute( _getAssocRoute('%s/:parentid/%s/remove/:id?'),   'remove', opts );
            });
          }

          // Bind "rest" blueprint/shadow routes
          if ( config.rest ) {
            sails.log.silly('Binding RESTful blueprint/shadow routes for model+controller:',controllerId);

            _bindRoute(_getRestRoute('get %s'), 'find');
            _bindRoute(_getRestRoute('get %s/:id'), 'findOne');
            _bindRoute(_getRestRoute('post %s'), 'create');
            _bindRoute(_getRestRoute('put %s/:id'), 'update');
            _bindRoute(_getRestRoute('post %s/:id'), 'update');
            _bindRoute(_getRestRoute('delete %s/:id?'), 'destroy');

            // Bind "rest" blueprint/shadow routes based on known associations in our model's schema
            // Bind add/remove for each `collection` associations
            _(Model.associations).filter({type: 'collection'}).forEach(function (association) {
              var alias = association.alias;
              var _getAssocRoute = _.partialRight(util.format, baseRestRoute, alias);
              var opts = _.merge({ alias: alias }, routeOpts);
              sails.log.silly('Binding RESTful association blueprint `'+alias+'` for',controllerId);

              _bindRoute( _getAssocRoute('post %s/:parentid/%s/:id?'),     'add', opts );
              _bindRoute( _getAssocRoute('delete %s/:parentid/%s/:id?'),   'remove', opts );
            });

            // and populate for both `collection` and `model` associations
            _(Model.associations).forEach(function (association) {
              var alias = association.alias;
              var _getAssocRoute = _.partialRight(util.format, baseRestRoute, alias);
              var opts = _.merge({ alias: alias }, routeOpts);
              sails.log.silly('Binding RESTful association blueprint `'+alias+'` for',controllerId);

              _bindRoute( _getAssocRoute('get %s/:parentid/%s/:id?'), 'populate', opts );
            });
          }
        }
      });


      /**
       * Return the middleware function that should be bound for a shadow route
       * pointing to the specified blueprintId. Will use the explicit controller
       * action if it exists, otherwise the blueprint action.
       *
       * @param  {String} controllerId
       * @param  {String} blueprintId  [find, create, etc.]
       * @return {Function}            [middleware]
       */
      function _getMiddlewareForShadowRoute (controllerId, blueprintId) {

        // Allow custom actions defined in controller to override blueprint actions.
        return sails.middleware.controllers[controllerId][blueprintId.toLowerCase()] || hook.middleware[blueprintId.toLowerCase()];
      }
    }

  };


  /**
   * (Re)load middleware.
   *
   * First, built-in blueprint actions in core Sails will be loaded.
   * Then, we'll attempt to load any custom blueprint definitions from
   * the user app using moduleloader.
   *
   * @api private
   */

  function loadMiddleware (cb) {
    sails.log.verbose('Loading blueprint middleware...');

    // Start off w/ the built-in blueprint actions (generic CRUD logic)
    // (see BlueprintController definition at top of file)

    // Get custom blueprint definitions
    sails.modules.loadBlueprints(function modulesLoaded (err, modules) {
      if (err) return cb(err);

      // Merge custom overrides from our app into the BlueprintController
      // in Sails core.
      _.extend(BlueprintController, modules);

      // Add _middlewareType keys to the functions, for debugging
      _.each(BlueprintController, function(fn, key) {
        fn._middlewareType = 'JSON API BLUEPRINT: '+fn.name || key;
      });

      // Save reference to blueprints middleware in hook.
      hook.middleware = BlueprintController;

      // When our app's controllers are finished loading,
      // merge the blueprint actions into each of them as defaults.
      sails.once('middleware:registered', hook.extendControllerMiddleware);

      return cb(err);
    });
  }

};
