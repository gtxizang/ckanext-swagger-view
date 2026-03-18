# ckanext-swagger-view

A CKAN extension that adds an **API Explorer** button to DataStore resource pages. Clicking it opens a modal overlay with a Swagger UI interface for interactively querying the resource's DataStore API.

## Features

- **API Explorer modal** on every DataStore resource page (mirrors the "Data API" button UX pattern)
- **Deep introspection** — automatically detects enums, ranges, and generates SQL examples
- **Data Dictionary** — displays field metadata with types, sample values, and distinct counts
- **No external dependencies** — Swagger UI vendor files are bundled
- **Session cookie auth** — inherits the logged-in user's CKAN session automatically
- **Accessible** — keyboard navigable (Escape to close), focus trap, ARIA attributes
- **CKAN-native** — uses `ckan.module()` pattern, webassets, `ITemplateHelpers`

## Requirements

- CKAN 2.9, 2.10, or 2.11 (tested with Bootstrap 3 and 5)
- DataStore extension enabled

## Installation

1. Install the extension:

   ```bash
   cd /path/to/ckanext-swagger-view
   pip install -e .
   ```

2. Add `swagger_view` to the plugins list in your `ckan.ini`:

   ```ini
   ckan.plugins = ... swagger_view
   ```

3. (Optional) Configure hidden fields:

   ```ini
   ckanext.swagger_view.hidden_fields = _id soda_hashbyte soda_identity
   ```

   Default: `_id`

4. Restart CKAN.

## Usage

1. Navigate to any DataStore resource page
2. Click the **API Explorer** button in the resource actions bar
3. The modal opens with Swagger UI — expand endpoints and click "Try it out" to execute queries
4. Press **Escape** or click the overlay background to close

## Configuration

| Setting | Default | Description |
|---|---|---|
| `ckanext.swagger_view.hidden_fields` | `_id` | Space-separated list of field names to hide from the API spec |

## Architecture

| Component | Pattern |
|---|---|
| Plugin | `IConfigurer` + `ITemplateHelpers` |
| Template | `{% ckan_extends %}` on `package/resource_read.html` |
| Assets | webassets bundles via `{% asset %}` |
| JavaScript | `ckan.module("swagger-explorer")` with `data-module` attributes |
| Auth | Same-origin session cookies with CSRF token support (2.10+) |
| Config | Template helpers expose `ckan.ini` values to the JS layer |

## License

MIT
