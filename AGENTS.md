# Coding Rules

## PHP

- Avoid chaining function calls for functions that return complex results, i.e., do write:
  ```php
  return function_a(function_b(function_c($some_args)));
  ```
  Instead, assign results to variables first, then pass the variables. This helps debugging a ton, and can still be optimized once code is stable.

- Always add PHPDoc blocks to all functions and variables (except for const declarations - only add if necessary, e.g., when the constant name is not self-explanatory).
- For complex operations or operations that are not immediately evident, add concise comments, but do not litter with comments.
- When outputting HTML, prefer
  ```php
  ?>
  <div>
    <what-ever />
  </div>
  <?php
  ```
  over `print '<div>...</div>';` so that at least humans using a code editor can benefit from syntax highlighting.

## JS

- For any reasonably complex JS to be delivered to the client, prefer to do so in a JS file.
- In JS files, avoid to litter the global scope. Wrap stuff in an IEFE and expose only a minimal public interface (usually for taking initial config, or to expose public hooks or methods).
- jQuery is available in REDCap. Prefer using it over direct DOM manipulation (unless trivial or necessary).
- Make use of ConsoleDebugLogger.js and the javascript-debug project setting to output useful debug info to the console, e.g. to show initial config, or results of complex-ish operations.


## External Module Framework

- Documentation can be found here: https://github.com/vanderbilt-redcap/external-module-framework-docs/blob/main/README.md (start navigating here)

- If peeking into code is necessary, ask first and then look here: \\wsl.localhost\Ubuntu\home\gr\redcap\external_modules

- Class autoloading is not available automatically for this module. Add or maintain a small module-local autoloader, or explicitly include/require helper classes before using them.

# Environment

- The repo is in WSL/Ubuntu: \\wsl.localhost\Ubuntu\home\gr\redcap\dev-modules\text_viewers_v9.9.9\
- Use php and node from WSL for tests etc.
- Suggest to install tools if needed.

# Workflow

- For each completed work slice, suggest a concise commit message.
