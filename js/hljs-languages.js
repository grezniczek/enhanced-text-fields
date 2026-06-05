/* hljs-languages.js */
(function () {
  if (typeof hljs === 'undefined') {
    console.warn('highlight.js not loaded before hljs-languages.js');
    return;
  }

  function rcCommon(hljs) {
    const COMMENT_LINE = hljs.COMMENT(/(^|\s)#.*$/, /$/);      // # comment
    const COMMENT_SLASH = hljs.COMMENT(/(^|\s)\/\/.*$/, /$/);  // // comment

    return {
      // Common fragments we can reuse via `contains: [...]`
      contains: [
        COMMENT_LINE,
        COMMENT_SLASH,
        hljs.QUOTE_STRING_MODE,               // "..."
        hljs.APOS_STRING_MODE,                // '...'
        hljs.C_NUMBER_MODE,                   // 123, 1.23, 1e5
        {
          className: 'variable',
          begin: /\[[^\]\n]+\]/,              // [field] / [smart-var:...]
        },
      ],
    };
  }

  // 1) rclogic: REDCap branching/calc-like logic (very rough stub)
  hljs.registerLanguage('rclogic', function (hljs) {
    const common = rcCommon(hljs);

    return {
      name: 'REDCap Logic (stub)',
      aliases: ['redcap-logic', 'rc-logic'],
      keywords: {
        keyword: 'and or if',
        literal: 'true false',
        built_in:
          'round roundup rounddown sqrt abs exponential min max mean median mod sum stdev log ' +
          'isnumber isinteger year month day contains not_contain starts_with ends_with left right length ' +
          'find replace_text mid concat concat_ws upper lower trim datediff isblankormissingcode',
      },
      contains: [
        ...common.contains,
        {
          className: 'function',
          begin: /\b[a-zA-Z_][a-zA-Z0-9_]*\s*(?=\()/, // foo(
        },
        {
          className: 'operator',
          begin: /!=|>=|<=|=|\+|-|\*|\/|\^|!/,
        },
      ],
    };
  });

  // 2) rccalc: treat similarly for now; separate name so fences work
  hljs.registerLanguage('rccalc', function (hljs) {
    // For now, same stub as logic; you can diverge later (e.g., emphasize math).
    const base = hljs.getLanguage('rclogic');
    return base ? base : hljs.registerLanguage('rclogic', () => ({}));
  });

  // 3) rcannotation: usually key/value-ish; make it a “light” lexer
  hljs.registerLanguage('rcannotation', function (hljs) {
    return {
      name: 'REDCap Annotation (stub)',
      aliases: ['rc-annotation'],
      contains: [
        hljs.COMMENT(/(^|\s)#.*$/, /$/),
        hljs.COMMENT(/(^|\s)\/\/.*$/, /$/),
        hljs.QUOTE_STRING_MODE,
        hljs.APOS_STRING_MODE,
        hljs.C_NUMBER_MODE,
        {
          className: 'attribute',
          begin: /@[\w-]+/,                     // @SOMETHING, @INLINE, @HIDDEN...
        },
        {
          className: 'meta',
          begin: /(?:^|\s)[a-zA-Z_][\w-]*\s*:/,  // key:
        },
        {
          className: 'variable',
          begin: /\[[^\]\n]+\]/,
        },
      ],
    };
  });
})();
