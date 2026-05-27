# Text Viewers

A REDCap External Module that adds live JSON and Markdown viewers for text-ish
fields on data entry forms and survey pages.

## Action tags

- `@JSON-VIEWER` renders text and Notes field values as JSON in Ace, reports
  invalid JSON, and lets editable fields update the raw REDCap value when the
  Ace content is valid JSON.
- `@MARKDOWN-VIEWER` renders Notes field values as Markdown using the bundled
  `marked` asset.

### JSON parameters

`@JSON-VIEWER` accepts a quoted, comma-separated parameter list:

- `@JSON-VIEWER="initial:json"` opens the field in JSON mode.
- `@JSON-VIEWER="initial:raw"` opens the field in Raw mode. This is the default
  when no parameter is provided.
- `@JSON-VIEWER="height:200"` sets the initial Ace editor height in pixels.
- `@JSON-VIEWER="format:pretty"` stores valid JSON with two-space indentation.
- `@JSON-VIEWER="format:compact"` stores valid JSON without whitespace. Text
  fields always use compact formatting because they do not support newlines.
- `@JSON-VIEWER="json-only"` opens in JSON mode and hides the Raw tab. This
  takes precedence over `initial:*` parameters.

### Markdown parameters

`@MARKDOWN-VIEWER` accepts a quoted, comma-separated parameter list:

- `@MARKDOWN-VIEWER="initial:md"` opens the field in Markdown mode.
- `@MARKDOWN-VIEWER="initial:raw"` opens the field in Raw mode. This is the
  default when no parameter is provided.
- `@MARKDOWN-VIEWER="height:200"` sets the initial Markdown viewer height in
  pixels.
- `@MARKDOWN-VIEWER="md-only"` opens in Markdown mode and hides the Raw tab.
  This takes precedence over `initial:*` parameters.

There is intentionally no `raw-only` option; omit the action tag when Markdown
viewing should not be available.
