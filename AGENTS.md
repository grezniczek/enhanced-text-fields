# AGENTS.md

## Purpose

This repository is a REDCap External Module. Prefer small, reviewable changes that fit REDCap/External Module conventions and remain easy to debug in a WSL-based development setup.

## Working Rules

* Before changing code, inspect the relevant files and briefly state the intended approach.
* Prefer minimal, targeted changes over broad refactors unless refactoring is explicitly requested.
* Do not install packages, change global tooling, or modify unrelated files without approval.
* For each completed work slice, suggest a concise commit message.

## PHP Conventions

* Avoid deeply nested/chained calls when the intermediate result is non-trivial. Assign intermediate values to named variables to aid debugging.
* Add PHPDoc for classes, methods, public/protected properties, non-obvious array shapes, and mixed/structured values. Do not add noisy PHPDoc for every obvious local variable.
* Add concise comments for complex or non-obvious logic, but avoid restating what the code already says.
* When outputting substantial HTML from PHP, prefer leaving PHP mode and writing HTML directly instead of constructing large HTML strings with `print`/concatenation.

## JavaScript Conventions

* Put reasonably complex client-side JavaScript in a `.js` file rather than inline PHP-generated script blocks.
* Avoid polluting the global scope. Use an IIFE/module pattern and expose only the minimal public interface needed for initialization or public hooks.
* jQuery is available in REDCap. Prefer jQuery for REDCap-integrated UI/event code unless plain DOM APIs are clearly simpler.
* Use `ConsoleDebugLogger.js` together with the `javascript-debug` project setting for useful debug output, especially for initialization config and non-trivial client-side state.

## REDCap External Module Notes

* External Module Framework documentation starts here:
  `/home/gr/redcap/external_modules/docs/`
* Class autoloading is not automatically available for this module. Maintain a small module-local autoloader or explicitly `require_once` helper classes before use.
* If framework behavior is unclear, check the official EM docs first. Inspect local REDCap/External Module source only when needed and only within the permitted local development environment.

## Local Development Environment

* Work in WSL/Ubuntu.
* Use `php` and `node` for checks and tests.
* Local REDCap external modules path, if inspection is permitted:
  `/home/gr/redcap/external_modules/`

## Verification

When relevant to the changed files:

* Run `php -l <file>` for changed PHP files.
* Run available project tests/lints if a test or lint command exists.
* For JavaScript changes, run the available npm script if present; otherwise at least check syntax/tooling that is already configured.
* If no automated verification is available, state what was checked manually and what remains unverified.
