# Text Viewers

A REDCap External Module that adds live JSON and Markdown viewers for text-ish
fields on data entry forms and survey pages.

## Action tags

- `@JSON-VIEWER` renders the field value as pretty-printed JSON in a read-only
  Ace viewer and reports invalid JSON.
- `@MARKDOWN-VIEWER` renders Notes field values as Markdown using the bundled
  `marked` asset.

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
