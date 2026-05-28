# Enhanced Text Fields

A REDCap External Module that enhances REDCap text fields with editing,
validation, formatting, and preview tools for text-based content types.

## Action tags

- `@ENHANCED-TEXT-JSON` enhances text and Notes field values with a JSON editor,
  validation feedback, and configurable storage formatting.
- `@ENHANCED-TEXT-MARKDOWN` enhances Notes field values with Raw, Markdown
  editor, and rendered HTML preview modes.

### JSON parameters

`@ENHANCED-TEXT-JSON` accepts a quoted, comma-separated parameter list:

- `@ENHANCED-TEXT-JSON="initial:json"` opens the field in JSON mode.
- `@ENHANCED-TEXT-JSON="initial:raw"` opens the field in Raw mode. This is the
  default when no parameter is provided.
- `@ENHANCED-TEXT-JSON="height:200"` sets the initial editor height in pixels.
- `@ENHANCED-TEXT-JSON="format:pretty"` stores valid JSON with two-space
  indentation.
- `@ENHANCED-TEXT-JSON="format:compact"` stores valid JSON without whitespace.
  Text fields always use compact formatting because they do not support
  newlines.
- `@ENHANCED-TEXT-JSON="json-only"` opens in JSON mode and hides the Raw tab.
  This takes precedence over `initial:*` parameters.

### Markdown parameters

`@ENHANCED-TEXT-MARKDOWN` accepts a quoted, comma-separated parameter list:

- `@ENHANCED-TEXT-MARKDOWN="initial:md"` opens the field in Markdown editor
  mode.
- `@ENHANCED-TEXT-MARKDOWN="initial:html"` opens the field in rendered HTML
  preview mode.
- `@ENHANCED-TEXT-MARKDOWN="initial:raw"` opens the field in Raw mode. This is
  the default when no parameter is provided.
- `@ENHANCED-TEXT-MARKDOWN="height:200"` sets the initial editor or preview
  height in pixels.
- `@ENHANCED-TEXT-MARKDOWN="md-only"` hides the Raw tab. This takes precedence
  over `initial:*` parameters.

There is intentionally no `raw-only` option; omit the action tag when Markdown
editing and preview should not be available.

## Future file fields

File upload fields may later support an `@ENHANCED-TEXT-AUTO` action tag that
selects an enhancement mode from the uploaded file extension or detected text
type. This is intentionally not implemented yet.
