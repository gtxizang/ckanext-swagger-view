"""Integration tests against a live CKAN 2.11 instance.

Run with: pytest tests/test_integration.py -v -m integration
Requires: CKAN at http://localhost:5050 with swagger_view and
          openapi_view enabled, and at least one DataStore resource.

Skipped automatically if CKAN is not reachable.
"""

import json
import urllib.request
import urllib.error

import pytest

CKAN_URL = "http://localhost:5050"


def _get(url):
    """Make a GET request and return (body_string, status, headers)."""
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode(), resp.status, dict(resp.headers)


def _api_get(path):
    """Make a GET request to the CKAN API."""
    url = f"{CKAN_URL}{path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read()), resp.status


def _ckan_available():
    try:
        _api_get("/api/action/status_show")
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def datastore_resource():
    """Find the first DataStore-active resource."""
    try:
        data, _ = _api_get("/api/action/package_list")
        for pkg_name in data["result"]:
            pkg_data, _ = _api_get(f"/api/action/package_show?id={pkg_name}")
            for res in pkg_data["result"]["resources"]:
                if res.get("datastore_active"):
                    return {
                        "resource_id": res["id"],
                        "dataset_name": pkg_data["result"]["name"],
                        "dataset_id": pkg_data["result"]["id"],
                    }
    except Exception:
        pass
    pytest.skip("No DataStore resources found")


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not _ckan_available(), reason=f"CKAN not available at {CKAN_URL}"),
]


class TestApiExplorerButton:
    """Verify the API Explorer button renders on DataStore resource pages."""

    def test_button_present_on_datastore_resource(self, datastore_resource):
        url = (
            f"{CKAN_URL}/dataset/{datastore_resource['dataset_name']}"
            f"/resource/{datastore_resource['resource_id']}"
        )
        body, status, _ = _get(url)
        assert status == 200
        assert "API Explorer" in body
        assert 'data-module="swagger-explorer"' in body

    def test_button_has_required_data_attributes(self, datastore_resource):
        url = (
            f"{CKAN_URL}/dataset/{datastore_resource['dataset_name']}"
            f"/resource/{datastore_resource['resource_id']}"
        )
        body, _, _ = _get(url)
        assert "data-module-resource-id" in body
        assert "data-module-base-url" in body
        assert "data-module-hidden-fields" in body

    def test_button_has_spec_url_when_openapi_view_loaded(self, datastore_resource):
        """When openapi_view is also loaded, the button should include a spec URL."""
        url = (
            f"{CKAN_URL}/dataset/{datastore_resource['dataset_name']}"
            f"/resource/{datastore_resource['resource_id']}"
        )
        body, _, _ = _get(url)
        assert "data-module-spec-url" in body
        # The spec URL should point to the openapi-view endpoint
        assert "resource_openapi" in body

    def test_modal_container_present(self, datastore_resource):
        url = (
            f"{CKAN_URL}/dataset/{datastore_resource['dataset_name']}"
            f"/resource/{datastore_resource['resource_id']}"
        )
        body, _, _ = _get(url)
        assert 'id="swagger-explorer-modal"' in body
        assert 'id="swagger-explorer-ui"' in body


class TestSwaggerAssets:
    """Verify that JS and CSS assets are served."""

    def test_swagger_explorer_css_loaded(self, datastore_resource):
        url = (
            f"{CKAN_URL}/dataset/{datastore_resource['dataset_name']}"
            f"/resource/{datastore_resource['resource_id']}"
        )
        body, _, _ = _get(url)
        # The webassets bundle should produce a CSS link
        assert "swagger-explorer" in body

    def test_swagger_explorer_js_loaded(self, datastore_resource):
        url = (
            f"{CKAN_URL}/dataset/{datastore_resource['dataset_name']}"
            f"/resource/{datastore_resource['resource_id']}"
        )
        body, _, _ = _get(url)
        # The webassets bundle should produce a JS script tag
        assert "swagger-explorer" in body


class TestOpenApiViewIntegration:
    """Verify that when openapi_view is loaded, swagger_view can fetch specs."""

    def test_openapi_spec_accessible_for_resource(self, datastore_resource):
        """The server-side spec that swagger_view would fetch should be available."""
        data, status = _api_get(
            f"/api/3/action/resource_openapi/{datastore_resource['resource_id']}"
        )
        assert status == 200
        assert data["success"] is True
        spec = data["result"]
        assert spec["openapi"] == "3.1.0"
