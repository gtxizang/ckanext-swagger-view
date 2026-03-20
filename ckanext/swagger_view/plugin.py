import ckan.plugins as plugins
import ckan.plugins.toolkit as toolkit


class SwaggerViewPlugin(plugins.SingletonPlugin):
    plugins.implements(plugins.IConfigurer)
    plugins.implements(plugins.ITemplateHelpers)

    # IConfigurer

    def update_config(self, config):
        toolkit.add_template_directory(config, "templates")
        toolkit.add_public_directory(config, "public")
        toolkit.add_resource("public", "swagger_view")

    # ITemplateHelpers

    def get_helpers(self):
        return {
            "swagger_view_hidden_fields": swagger_view_hidden_fields,
            "swagger_view_site_url": swagger_view_site_url,
            "swagger_view_can_explore": swagger_view_can_explore,
            "swagger_view_spec_url": swagger_view_spec_url,
        }


def swagger_view_hidden_fields():
    """Return the hidden fields config as a string for the JS layer."""
    return toolkit.config.get(
        "ckanext.swagger_view.hidden_fields", "_id"
    )


def swagger_view_site_url():
    """Return the CKAN site URL with no trailing slash."""
    return toolkit.config.get("ckan.site_url", "").rstrip("/")


def swagger_view_can_explore(resource_id):
    """Check if the API Explorer button should be shown for a resource.

    Returns False (rather than crashing) when the DataStore plugin
    is not enabled or the user lacks access.
    """
    if not plugins.plugin_loaded("datastore"):
        return False
    try:
        context = {"user": toolkit.g.user}
        toolkit.check_access(
            "datastore_search", context, {"resource_id": resource_id}
        )
        return True
    except (toolkit.NotAuthorized, toolkit.ObjectNotFound):
        return False


def swagger_view_spec_url(resource_id):
    """Return the OpenAPI spec URL if ckanext-openapi-view is installed.

    Returns empty string if the openapi_view plugin is not loaded,
    allowing the JS layer to fall back to client-side introspection.
    """
    if not plugins.plugin_loaded("openapi_view"):
        return ""
    site_url = toolkit.config.get("ckan.site_url", "").rstrip("/")
    return "{}/api/3/action/resource_openapi/{}".format(site_url, resource_id)
