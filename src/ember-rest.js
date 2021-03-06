/**
 Ember-REST.js 0.1.1

 A simple library for RESTful resources in Ember.js

 Copyright (c) 2012 Cerebris Corporation

 Licensed under the MIT license:
   http://www.opensource.org/licenses/mit-license.php
*/

/**
  An adapter for performing resource requests

  The default implementation is a thin wrapper around jQuery.ajax(). It is mixed in to both Ember.Resource
  and Ember.ResourceController.

  To override Ember.ResourceAdapter entirely, define your own version and include it before this module.

  To override a portion of this adapter, reopen it directly or reopen a particular Ember.Resource or
  Ember.ResourceController. You can override `_resourceRequest()` entirely, or just provide an implementation of
  `_prepareResourceRequest(params)` to adjust request params before `jQuery.ajax(params)`.
*/

Ember.ajaxPromise = function(params, nativeAjaxTarget, nativeAjaxMethod) {
    if (!params.contentType) {
        params.contentType = 'application/json';
    }
    if (!params.dataType) {
        params.dataType = 'json';
    }
    //wrap the ajax request into a RSVP Promise
    return new Ember.RSVP.Promise(function(resolve, reject) {
        params.success = function(data) {
            Ember.run(null, resolve, data);
        };

        params.error = function(jqXHR, status, error) {
            Ember.run(null, reject, jqXHR, status, error);
        }

        //jQuery
        var request = $.ajax(params);

        if (nativeAjaxMethod) {
            nativeAjaxMethod.call(nativeAjaxTarget, request);
        }

    }).
    catch (function(err) {
        var error;
        if (err.responseJSON) {
            error = err.responseJSON;
            error.status = err.status;
        } else if (err.getAllResponseHeaders) {
            var headers = err.getAllResponseHeaders();
            if (headers.indexOf('Content-Type: application/json') !== -1) {
                try {
                    error = JSON.parse(err.responseText);
                } catch (e) {
                    error = {};
                }
                error.status = err.status;
            } else {
                error = {};
                error.status = err.status;
            }
        } else {
            error = err;
        }
        //propagate the error
        throw error;
    });
};

if (!Ember.ResourceAdapter) {
    Ember.ResourceAdapter = Ember.Mixin.create({
        /**
      @private

      Performs an XHR request with `jQuery.ajax()`. Calls `_prepareResourceRequest(params)` if defined.
    */
        _resourceRequest: function(params) {
            params.url = params.url || this._resourceUrl();
            params.dataType = 'json';
            //default to application/json
            if (!params.contentType && (params.type === 'PUT' || params.type === 'POST')) {
                params.contentType = 'application/json';
                if (typeof params.data === 'object') {
                    params.data = JSON.stringify(params.data);
                }
            }

            if (this._prepareResourceRequest !== undefined) {
                this._prepareResourceRequest(params);
            }

            return Ember.ajaxPromise(params, this, this._postResourceRequest);
        }
    });
}

/**
  A model class for RESTful resources

  Extend this class and define the following properties:

  * `resourceIdField` -- the id field for this resource ('id' by default)
  * `resourceUrl` -- the base url of the resource (e.g. '/contacts');
       will append '/' + id for individual resources (required)
  * `resourceName` -- the name used to contain the serialized data in this
       object's JSON representation (required only for serialization)
  * `resourceProperties` -- an array of property names to be returned in this
       object's JSON representation (required only for serialization)

  Because `resourceName` and `resourceProperties` are only used for
    serialization, they aren't required for read-only resources.

  You may also wish to override / define the following methods:

  * `serialize()`
  * `serializeProperty(prop)`
  * `deserialize(json)`
  * `deserializeProperty(prop, value)`
  * `validate()`
*/
Ember.Resource = Ember.Object.extend(Ember.ResourceAdapter, Ember.Copyable, {
    resourceIdField: 'id',
    resourceUrl: Ember.required(),

    /**
    Duplicate properties from another resource

    * `source` -- an Ember.Resource object
    * `props` -- the array of properties to be duplicated;
         defaults to `resourceProperties`
  */
    duplicateProperties: function(source, props) {
        var prop, propVal;
        Ember.beginPropertyChanges(this);
        if (props === undefined) props = this.resourceProperties;

        for (var i = 0; i < props.length; i++) {
            prop = props[i];
            propVal = source.get(prop);
            if ($.isArray(propVal)) {
                propVal = propVal.slice();
            } else if (propVal !== null && typeof propVal === 'object') {
                propVal = $.extend({}, propVal);
            }
            this.set(prop, propVal);
        }
        Ember.endPropertyChanges(this);
    },

    /**
    Create a copy of this resource

    Needed to implement Ember.Copyable

    REQUIRED: `resourceProperties`
  */
    copy: function(deep) {
        var c = this.constructor.create();
        c.duplicateProperties(this);
        c.set(this.resourceIdField, this.get(this.resourceIdField));
        return c;
    },

    /**
    Generate this resource's JSON representation

    Override this or `serializeProperty` to provide custom serialization

    REQUIRED: `resourceProperties` and `resourceName` (see note above)
  */
    serialize: function() {
        var name = this.resourceName,
            props = this.resourceProperties,
            prop, ret = {};

        ret[name] = {};
        for (var i = 0; i < props.length; i++) {
            prop = props[i];
            ret[name][prop] = this.serializeProperty(prop);
        }
        return ret;
    },

    /**
    Generate an individual property's JSON representation

    Override to provide custom serialization
  */
    serializeProperty: function(prop) {
        return this.get(prop);
    },

    /**
    Set this resource's properties from JSON

    Override this or `deserializeProperty` to provide custom deserialization
  */
    deserialize: function(json) {
        Ember.beginPropertyChanges(this);
        for (var prop in json) {
            if (json.hasOwnProperty(prop)) this.deserializeProperty(prop, json[prop]);
        }
        Ember.endPropertyChanges(this);
        return this;
    },

    /**
    Set an individual property from its value in JSON

    Override to provide custom serialization
  */
    deserializeProperty: function(prop, value) {
        if (typeof this.prop !== "function") {
            this.set(prop, value);
        }
    },

    /**
    Request resource and deserialize

    REQUIRED: `id`
  */
    findResource: function() {
        var self = this;

        return this._resourceRequest({
            type: 'GET'
        }).then(function(json) {
            return self.deserialize(json);
        });
    },

    /**
    Create (if new) or update (if existing) record

    Will call validate() if defined for this record

    If successful, updates this record's id and other properties
    by calling `deserialize()` with the data returned.

    REQUIRED: `properties` and `name` (see note above)
  */
    saveResource: function() {
        var self = this;

        if (this.validate !== undefined) {
            var error = this.validate();
            if (error) {
                return Ember.RSVP.Promise.reject(error);
            }
        }

        return this._resourceRequest({
            type: this.isNew() ? 'POST' : 'PUT',
            data: this.serialize()
        }).then(function(json, statusText, jqXHR) {
            // Update properties
            if (json) {
                self.deserialize(json, jqXHR);
            }
            return self;
        });
    },

    /**
    Delete resource
  */
    destroyResource: function() {
        return this._resourceRequest({
            type: 'DELETE'
        });
    },

    /**
   Is this a new resource?
  */
    isNew: function() {
        return Ember.isEmpty(this._resourceId());
    },

    /**
    @private

    The URL for this resource, based on `resourceUrl` and `_resourceId()` (which will be
      undefined for new resources).
  */
    _resourceUrl: function() {
        var url = this.resourceUrl,
            id = this._resourceId();

        if (!Ember.isEmpty(id)) url += '/' + id;

        return url;
    },

    /**
    @private

    The id for this resource.
  */
    _resourceId: function() {
        return this.get(this.resourceIdField);
    }
});

/**
  A controller for RESTful resources

  Extend this class and define the following:

  * `resourceType` -- an Ember.Resource class; the class must have a `serialize()` method
       that returns a JSON representation of the object
  * `resourceUrl` -- (optional) the base url of the resource (e.g. '/contacts/active');
       will default to the `resourceUrl` for `resourceType`
*/
Ember.ResourceController = Ember.ArrayController.extend(Ember.ResourceAdapter, {
    resourceType: Ember.required(),

    /**
    Create and load a single `Ember.Resource` from JSON
  */
    load: function(json) {
        var resource = this.get('resourceType').create().deserialize(json);
        this.pushObject(resource);
    },

    /**
    Create and load `Ember.Resource` objects from a JSON array
  */
    loadAll: function(json) {
        for (var i = 0; i < json.length; i++)
            this.load(json[i]);
    },

    /**
    Clear this controller's contents (without deleting remote resources)
    @param keepObjectsAlive if true, do NOT destroy the ember objects
  */
    clearAll: function(keepObjectsAlive) {
        if (!keepObjectsAlive) {
            var content = this.get('content');
            if (content) {
                content.forEach(function(resource) {
                    resource.destroy();
                });
            }
        }
        this.set("content", []);
    }.on('init'),

    /**
    Replace this controller's contents with an request to `url`
  */
    findAll: function() {
        var self = this;

        return this._resourceRequest({
            type: 'GET'
        }).then(function(json) {
            self.clearAll();
            self.loadAll(json);
            return self.get('content');
        });
    },

    /**
    @private

    Base URL for requests

    Will use the `resourceUrl` set for this controller, or if that's missing,
    the `resourceUrl` specified for `resourceType`.
  */
    _resourceUrl: function() {
        if (this.resourceUrl === undefined) {
            // If `resourceUrl` is not defined for this controller, there are a couple
            // ways to retrieve it from the resource. If a resource has been instantiated,
            // then it can be retrieved from the resource's prototype. Otherwise, we need
            // to loop through the mixins for the prototype to get the resourceUrl.
            var rt = this.get('resourceType');
            if (rt.prototype.resourceUrl === undefined) {
                for (var i = rt.PrototypeMixin.mixins.length - 1; i >= 0; i--) {
                    var m = rt.PrototypeMixin.mixins[i];
                    if (!Ember.isNone(m.properties) && m.properties.resourceUrl !== undefined) {
                        return m.properties.resourceUrl;
                    }
                }
            } else {
                return rt.prototype.resourceUrl;
            }
        }
        return this.resourceUrl;
    }
});