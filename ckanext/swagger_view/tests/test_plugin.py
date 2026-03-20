"""Tests for ckanext-swagger-view plugin helpers."""

from unittest.mock import patch, MagicMock

from ckanext.swagger_view.plugin import (
    swagger_view_hidden_fields,
    swagger_view_site_url,
    swagger_view_can_explore,
    swagger_view_spec_url,
)


class TestSwaggerViewHiddenFields:
    @patch("ckanext.swagger_view.plugin.toolkit")
    def test_returns_default(self, mock_toolkit):
        mock_toolkit.config.get.return_value = "_id"
        assert swagger_view_hidden_fields() == "_id"

    @patch("ckanext.swagger_view.plugin.toolkit")
    def test_returns_custom_config(self, mock_toolkit):
        mock_toolkit.config.get.return_value = "_id _full_text internal"
        result = swagger_view_hidden_fields()
        assert "_id" in result
        assert "_full_text" in result
        assert "internal" in result


class TestSwaggerViewSiteUrl:
    @patch("ckanext.swagger_view.plugin.toolkit")
    def test_returns_url_without_trailing_slash(self, mock_toolkit):
        mock_toolkit.config.get.return_value = "https://data.example.com/"
        assert swagger_view_site_url() == "https://data.example.com"

    @patch("ckanext.swagger_view.plugin.toolkit")
    def test_returns_url_as_is_when_no_slash(self, mock_toolkit):
        mock_toolkit.config.get.return_value = "https://data.example.com"
        assert swagger_view_site_url() == "https://data.example.com"

    @patch("ckanext.swagger_view.plugin.toolkit")
    def test_returns_empty_when_not_set(self, mock_toolkit):
        mock_toolkit.config.get.return_value = ""
        assert swagger_view_site_url() == ""


class TestSwaggerViewCanExplore:
    @patch("ckanext.swagger_view.plugin.toolkit")
    @patch("ckanext.swagger_view.plugin.plugins")
    def test_returns_true_when_authorized(self, mock_plugins, mock_toolkit):
        mock_plugins.plugin_loaded.return_value = True
        mock_toolkit.g.user = "test_user"
        mock_toolkit.check_access.return_value = True
        assert swagger_view_can_explore("res-123") is True

    @patch("ckanext.swagger_view.plugin.toolkit")
    @patch("ckanext.swagger_view.plugin.plugins")
    def test_returns_false_when_datastore_not_loaded(self, mock_plugins, mock_toolkit):
        mock_plugins.plugin_loaded.return_value = False
        assert swagger_view_can_explore("res-123") is False

    @patch("ckanext.swagger_view.plugin.toolkit")
    @patch("ckanext.swagger_view.plugin.plugins")
    def test_returns_false_when_not_authorized(self, mock_plugins, mock_toolkit):
        mock_plugins.plugin_loaded.return_value = True
        mock_toolkit.g.user = "test_user"
        mock_toolkit.NotAuthorized = type("NotAuthorized", (Exception,), {})
        mock_toolkit.ObjectNotFound = type("ObjectNotFound", (Exception,), {})
        mock_toolkit.check_access.side_effect = mock_toolkit.NotAuthorized()
        assert swagger_view_can_explore("res-123") is False


class TestSwaggerViewSpecUrl:
    @patch("ckanext.swagger_view.plugin.toolkit")
    @patch("ckanext.swagger_view.plugin.plugins")
    def test_returns_url_when_openapi_view_loaded(self, mock_plugins, mock_toolkit):
        mock_plugins.plugin_loaded.return_value = True
        mock_toolkit.config.get.return_value = "https://data.example.com"
        url = swagger_view_spec_url("abc-123")
        assert url == "https://data.example.com/api/3/action/resource_openapi/abc-123"

    @patch("ckanext.swagger_view.plugin.toolkit")
    @patch("ckanext.swagger_view.plugin.plugins")
    def test_returns_empty_when_openapi_view_not_loaded(self, mock_plugins, mock_toolkit):
        mock_plugins.plugin_loaded.return_value = False
        assert swagger_view_spec_url("abc-123") == ""
