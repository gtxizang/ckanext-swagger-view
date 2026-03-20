/* swagger-explorer.js — CKAN module for Swagger API Explorer modal */

this.ckan.module("swagger-explorer", function ($) {
  "use strict";

  /* ================================================================
     1. SECURITY HELPERS
     ================================================================ */

  function escapeMarkdown(str) {
    if (str === null || str === undefined) return "";
    var s = String(str);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/`/g, "&#x60;")
      .replace(/\|/g, "&#124;")
      .replace(/\[/g, "&#91;")
      .replace(/\]/g, "&#93;")
      .replace(/\(/g, "&#40;")
      .replace(/\)/g, "&#41;")
      .replace(/\\/g, "&#92;")
      .replace(/\n/g, " ")
      .replace(/\r/g, "");
  }

  function safeSqlIdentifier(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function truncate(str, maxLen) {
    if (str === null || str === undefined) return "";
    var s = String(str);
    return s.length > maxLen ? s.substring(0, maxLen) + "\u2026" : s;
  }

  var MAX_FIELD_NAME_LEN = 100;
  var MAX_VALUE_LEN = 200;
  var MAX_INTROSPECT_FIELDS = 50;
  var MAX_CONCURRENT_SQL = 5;

  /* ================================================================
     2. CKAN API CLIENT (same-origin, session cookie auth)
     ================================================================ */

  /**
   * Read the CSRF token from the page meta tag (CKAN 2.10+).
   * Returns empty string on CKAN 2.9 where no token exists.
   */
  function getCsrfToken() {
    var meta = document.querySelector('meta[name="_csrf_token"]');
    return meta ? meta.getAttribute("content") : "";
  }

  function ckanGet(baseUrl, path) {
    return fetch(baseUrl + path, { credentials: "same-origin" })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json().then(function (data) {
          return data.success ? data.result : null;
        });
      });
  }

  function ckanSql(baseUrl, sql) {
    var headers = { "Content-Type": "application/json" };
    var token = getCsrfToken();
    if (token) headers["X-CSRFToken"] = token;

    return fetch(baseUrl + "/api/action/datastore_search_sql", {
      method: "POST",
      headers: headers,
      credentials: "same-origin",
      body: JSON.stringify({ sql: sql })
    })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json().then(function (data) {
          return data.success ? data.result : null;
        });
      })
      .catch(function () {
        return null;
      });
  }

  /* ================================================================
     3. DEEP INTROSPECTION
     ================================================================ */

  function runWithConcurrency(tasks, limit) {
    var results = [];
    var index = 0;
    function next() {
      var i = index++;
      if (i >= tasks.length) return Promise.resolve();
      return tasks[i]().then(function (result) {
        results[i] = result;
        return next();
      });
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, tasks.length); w++) {
      workers.push(next());
    }
    return Promise.all(workers).then(function () {
      return results;
    });
  }

  function deepIntrospect(baseUrl, resourceId, onProgress) {
    var tableName = safeSqlIdentifier(resourceId);

    if (onProgress) onProgress("Fetching schema metadata...");

    return Promise.all([
      ckanGet(baseUrl, "/api/action/datastore_search?resource_id=" + encodeURIComponent(resourceId) + "&limit=0"),
      ckanGet(baseUrl, "/api/action/datastore_search?resource_id=" + encodeURIComponent(resourceId) + "&limit=5")
    ]).then(function (results) {
      var metaResult = results[0];
      var sampleResult = results[1];

      if (!metaResult || !metaResult.fields) return null;

      var fields = metaResult.fields;
      var totalRecords = metaResult.total || 0;
      var sampleRecords = (sampleResult && sampleResult.records) || [];

      var SAFE_FIELD_RE = /^[a-zA-Z0-9_\- .,]+$/;
      var safeFields = fields.filter(function (f) {
        return SAFE_FIELD_RE.test(f.id) && f.id.length <= MAX_FIELD_NAME_LEN;
      });

      var textFields = safeFields.filter(function (f) {
        return f.type === "text" || f.type === "varchar" || f.type === "name";
      }).slice(0, MAX_INTROSPECT_FIELDS);

      var numericFields = safeFields.filter(function (f) {
        return ["int", "int4", "int8", "float8", "numeric", "timestamp"].indexOf(f.type) !== -1;
      }).slice(0, MAX_INTROSPECT_FIELDS);

      var enumData = {};
      var rangeData = {};
      var completed = 0;
      var totalQueries = textFields.length + numericFields.length;

      var enumTasks = textFields.map(function (f) {
        return function () {
          var safeId = safeSqlIdentifier(f.id);
          var sql = "SELECT DISTINCT " + safeId + " FROM " + tableName +
            " WHERE " + safeId + " IS NOT NULL ORDER BY " + safeId + " LIMIT 51";
          return ckanSql(baseUrl, sql).then(function (result) {
            if (result && result.records) {
              var values = result.records
                .map(function (r) { return truncate(r[f.id], MAX_VALUE_LEN); })
                .filter(function (v) { return v !== null && v !== ""; });
              enumData[f.id] = {
                values: values.slice(0, 50),
                isEnum: values.length <= 25,
                distinctCount: values.length >= 51 ? "50+" : values.length
              };
            }
            completed++;
            if (onProgress) onProgress("Introspecting fields... (" + completed + "/" + totalQueries + ")");
          });
        };
      });

      var rangeTasks = numericFields.map(function (f) {
        return function () {
          var safeId = safeSqlIdentifier(f.id);
          var sql = "SELECT MIN(" + safeId + ") as min_val, MAX(" + safeId +
            ") as max_val FROM " + tableName + " WHERE " + safeId + " IS NOT NULL";
          return ckanSql(baseUrl, sql).then(function (result) {
            if (result && result.records && result.records[0]) {
              rangeData[f.id] = {
                min: result.records[0].min_val,
                max: result.records[0].max_val
              };
            }
            completed++;
            if (onProgress) onProgress("Introspecting fields... (" + completed + "/" + totalQueries + ")");
          });
        };
      });

      return runWithConcurrency(enumTasks.concat(rangeTasks), MAX_CONCURRENT_SQL).then(function () {
        var enrichedFields = fields.map(function (f) {
          var enriched = {
            id: f.id,
            type: f.type,
            sample: sampleRecords.length > 0 ? sampleRecords[0][f.id] : null,
            samples: sampleRecords.map(function (r) { return r[f.id]; }).filter(function (v) { return v !== null; })
          };
          if (enumData[f.id]) {
            enriched.distinctCount = enumData[f.id].distinctCount;
            enriched.isEnum = enumData[f.id].isEnum;
            enriched.enumValues = enumData[f.id].values;
          }
          if (rangeData[f.id]) {
            enriched.min = rangeData[f.id].min;
            enriched.max = rangeData[f.id].max;
          }
          return enriched;
        });

        return {
          fields: enrichedFields,
          totalRecords: totalRecords,
          sampleRecords: sampleRecords
        };
      });
    });
  }

  /* ================================================================
     4. OPENAPI SPEC GENERATOR
     ================================================================ */

  function buildOpenApiSpec(resourceId, baseUrl, datasetName, introspection, hiddenFieldsList) {
    var allFields = (introspection && introspection.fields) || [];
    var totalRecords = (introspection && introspection.totalRecords) || 0;

    var hiddenFields = {};
    (hiddenFieldsList || ["_id"]).forEach(function (f) { hiddenFields[f] = true; });
    var userFields = allFields.filter(function (f) { return !hiddenFields[f.id]; });
    var fieldNames = userFields.map(function (f) { return f.id; });

    var enumFields = userFields.filter(function (f) {
      return f.isEnum && f.enumValues && f.enumValues.length > 1;
    });

    // info.title is rendered as text by Swagger UI (not HTML), so use raw name.
    // info.description is rendered as markdown, so escape there.
    var safeDatasetName = escapeMarkdown(datasetName);

    // --- Info description with Data Dictionary ---
    var infoDesc = "**Dataset:** " + safeDatasetName + "\n\n";
    infoDesc += "**Source:** [" + escapeMarkdown(baseUrl) + "](" + encodeURI(baseUrl) + ")\n\n";
    if (totalRecords) infoDesc += "**Total records:** " + totalRecords.toLocaleString() + "\n\n";

    if (allFields.length > 0) {
      infoDesc += "#### Data Dictionary (" + allFields.length + " fields)\n\n";
      infoDesc += "| Field | Type | Details |\n|---|---|---|\n";
      allFields.forEach(function (f) {
        var safeId = escapeMarkdown(truncate(f.id, MAX_FIELD_NAME_LEN));
        var safeType = escapeMarkdown(f.type);
        var details = "";
        if (f.isEnum && f.enumValues) {
          var safeVals = f.enumValues.map(function (v) { return escapeMarkdown(truncate(v, MAX_VALUE_LEN)); });
          details = "Values: " + safeVals.join(", ");
        } else if (f.min !== undefined) {
          details = "Range: " + escapeMarkdown(String(f.min)) + " \u2014 " + escapeMarkdown(String(f.max));
        } else if (f.distinctCount) {
          details = escapeMarkdown(String(f.distinctCount)) + " distinct values";
        }
        if (f.sample !== null && f.sample !== undefined && !f.isEnum) {
          var safeSample = escapeMarkdown(truncate(f.sample, MAX_VALUE_LEN));
          details += details ? ". Sample: " + safeSample : "Sample: " + safeSample;
        }
        infoDesc += "| " + safeId + " | " + safeType + " | " + details + " |\n";
      });
      infoDesc += "\n";
    }

    // --- Enum filter params ---
    var enumFilterParams = enumFields.map(function (f) {
      return {
        name: "filter_" + f.id,
        "in": "query",
        required: false,
        schema: { type: "string", "enum": f.enumValues.map(function (v) { return truncate(v, MAX_VALUE_LEN); }) },
        description: "Filter by " + escapeMarkdown(f.id) + " (" + f.enumValues.length + " values)"
      };
    });

    var safeFieldNames = fieldNames.map(function (n) { return escapeMarkdown(n); });
    var sortDesc = safeFieldNames.length
      ? 'Sort string. Fields: ' + safeFieldNames.join(", ") + '. e.g. "' + safeFieldNames[0] + ' asc"'
      : 'e.g. "field_name asc"';

    var fieldsDesc = safeFieldNames.length
      ? "Comma-separated fields to return. Available: " + safeFieldNames.join(", ")
      : "Comma-separated field names to return";

    // --- The spec ---
    return {
      openapi: "3.1.0",
      info: {
        title: datasetName,
        description: infoDesc,
        version: "1.0.0"
      },
      servers: [{ url: baseUrl }],
      paths: {
        "/api/action/datastore_search": {
          get: {
            operationId: "datastoreSearchGet",
            summary: "Search DataStore",
            description: "Query with filters, full-text search, sorting, and pagination. Total records: **" + totalRecords.toLocaleString() + "**",
            parameters: [
              { name: "q", "in": "query", schema: { type: "string" }, description: "Full-text search across all fields" }
            ].concat(enumFilterParams).concat([
              { name: "limit", "in": "query", schema: { type: "integer", "default": 10, maximum: 32000 }, description: "Max rows to return (max 32,000)" },
              { name: "offset", "in": "query", schema: { type: "integer", "default": 0 }, description: "Number of rows to skip" },
              { name: "fields", "in": "query", schema: { type: "string" }, description: fieldsDesc },
              { name: "sort", "in": "query", schema: { type: "string" }, description: sortDesc }
            ]),
            responses: { "200": { description: "Success", content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResponse" } } } } }
          }
        }
      },
      components: {
        schemas: {
          SearchResponse: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              result: {
                type: "object",
                properties: {
                  records: { type: "array", items: { type: "object" }, description: "Row objects" },
                  fields: { type: "array", items: { type: "object" }, description: "Field metadata" },
                  total: { type: "integer" },
                  limit: { type: "integer" },
                  offset: { type: "integer" },
                  _links: { type: "object" }
                }
              }
            }
          }
        }
      }
    };
  }

  /* ================================================================
     5. REQUEST INTERCEPTOR
     ================================================================ */

  function makeRequestInterceptor(resourceId) {
    return function (req) {
      // Ensure session cookies are sent for private datasets
      req.credentials = "same-origin";

      // Inject CSRF token for POST requests (CKAN 2.10+)
      if (req.method === "POST") {
        var token = getCsrfToken();
        if (token) {
          if (!req.headers) req.headers = {};
          req.headers["X-CSRFToken"] = token;
        }
      }

      // Only intercept datastore_search GET requests
      if (req.method === "GET" && req.url.indexOf("/api/action/datastore_search") !== -1 && req.url.indexOf("datastore_search_sql") === -1) {
        var u = new URL(req.url);

        // Inject resource_id
        if (!u.searchParams.has("resource_id")) {
          u.searchParams.set("resource_id", resourceId);
        }

        // Convert filter_* params to CKAN filters JSON
        var filters = {};
        var paramsToRemove = [];
        u.searchParams.forEach(function (val, key) {
          if (key.indexOf("filter_") === 0 && val) {
            filters[key.substring(7)] = val;
            paramsToRemove.push(key);
          }
        });
        paramsToRemove.forEach(function (k) { u.searchParams.delete(k); });
        if (Object.keys(filters).length > 0) {
          u.searchParams.set("filters", JSON.stringify(filters));
        }

        req.url = u.toString();
      }

      return req;
    };
  }

  /* ================================================================
     6. MODAL HELPERS
     ================================================================ */

  function setModalStatus(text, type) {
    var el = document.getElementById("swagger-explorer-status");
    if (!el) return;
    el.textContent = text;
    el.className = "swagger-explorer-status" + (type ? " " + type : "");
  }

  /**
   * Get all focusable elements inside a container.
   */
  function getFocusableElements(container) {
    var selectors = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(container.querySelectorAll(selectors));
  }

  /* ================================================================
     7. CKAN MODULE
     ================================================================ */

  return {
    options: {
      resourceId: "",
      baseUrl: "",
      datasetName: "",
      hiddenFields: "_id",
      specUrl: ""
    },

    _loading: false,
    _swaggerInstance: null,
    _triggerEl: null,
    _boundKeyHandler: null,
    _boundFocusTrap: null,

    initialize: function () {
      this._triggerEl = this.el[0];
      this.el.on("click", this._onButtonClick.bind(this));
    },

    teardown: function () {
      this._closeModal();
    },

    _onButtonClick: function (e) {
      e.preventDefault();
      if (this._loading) return;
      this._openExplorer();
    },

    _openExplorer: function () {
      var self = this;
      var modal = document.getElementById("swagger-explorer-modal");
      var container = document.getElementById("swagger-explorer-ui");
      if (!modal || !container) return;

      var baseUrl = this.options.baseUrl;
      var resourceId = this.options.resourceId;
      var datasetName = this.options.datasetName;

      // Validate baseUrl
      if (!/^https?:\/\//.test(baseUrl)) {
        console.error("swagger-explorer: invalid baseUrl", baseUrl);
        return;
      }

      // Parse hidden fields
      var hiddenFields = (this.options.hiddenFields || "_id")
        .split(/[\s,]+/)
        .filter(function (s) { return s.length > 0; });

      // Show modal
      this._loading = true;
      modal.style.display = "block";
      document.body.style.overflow = "hidden";
      container.innerHTML = "";
      setModalStatus("Connecting...", "loading");

      // Focus management: move focus into modal
      var closeBtn = modal.querySelector(".swagger-explorer-close");
      if (closeBtn) closeBtn.focus();

      // Keyboard: Escape to close
      this._boundKeyHandler = function (e) {
        if (e.key === "Escape") {
          self._closeModal();
        }
      };
      document.addEventListener("keydown", this._boundKeyHandler);

      // Focus trap
      this._boundFocusTrap = function (e) {
        if (e.key !== "Tab") return;
        var focusable = getFocusableElements(modal);
        if (focusable.length === 0) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      modal.addEventListener("keydown", this._boundFocusTrap);

      // Close button
      if (closeBtn) {
        closeBtn.onclick = function () { self._closeModal(); };
      }

      // Close on overlay click
      modal.onclick = function (e) {
        if (e.target === modal) self._closeModal();
      };

      // Render a spec into Swagger UI
      function renderSpec(spec) {
        if (modal.style.display === "none") return;
        setModalStatus("", "");
        self._destroySwaggerUI();
        self._swaggerInstance = SwaggerUIBundle({
          spec: spec,
          domNode: container,
          presets: [SwaggerUIBundle.presets.apis],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "BaseLayout",
          tryItOutEnabled: true,
          docExpansion: "list",
          defaultModelsExpandDepth: 0,
          requestInterceptor: makeRequestInterceptor(resourceId)
        });
        self._loading = false;
      }

      // Client-side introspection fallback (original flow)
      function clientSideFallback() {
        fetch(baseUrl + "/api/action/datastore_search?resource_id=" + encodeURIComponent(resourceId) + "&limit=0", {
          credentials: "same-origin"
        })
          .then(function (testResp) {
            if (!testResp.ok) {
              if (testResp.status === 401 || testResp.status === 403) {
                setModalStatus("Authentication required or access denied.", "error");
              } else {
                setModalStatus("CKAN API returned HTTP " + testResp.status, "error");
              }
              self._loading = false;
              return;
            }

            return deepIntrospect(baseUrl, resourceId, function (msg) {
              setModalStatus(msg, "loading");
            }).then(function (introspection) {
              if (modal.style.display === "none") return;
              if (!introspection) {
                setModalStatus("Could not introspect this resource. DataStore may not be enabled.", "error");
                self._loading = false;
                return;
              }
              renderSpec(buildOpenApiSpec(resourceId, baseUrl, datasetName, introspection, hiddenFields));
            });
          })
          .catch(function (err) {
            console.error("swagger-explorer:", err);
            setModalStatus("An error occurred while loading the API Explorer.", "error");
            self._loading = false;
          });
      }

      // Try server-side spec first (ckanext-openapi-view), fall back to client-side
      var specUrl = this.options.specUrl;
      if (specUrl && /^https?:\/\//.test(specUrl)) {
        // Verify the spec URL is same-origin as baseUrl to prevent
        // a tampered attribute from fetching from an attacker's server.
        try {
          if (new URL(specUrl).origin !== new URL(baseUrl).origin) {
            console.error("swagger-explorer: specUrl origin does not match baseUrl");
            clientSideFallback();
            return;
          }
        } catch (urlErr) {
          clientSideFallback();
          return;
        }

        setModalStatus("Loading API spec...", "loading");
        fetch(specUrl, { credentials: "same-origin" })
          .then(function (resp) {
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            return resp.json();
          })
          .then(function (data) {
            if (data.success && data.result && typeof data.result === "object" && data.result.openapi) {
              // Verify the spec's server URL matches our baseUrl
              var servers = data.result.servers;
              if (servers && servers[0] && servers[0].url !== baseUrl) {
                console.warn("swagger-explorer: spec server URL mismatch, rejecting");
                throw new Error("Server URL mismatch");
              }
              renderSpec(data.result);
            } else {
              throw new Error("Invalid spec response");
            }
          })
          .catch(function (fetchErr) {
            // Server-side spec failed — fall back to client-side introspection.
            // This is logged (not silent) so operators can investigate.
            console.warn("swagger-explorer: server spec failed, using client-side introspection", fetchErr);
            setModalStatus("Connecting...", "loading");
            clientSideFallback();
          });
      } else {
        clientSideFallback();
      }
    },

    _destroySwaggerUI: function () {
      if (this._swaggerInstance) {
        // SwaggerUI does not expose a clean destroy method,
        // but nullifying the reference allows GC
        this._swaggerInstance = null;
      }
      var container = document.getElementById("swagger-explorer-ui");
      if (container) container.innerHTML = "";
    },

    _closeModal: function () {
      var modal = document.getElementById("swagger-explorer-modal");
      if (modal) modal.style.display = "none";
      document.body.style.overflow = "";
      this._loading = false;

      // Clean up Swagger UI
      this._destroySwaggerUI();

      // Clean up event listeners
      if (this._boundKeyHandler) {
        document.removeEventListener("keydown", this._boundKeyHandler);
        this._boundKeyHandler = null;
      }
      if (this._boundFocusTrap && modal) {
        modal.removeEventListener("keydown", this._boundFocusTrap);
        this._boundFocusTrap = null;
      }

      // Return focus to trigger button
      if (this._triggerEl) {
        this._triggerEl.focus();
      }
    }
  };
});
