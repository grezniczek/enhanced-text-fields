/* js/enhanced-text-fields.js */
(function (global, $) {
	'use strict';

	const NS = 'DE_RUB_SEG_EnhancedTextFieldsEM';
	const EM_NAME = 'Enhanced Text Fields';
	const VIEW_RAW = 'raw';
	const VIEW_MARKDOWN = 'markdown';
	const VIEW_HTML = 'html';
	const VIEW_JSON = 'json';
	const SQL_DIALECT_MODES = ['sql', 'mysql', 'mariadb', 'pgsql'];
	const THEME_LIGHT = 'light';
	const THEME_DARK = 'dark';
	const ACE_THEME_LIGHT = 'github_light_default';
	const ACE_THEME_DARK = 'github_dark';
	const SUPPORTED_MODES = [
		'css',
		'ini',
		'json',
		'markdown',
		'mariadb',
		'mysql',
		'pgsql',
		'r',
		'sql',
		'text',
		'xml',
		'yaml',
	];
	const LAYOUT_NORMAL = 'normal';
	const LAYOUT_EXPANDED = 'expanded';
	const LAYOUT_FULLSCREEN = 'fullscreen';
	const MIN_HEIGHT = 100;
	const CONTROLLED_FIELD_CLASS = 'rc-text-viewer-controlled-field';
	const MODE_ATTRIBUTE = 'data-rc-text-viewer-mode';
	const MODE_SELECTOR = '[' + MODE_ATTRIBUTE + ']';
	const FORMAT_POPOVER_BUTTON_SELECTOR = '[data-rc-text-viewer-format-popover]';
	const FORMAT_RADIO_SELECTOR = '[data-rc-text-viewer-format-radio]';
	const LAYOUT_ATTRIBUTE = 'data-rc-text-viewer-layout';
	const TOOLBAR_CLASS = 'rc-text-viewer-md-toolbar d-print-none';
	const VIEWER_CLASS = 'rc-text-viewer-panel';
	const FILE_VIEW_LINK_CLASS = 'rc-text-viewer-file-view-link';
	const AJAX_GET_FILE_CONTENT = 'get-file-content';
	const FILE_EXTENSION_MODES = {
		conf: 'ini',
		css: 'css',
		ini: 'ini',
		json: 'json',
		log: 'text',
		markdown: 'markdown',
		md: 'markdown',
		r: 'r',
		sql: 'sql',
		text: 'text',
		txt: 'text',
		xml: 'xml',
		yaml: 'yaml',
		yml: 'yaml',
	};

	if (global[NS]) {
		return;
	}

	const LOGGER = global.ConsoleDebugLogger
		? global.ConsoleDebugLogger.create({ name: EM_NAME })
		: makeFallbackLogger();

	const state = {
		config: null,
		acePromise: null,
		aceConfigured: false,
		editors: {},
		controllers: {},
	};

	/**
	 * Creates a no-op logger when the debug helper is unavailable.
	 *
	 * @returns {object}
	 */
	function makeFallbackLogger() {
		return {
			configure: function () { return this; },
			log: function () { },
			info: function () { },
			warn: function () { },
			error: function () { },
		};
	}

	/**
	 * Escapes text for use in jQuery selectors.
	 *
	 * @param {string} value The unescaped selector value.
	 * @returns {string}
	 */
	function escapeSelector(value) {
		if ($.escapeSelector) {
			return $.escapeSelector(value);
		}
		return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
	}

	/**
	 * Debounces a high-frequency event handler.
	 *
	 * @param {Function} fn Callback to debounce.
	 * @param {number} waitMs Delay in milliseconds.
	 * @returns {Function}
	 */
	function debounce(fn, waitMs) {
		let timer = null;
		return function () {
			const args = arguments;
			const ctx = this;
			clearTimeout(timer);
			timer = setTimeout(function () {
				fn.apply(ctx, args);
			}, waitMs);
		};
	}

	/**
	 * Finds a text-ish REDCap control by field name.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @returns {jQuery}
	 */
	function findFieldControl(fieldName) {
		const controls = Array.prototype.slice.call(document.getElementsByName(fieldName));
		if (controls.length) {
			return $(controls).filter('textarea,input[type="text"],input:not([type])').first();
		}

		const idMatch = document.getElementById(fieldName);
		if (idMatch) {
			return $(idMatch).filter('textarea,input[type="text"],input:not([type])').first();
		}

		return $('#' + escapeSelector(fieldName)).filter('textarea,input[type="text"],input:not([type])').first();
	}

	/**
	 * Finds the REDCap file upload container for a field.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @returns {jQuery}
	 */
	function findFileContainer(fieldName) {
		const idMatch = document.getElementById('fileupload-container-' + fieldName);
		if (idMatch) {
			return $(idMatch);
		}
		return $('.fileupload-container').filter(function () {
			return $(this).find('a.filedownloadlink').filter(function () {
				return this.name === fieldName;
			}).length > 0;
		}).first();
	}

	/**
	 * Creates a small icon button.
	 *
	 * @param {string} action Action identifier.
	 * @param {string} iconClass Font Awesome icon class.
	 * @param {string} title Accessible title.
	 * @param {string} extraClass Extra CSS class.
	 * @returns {jQuery}
	 */
	function createIconButton(action, iconClass, title, extraClass = '') {
		return $('<button/>', {
			type: 'button',
			class: 'rc-text-viewer__icon-button' + (extraClass ? ' ' + extraClass : ''),
			title: title,
			'aria-label': title,
			'data-rc-text-viewer-action': action,
		}).append($('<i/>', { class: iconClass, 'aria-hidden': 'true' }));
	}

	/**
	 * Creates the shared editable/readonly state indicator.
	 *
	 * @param {boolean} readonly Whether the field is readonly.
	 * @returns {jQuery}
	 */
	function createEditStateIndicator(readonly) {
		const label = readonly
			? getString('display_readonly', 'Readonly')
			: getString('display_editable', 'Editable');
		return $('<span/>', {
			class: 'rc-text-viewer-edit-state' + (readonly ? ' rc-text-viewer-edit-state--readonly' : ''),
			title: label,
			'aria-label': label,
		}).append(
			$('<i/>', { class: 'fa-solid fa-pencil rc-text-viewer-edit-state__pencil', 'aria-hidden': 'true' }),
			$('<i/>', { class: 'fa-solid fa-slash rc-text-viewer-edit-state__slash', 'aria-hidden': 'true' })
		);
	}

	/**
	 * Returns the JavaScript Module Object emitted by the External Module Framework.
	 *
	 * @returns {object|null}
	 */
	function getJavascriptModuleObject() {
		const jsmoName = state.config && state.config.jsmoName;
		let jsmo = global;
        for (const part of jsmoName.split('.')) {
            jsmo = jsmo?.[part];
            if (jsmo === undefined || jsmo === null) {
                break;
            }
        }
        return jsmo;
    }

	/**
	 * Returns the stored light/dark preference for an enhancement type.
	 *
	 * @param {string} type Enhancement type.
	 * @returns {string}
	 */
	function getThemePreference(type) {
		const preferences = state.config.themePreferences || {};
		return preferences[type] === THEME_DARK ? THEME_DARK : THEME_LIGHT;
	}

	/**
	 * Returns the Ace theme key for an enhancement type.
	 *
	 * @param {string} type Enhancement type.
	 * @returns {string}
	 */
	function getPreferredAceTheme(type) {
		return getThemePreference(type) === THEME_DARK ? ACE_THEME_DARK : ACE_THEME_LIGHT;
	}

	/**
	 * Persists a theme preference through the JavaScript Module Object.
	 *
	 * @param {string} type Enhancement type.
	 * @param {string} theme Light/dark preference.
	 * @returns {void}
	 */
	function persistThemePreference(type, theme) {
		const jsmo = getJavascriptModuleObject();
		if (!jsmo) {
			LOGGER.warn('Theme preference could not be saved because the JavaScript Module Object is unavailable.');
			return;
		}
		jsmo.ajax('save-theme-preference', { type: type, theme: theme }).catch(function (e) {
			LOGGER.warn('Theme preference save failed', type, theme, e);
		});
	}

	/**
	 * Applies an Ace theme preference to one controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} theme Light/dark preference.
	 * @returns {void}
	 */
	function applyThemeToController(controller, theme) {
		if (!controller) {
			return;
		}
		controller.currentTheme = theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
		updateThemeButton(controller);
		if (!controller.editor) {
			return;
		}
		const themeConfig = getAceThemeConfig(theme === THEME_DARK ? ACE_THEME_DARK : ACE_THEME_LIGHT);
		controller.editor.setTheme(themeConfig.module);
	}

	/**
	 * Applies a new theme preference to all controllers of the same enhancement type.
	 *
	 * @param {string} type Enhancement type.
	 * @param {string} theme Light/dark preference.
	 * @returns {void}
	 */
	function applyThemeToControllers(type, theme) {
		Object.keys(state.controllers).forEach(function (key) {
			const controller = state.controllers[key];
			if (controller.themeMode === type) {
				applyThemeToController(controller, theme);
			}
		});
	}

	/**
	 * Toggles the theme preference for a controller's enhancement type.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function toggleControllerTheme(controller) {
		if (!controller || !controller.themeMode) {
			return;
		}
		const currentTheme = getThemePreference(controller.themeMode);
		const nextTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
		state.config.themePreferences[controller.themeMode] = nextTheme;
		applyThemeToControllers(controller.themeMode, nextTheme);
		if (!state.config.isSurvey) {
			persistThemePreference(controller.themeMode, nextTheme);
		}
	}

	/**
	 * Returns whether the theme toggle should be visible for a controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {boolean}
	 */
	function isThemeToggleVisible(controller) {
		if (!controller || !controller.themeMode || !controller.isThemeableMode) {
			return false;
		}
		if (controller.layout !== LAYOUT_EXPANDED && controller.layout !== LAYOUT_FULLSCREEN) {
			return false;
		}
		return controller.isThemeableMode();
	}

	/**
	 * Updates a controller's theme toggle icon and label.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function updateThemeButton(controller) {
		if (!controller || !controller.$themeButton || !controller.$themeButton.length) {
			return;
		}
		const theme = getThemePreference(controller.themeMode);
		const title = theme === THEME_DARK
			? getString('button_switch_light', 'Switch to light mode')
			: getString('button_switch_dark', 'Switch to dark mode');
		const iconClass = theme === THEME_DARK ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
		controller.$themeButton.attr('title', title).attr('aria-label', title);
		controller.$themeButton.find('i').attr('class', iconClass).attr('aria-hidden', 'true');
	}

	/**
	 * Sanitizes rendered Markdown HTML before insertion.
	 *
	 * @param {string} html Raw rendered HTML.
	 * @returns {string}
	 */
	function sanitizeHtml(html) {
		const allowedTags = {
			A: true, ABBR: true, B: true, BLOCKQUOTE: true, BR: true, CODE: true, DD: true,
			DEL: true, DETAILS: true, DIV: true, DL: true, DT: true, EM: true, H1: true,
			H2: true, H3: true, H4: true, H5: true, H6: true, HR: true, I: true, IMG: true,
			INS: true, KBD: true, LI: true, OL: true, P: true, PRE: true, S: true, SPAN: true,
			STRONG: true, SUB: true, SUMMARY: true, SUP: true, TABLE: true, TBODY: true,
			TD: true, TH: true, THEAD: true, TR: true, UL: true,
		};
		const allowedAttrs = {
			A: { href: true, title: true, target: true, rel: true },
			IMG: { src: true, alt: true, title: true, width: true, height: true },
			CODE: { class: true },
			PRE: { class: true },
			SPAN: { class: true },
			DIV: { class: true },
			TABLE: { class: true },
			TH: { align: true },
			TD: { align: true },
		};
		const urlAttrs = { href: true, src: true };
		const template = document.createElement('template');
		template.innerHTML = html;

		walk(template.content);
		return template.innerHTML;

		/**
		 * Walks and cleans a DOM node.
		 *
		 * @param {Node} node Node to sanitize.
		 * @returns {void}
		 */
		function walk(node) {
			Array.prototype.slice.call(node.childNodes).forEach(function (child) {
				if (child.nodeType === Node.ELEMENT_NODE) {
					cleanElement(child);
					walk(child);
					return;
				}
				if (child.nodeType !== Node.TEXT_NODE) {
					child.remove();
				}
			});
		}

		/**
		 * Cleans a single element in-place.
		 *
		 * @param {Element} element Element to sanitize.
		 * @returns {void}
		 */
		function cleanElement(element) {
			if (!allowedTags[element.tagName]) {
				element.replaceWith(document.createTextNode(element.textContent || ''));
				return;
			}

			const tagAttrs = allowedAttrs[element.tagName] || {};
			Array.prototype.slice.call(element.attributes).forEach(function (attr) {
				const name = attr.name.toLowerCase();
				const value = attr.value || '';
				if (name.indexOf('on') === 0 || name === 'style' || !tagAttrs[name]) {
					element.removeAttribute(attr.name);
					return;
				}
				if (urlAttrs[name] && !isSafeUrl(value)) {
					element.removeAttribute(attr.name);
				}
			});

			if (element.tagName === 'A' && element.getAttribute('target') === '_blank') {
				element.setAttribute('rel', 'noopener noreferrer');
			}
		}
	}

	/**
	 * Checks whether a URL-valued attribute is safe to render.
	 *
	 * @param {string} value URL value.
	 * @returns {boolean}
	 */
	function isSafeUrl(value) {
		const trimmed = String(value || '').trim().toLowerCase();
		return trimmed === ''
			|| trimmed.indexOf('#') === 0
			|| trimmed.indexOf('/') === 0
			|| trimmed.indexOf('http://') === 0
			|| trimmed.indexOf('https://') === 0
			|| trimmed.indexOf('mailto:') === 0;
	}

	/**
	 * Marks a REDCap input as managed by this External Module.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @returns {void}
	 */
	function markControlledField($control) {
		$control.addClass(CONTROLLED_FIELD_CLASS);
	}

	/**
	 * Applies custom readonly handling for controlled fields.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {jQuery} $row REDCap field row.
	 * @returns {void}
	 */
	function applyReadonlyState($control, $row) {
		$row.addClass('rc-text-viewer-readonly-row');
		$control.prop('disabled', false);
		$control.prop('readonly', true);
		$control.attr('aria-readonly', 'true');
		$control.addClass('rc-text-viewer-readonly-control');
	}

	/**
	 * Creates shared controller state for a text viewer field.
	 *
	 * @param {object} options Controller options.
	 * @returns {object}
	 */
	function createTextViewerController(options) {
		const $control = options.$control;
		const field = options.field;
		const fieldName = field.name;
		const initialHeight = options.initialHeight || null;
		markControlledField($control);

		return {
			fieldName: fieldName,
			field: field,
			eventNamespace: '.rcTextViewerMode' + String(fieldName).replace(/\W/g, '') + String(options.enhancementMode || '').replace(/\W/g, ''),
			$control: $control,
			$row: $(`tr[sq_id="${escapeSelector(fieldName)}"]`).first(),
			$expandLink: $('#' + escapeSelector(fieldName) + '-expand'),
			$toolbar: options.$toolbar,
			$viewer: options.$viewer,
			$editorViewer: options.$editorViewer || $(),
			$editor: options.$editor || $(),
			$rawPanel: options.$rawPanel || $(),
			$resizeHandle: options.$resizeHandle || $(),
			$editorResizeHandle: options.$editorResizeHandle || $(),
			$rawResizeHandle: options.$rawResizeHandle || $(),
			$actions: options.$actions,
			$expandButton: options.$expandButton,
			$fullscreenButton: options.$fullscreenButton,
			$collapseButton: options.$collapseButton,
			$themeButton: options.$themeButton || $(),
			editor: null,
			enhancementMode: options.enhancementMode,
			themeMode: options.enhancementMode || null,
			currentTheme: options.enhancementMode ? getThemePreference(options.enhancementMode) : THEME_LIGHT,
			rowConfig: field.rowConfig === 'full' ? 'full' : 'split',
			canExpandToRowWidth: field.rowConfig === 'split',
			canExpandRaw: $control.is('textarea'),
			layout: LAYOUT_NORMAL,
			normalHeight: initialHeight || $control.outerHeight() || MIN_HEIGHT,
			normalWidth: $control.outerWidth(),
			expandedHeight: null,
			fullscreenHeight: null,
			userHeight: initialHeight,
			fitToContentActive: false,
			fitToContentRestoreHeight: null,
			restoreParent: null,
			restoreNext: null,
			$movedPanel: null,
			$dataCell: null,
			$expandedRow: null,
			bodyOverflow: null,
		};
	}

	/**
	 * Returns a configured display label for a viewer mode.
	 *
	 * @param {string} mode Viewer mode key.
	 * @returns {string}
	 */
	function getModeLabel(mode) {
		const labels = (state.config && state.config.labels) || {};
		return labels[mode] || String(mode || '').toUpperCase();
	}

	/**
	 * Returns a translated client display string.
	 *
	 * @param {string} key Translation key.
	 * @param {string} fallback Fallback text.
	 * @returns {string}
	 */
	function getString(key, fallback) {
		const strings = (state.config && state.config.strings) || {};
		return strings[key] || fallback;
	}

	/**
	 * Returns a translated display string with simple named replacements.
	 *
	 * @param {string} key Translation key.
	 * @param {string} fallback Fallback text.
	 * @param {object} replacements Placeholder values.
	 * @returns {string}
	 */
	function formatString(key, fallback, replacements) {
		let output = getString(key, fallback);
		Object.keys(replacements || {}).forEach(function (name) {
			output = output.replace(new RegExp('\\{' + name + '\\}', 'g'), function () {
				return replacements[name];
			});
		});
		return output;
	}

	/**
	 * Returns an initial viewer height from a mode config.
	 *
	 * @param {object} modeConfig Field mode configuration.
	 * @returns {number|null}
	 */
	function getInitialViewerHeight(modeConfig) {
		return Number.isInteger(modeConfig.height) && modeConfig.height > 0
			? Math.max(modeConfig.height, MIN_HEIGHT)
			: null;
	}

	/**
	 * Builds a shared resize handle.
	 *
	 * @returns {jQuery}
	 */
	function createResizeHandle() {
		return $('<div/>', {
			class: 'rc-text-viewer-md-resize-handle',
			role: 'separator',
			'aria-orientation': 'horizontal',
			title: getString('title_resize', 'Drag to resize'),
		});
	}

	/**
	 * Builds shared toolbar elements and action buttons.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @param {boolean} canExpandToRowWidth Whether row expansion is available.
	 * @returns {object}
	 */
	function createToolbarParts(fieldName, canExpandToRowWidth) {
		const $toolbar = $('<div/>', {
			class: TOOLBAR_CLASS,
			'data-rc-text-viewer-field': fieldName,
		});
		const $tabs = $('<span/>', { class: 'rc-text-viewer-md-tabs' });
		const $actions = $('<span/>', { class: 'rc-text-viewer-md-actions' });
		const $expandButton = createIconButton('expand', 'fa-regular fa-square-caret-left', getString('button_expand', 'Expand to row width'));
		const $fullscreenButton = createIconButton('fullscreen', 'fa-regular fa-square-caret-up', getString('button_fullscreen', 'Fullscreen'));
		const $collapseButton = createIconButton('collapse', 'fa-solid fa-close', getString('button_collapse', 'Collapse'));
		const $themeButton = createIconButton('toggle-theme', 'fa-solid fa-moon', getString('button_switch_dark', 'Switch to dark mode'), 'fs10');
		if (!canExpandToRowWidth) {
			$expandButton.addClass('rc-text-viewer-md-action--unavailable');
		}
		$actions.append($themeButton, $expandButton, $fullscreenButton, $collapseButton);
		$toolbar.append($tabs, $actions);
		return {
			$toolbar: $toolbar,
			$tabs: $tabs,
			$actions: $actions,
			$expandButton: $expandButton,
			$fullscreenButton: $fullscreenButton,
			$collapseButton: $collapseButton,
			$themeButton: $themeButton,
		};
	}

	/**
	 * Builds a mode tab.
	 *
	 * @param {string} mode Mode value.
	 * @param {string} label Visible label.
	 * @returns {jQuery}
	 */
	function createModeTab(mode, label) {
		return $('<a/>', {
			href: 'javascript:;',
			class: 'rc-text-viewer-md-tab',
			[MODE_ATTRIBUTE]: mode,
			text: label,
		});
	}

	/**
	 * Builds the configured editor-mode popover trigger.
	 *
	 * @param {object} field Field configuration.
	 * @param {string} selectedMode Currently selected enhancement mode.
	 * @returns {jQuery}
	 */
	function createFormatPopoverButton(field, selectedMode) {
		return $('<button/>', {
			type: 'button',
			class: 'rc-text-viewer__icon-button rc-text-viewer-md-format-button',
			title: getString('button_switch_format', 'Switch format'),
			'aria-label': getString('button_switch_format', 'Switch format'),
			'data-rc-text-viewer-format-popover': '1',
			'data-rc-text-viewer-selected-mode': selectedMode,
		}).append($('<i/>', { class: 'fa-solid fa-arrow-right-arrow-left', 'aria-hidden': 'true' }));
	}

	/**
	 * Builds the format popover body.
	 *
	 * @param {object} field Field configuration.
	 * @param {string} selectedMode Currently selected enhancement mode.
	 * @returns {string}
	 */
	function createFormatPopoverContent(field, selectedMode) {
		const modes = getConfiguredTextModes(field);
		return createFormatPopoverContentForModes(field, selectedMode, modes);
	}

	/**
	 * Builds the format popover body from a specific mode list.
	 *
	 * @param {object} field Field configuration.
	 * @param {string} selectedMode Currently selected enhancement mode.
	 * @param {string[]} modes Selectable enhancement modes.
	 * @returns {string}
	 */
	function createFormatPopoverContentForModes(field, selectedMode, modes) {
		const name = 'rc-text-viewer-format-' + String(field.name || '').replace(/\W/g, '_');
		const $list = $('<div/>', {
			class: 'rc-text-viewer-format-popover',
			'data-rc-text-viewer-field': field.name || '',
		});
		modes.forEach(function (mode) {
			const id = name + '-' + mode;
			const $radio = $('<input/>', {
				type: 'radio',
				id: id,
				name: name,
				value: mode,
				checked: mode === selectedMode,
				'data-rc-text-viewer-format-radio': '1',
			});
			const $label = $('<label/>', { class: 'rc-text-viewer-format-popover__option', for: id });
			$label.append($radio, $('<span/>', { text: getModeLabel(mode) }));
			$list.append($label);
		});
		return $list.prop('outerHTML');
	}

	/**
	 * Builds a normal selected-mode tab with a compact format selector beside it.
	 *
	 * @param {string} tabMode Mode value for this tab.
	 * @param {object} field Field configuration.
	 * @param {string} selectedMode Currently selected enhancement mode.
	 * @param {jQuery} $themeButton Theme toggle button.
	 * @returns {jQuery}
	 */
	function createFormatModeTab(tabMode, field, selectedMode, $themeButton) {
		const $group = $('<span/>', { class: 'rc-text-viewer-md-tab-group' });
		$group.append(createModeTab(tabMode, getModeLabel(tabMode)));
		$group.append(createFormatPopoverButton(field, selectedMode));
		if ($themeButton && $themeButton.length) {
			$group.append($themeButton);
		}
		return $group;
	}

	/**
	 * Appends mode tabs with separators.
	 *
	 * @param {jQuery} $tabs Toolbar tabs container.
	 * @param {jQuery[]} tabItems Tabs and non-tab inline controls.
	 * @returns {void}
	 */
	function appendSeparatedTabs($tabs, tabItems) {
		tabItems.forEach(function ($item, index) {
			if (index > 0) {
				$tabs.append($('<span/>', { class: 'rc-text-viewer-md-tab-separator', text: '|' }));
			}
			$tabs.append($item);
		});
	}

	/**
	 * Builds a raw field wrapper panel.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @returns {jQuery}
	 */
	function createRawPanel(fieldName) {
		return $('<div/>', {
			class: 'rc-text-viewer-raw-panel',
			'data-rc-text-viewer-field': fieldName,
		});
	}

	/**
	 * Wires shared toolbar click behavior.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {Function} setMode Mode setter.
	 * @returns {void}
	 */
	function bindTextViewerToolbar(controller, setMode) {
		controller.$toolbar.on('click', MODE_SELECTOR, function (ev) {
			ev.preventDefault();
			const mode = $(this).attr(MODE_ATTRIBUTE);
			if (mode !== controller.mode) {
				setMode(controller, mode);
			}
		});
		controller.$toolbar.on('click', '[data-rc-text-viewer-action]', function (ev) {
			ev.preventDefault();
			handleTextViewerAction(controller, $(this).attr('data-rc-text-viewer-action'));
		});
	}

	/**
	 * Mounts the shared toolbar, raw panel, and Ace-backed viewer panel.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function mountAceTextViewer(controller) {
		controller.$viewer.append(controller.$editor, controller.$resizeHandle);
		if (controller.canExpandRaw) {
			controller.$control.before(controller.$rawPanel);
			controller.$rawPanel.append(controller.$control, controller.$rawResizeHandle);
			controller.$rawPanel.before(controller.$toolbar);
			controller.$rawPanel.after(controller.$viewer);
			return;
		}
		controller.$control.before(controller.$toolbar);
		controller.$control.after(controller.$viewer);
	}

	/**
	 * Mounts the Markdown raw, editor, and preview panels.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function mountMarkdownViewer(controller) {
		controller.$viewerScroll.append(controller.$viewerContent);
		controller.$viewer.append(controller.$viewerScroll, controller.$resizeHandle);
		controller.$editorViewer.append(controller.$editor, controller.$editorResizeHandle);
		controller.$control.before(controller.$rawPanel);
		controller.$rawPanel.append(controller.$control, controller.$rawResizeHandle);
		controller.$rawPanel.before(controller.$toolbar);
		controller.$rawPanel.after(controller.$viewer);
		controller.$viewer.after(controller.$editorViewer);
	}

	/**
	 * Initializes the shared Ace lifecycle for JSON and generic text controllers.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} editorId Ace editor element id.
	 * @param {object} field Field configuration.
	 * @param {object} options Lifecycle callbacks and storage keys.
	 * @returns {void}
	 */
	function initEnhancedEditor(controller, editorId, field, spec) {
		if (spec.mode === VIEW_MARKDOWN) {
			ensureAce().then(function () {
				const editor = createAceEditor(editorId, {
					mode: VIEW_MARKDOWN,
					theme: getPreferredAceTheme(controller.themeMode),
					readOnly: !!field.readonly,
					useWorker: false,
				});
				controller.editor = editor;
				controller.currentTheme = getThemePreference(controller.themeMode);
				state.editors[spec.editorKey] = editor;
				editor.setValue(controller.$control.val() || '', -1);
				editor.session.on('change', debounce(function () {
					if (editor.getReadOnly()) {
						return;
					}
					controller.$control.val(editor.getValue()).trigger('change');
					renderMarkdown(controller);
				}, 100));
				controller.$control.on('input.rcTextViewerMode change.rcTextViewerMode keyup.rcTextViewerMode', debounce(function () {
					if (editor.getValue() !== (controller.$control.val() || '')) {
						editor.setValue(controller.$control.val() || '', -1);
					}
				}, 100));
				editor.resize();
			}).catch(function (e) {
				LOGGER.warn('Ace failed to load for Markdown editor', e);
			});
			return;
		}

		ensureAce().then(function () {
			const editor = createAceEditor(editorId, {
				mode: spec.editorMode,
				theme: getPreferredAceTheme(controller.themeMode),
				readOnly: !!field.readonly,
				useWorker: false,
				indent: controller.indent,
			});
			controller.editor = editor;
			controller.currentTheme = getThemePreference(controller.themeMode);
			state.editors[spec.editorKey] = editor;
			const syncFromEditor = debounce(function () {
				spec.syncFromEditor(controller);
			}, 100);
			editor.session.on('change', function () {
				const changeGeneration = controller.editorChangeGeneration;
				if (changeGeneration === controller.suppressedEditorChangeGeneration) {
					controller.suppressedEditorChangeGeneration = null;
					return;
				}
				syncFromEditor();
			});
			editor.on('blur', function () {
				spec.normalizeEditor(controller);
			});
			spec.renderFromControl(controller);
			syncTextViewerNormalSize(controller);
			resizeTextViewerEditor(controller);
		}).catch(function (e) {
			spec.renderFallback(controller, e);
		});
	}

	/**
	 * Renders a text fallback when Ace cannot load.
	 *
	 * @param {object} controller Ace text controller.
	 * @param {Error} error Load error.
	 * @returns {void}
	 */
	function renderAceTextFallback(controller, error) {
		const formatted = formatAceText(controller.$control.val() || '', controller.aceMode, controller.displayFormat, controller.indent);
		controller.$viewer.html($('<pre/>', { class: 'rc-text-viewer__fallback' }).text(formatted.text));
		setAceTextStatus(controller, formatted);
		LOGGER.warn('Ace failed to load for ' + controller.aceMode, error);
	}

	/**
	 * Sets the visible mode for an Ace-backed raw/editor controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} mode Desired mode.
	 * @returns {void}
	 */
	function setAceBackedMode(controller, mode) {
		if (controller.editorOnly || mode === controller.aceMode) {
			mode = controller.aceMode;
		}
		else {
			mode = VIEW_RAW;
		}

		const previousMode = controller.mode;
		const previousLayout = controller.layout;
		if (previousMode === VIEW_RAW && mode !== VIEW_RAW) {
			controller.renderFromControl();
		}
		if (previousMode !== mode && previousLayout !== LAYOUT_NORMAL) {
			rememberTextViewerHeight(controller);
			restoreTextViewerLayout(controller);
		}
		controller.mode = mode;
		if (mode === VIEW_RAW) {
			controller.normalizeEditor();
			syncTextViewerNormalSize(controller, true);
			showAceBackedRawMode(controller);
		}
		else {
			syncTextViewerNormalSize(controller, true);
			showAceBackedEditorMode(controller);
		}
		updateTextViewerToolbar(controller);
		if (previousMode !== mode && previousLayout === LAYOUT_EXPANDED) {
			expandTextViewer(controller);
		}
		if (previousMode !== mode && previousLayout === LAYOUT_FULLSCREEN) {
			fullscreenTextViewer(controller);
		}
	}

	/**
	 * Shows the raw control for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function showAceBackedRawMode(controller) {
		controller.$control.show();
		controller.$rawPanel.css('display', controller.canExpandRaw ? 'flex' : 'none');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'none');
	}

	/**
	 * Shows the Ace editor panel for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function showAceBackedEditorMode(controller) {
		controller.$control.hide();
		controller.$rawPanel.css('display', 'none');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'flex');
		resizeTextViewerEditor(controller);
	}

	/**
	 * Returns the active panel for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {jQuery}
	 */
	function getAceBackedActivePanel(controller) {
		return controller.mode === VIEW_RAW && controller.canExpandRaw ? controller.$rawPanel : controller.$viewer;
	}

	/**
	 * Restores the visible panel for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function restoreAceBackedVisibleMode(controller) {
		if (controller.mode === VIEW_RAW) {
			showAceBackedRawMode(controller);
			return;
		}
		showAceBackedEditorMode(controller);
	}

	/**
	 * Calculates content height for an Ace-backed controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {number}
	 */
	function getAceBackedContentHeight(controller) {
		if (controller.mode === VIEW_RAW && controller.canExpandRaw) {
			const control = controller.$control[0];
			return control ? control.scrollHeight + controller.$rawResizeHandle.outerHeight() : MIN_HEIGHT;
		}
		if (controller.editor) {
			const lineHeight = controller.editor.renderer.lineHeight || 16;
			return (controller.editor.session.getScreenLength() * lineHeight) + 24;
		}
		return MIN_HEIGHT;
	}

	/**
	 * Handles shared toolbar action buttons.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {string} action Action identifier.
	 * @returns {void}
	 */
	function handleTextViewerAction(controller, action) {
		if (action === 'toggle-theme') {
			toggleControllerTheme(controller);
		}
		if (action === 'expand') {
			expandTextViewer(controller);
		}
		if (action === 'fullscreen') {
			fullscreenTextViewer(controller);
		}
		if (action === 'collapse') {
			collapseTextViewer(controller);
		}
	}

	/**
	 * Updates shared toolbar active states and expansion buttons.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function updateTextViewerToolbar(controller) {
		const isPanelMode = controller.isPanelMode();
		controller.$toolbar.find(MODE_SELECTOR).each(function () {
			const $tab = $(this);
			const active = $tab.attr(MODE_ATTRIBUTE) === controller.mode;
			$tab.toggleClass('active', active);
			$tab.attr('aria-current', active ? 'true' : 'false');
		});
		controller.$actions[isPanelMode ? 'show' : 'hide']();
		controller.$expandButton[isPanelMode && controller.canExpandToRowWidth && controller.layout !== LAYOUT_EXPANDED ? 'show' : 'hide']();
		controller.$fullscreenButton[isPanelMode && controller.layout !== LAYOUT_FULLSCREEN ? 'show' : 'hide']();
		controller.$collapseButton[isPanelMode && (controller.layout === LAYOUT_FULLSCREEN || controller.layout === LAYOUT_EXPANDED) ? 'show' : 'hide']();
		updateThemeButton(controller);
		controller.$themeButton[isThemeToggleVisible(controller) ? 'show' : 'hide']();
		controller.$toolbar
			.attr(LAYOUT_ATTRIBUTE, controller.layout)
			.toggleClass('rc-text-viewer-md-toolbar--markdown', isPanelMode);
	}

	/**
	 * Inserts or returns the stable DOM anchor used when rebuilding a field controller.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {string} fieldName REDCap field name.
	 * @returns {jQuery}
	 */
	function getOrCreateTextViewerAnchor($control, fieldName) {
		const existing = $control.data('rcTextViewerAnchor');
		if (existing && existing.length) {
			return existing;
		}
		const $anchor = $('<span/>', {
			class: 'rc-text-viewer-anchor',
			'data-rc-text-viewer-anchor': fieldName,
		}).hide();
		$control.before($anchor);
		$control.data('rcTextViewerAnchor', $anchor);
		return $anchor;
	}

	/**
	 * Switches a text field to another configured enhancement mode by rebuilding its controller.
	 *
	 * @param {object} controller Current text viewer controller.
	 * @param {string} mode Enhancement mode to activate.
	 * @returns {void}
	 */
	function switchEnhancedTextMode(controller, mode) {
		if (!controller || !isSupportedEnhancementMode(mode) || controller.configuredModes.indexOf(mode) === -1) {
			return;
		}
		const field = controller.field;
		const $control = controller.$control;
		const $anchor = controller.$anchor;
		flushEnhancedTextController(controller);
		destroyEnhancedTextController(controller);
		createEnhancedTextController($control, field, mode, { $anchor: $anchor, initialMode: mode });
	}

	/**
	 * Pushes any active editor content into the REDCap control before rebuilding.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function flushEnhancedTextController(controller) {
		if (!controller || !controller.editor || controller.editor.getReadOnly()) {
			return;
		}
		if (controller.enhancementMode === VIEW_MARKDOWN) {
			controller.$control.val(controller.editor.getValue()).trigger('change');
			renderMarkdown(controller);
			return;
		}
		controller.normalizeEditor();
		syncAceTextFromEditor(controller);
	}

	/**
	 * Removes a text viewer controller while preserving the REDCap field control.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function destroyEnhancedTextController(controller) {
		if (!controller) {
			return;
		}
		disposeFormatPopover(controller);
		if (controller.layout !== LAYOUT_NORMAL) {
			restoreTextViewerLayout(controller);
		}
		if (controller.editor) {
			try {
				controller.editor.destroy();
				controller.editor.container.remove();
			}
			catch (e) {
				LOGGER.warn('Ace editor cleanup failed', e);
			}
		}
		if (controller.$anchor && controller.$anchor.length) {
			controller.$anchor.after(controller.$control);
		}
		$(global).off(controller.eventNamespace);
		controller.$control.off('.rcTextViewerMode');
		controller.$control.show();
		controller.$toolbar.off().remove();
		controller.$viewer.remove();
		controller.$editorViewer.remove();
		controller.$rawPanel.remove();
		delete state.editors[controller.fieldName + '-' + controller.enhancementMode];
	}

	/**
	 * Initializes the Bootstrap popover used to switch configured editor formats.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function initFormatPopover(controller) {
		const $button = controller.$toolbar.find(FORMAT_POPOVER_BUTTON_SELECTOR).first();
		if (!$button.length) {
			return;
		}
		controller.$formatPopoverButton = $button;
		$button.data('rcTextViewerController', controller);
		const options = {
			html: true,
			content: createFormatPopoverContent(controller.field, controller.enhancementMode),
			container: 'body',
			customClass: 'rc-text-viewer-format-popover-container',
			placement: 'bottom',
			trigger: 'click',
			sanitize: false,
			title: '',
		};
		if (global.bootstrap && global.bootstrap.Popover) {
			controller.formatPopover = new global.bootstrap.Popover($button[0], options);
		}
		else if ($.fn.popover) {
			$button.popover(options);
			controller.formatPopover = { type: 'jquery' };
		}
		$button.attr('title', getString('button_switch_format', 'Switch format'));
		$(document).on('click' + controller.eventNamespace, FORMAT_RADIO_SELECTOR, function () {
			const mode = $(this).val();
			const activeController = $button.data('rcTextViewerController');
			const fieldName = $(this).closest('.rc-text-viewer-format-popover').attr('data-rc-text-viewer-field') || '';
			if (!activeController || fieldName !== activeController.fieldName || !mode) {
				return;
			}
			if (mode !== activeController.enhancementMode) {
				switchEnhancedTextMode(activeController, mode);
				return;
			}
			hideFormatPopover(activeController);
			if (isInactiveFormatView(activeController)) {
				activeController.setMode(mode);
			}
		});
	}

	/**
	 * Returns whether the current view is outside the selected editor format.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {boolean}
	 */
	function isInactiveFormatView(controller) {
		return controller.mode === VIEW_RAW || (controller.enhancementMode === VIEW_MARKDOWN && controller.mode === VIEW_HTML);
	}

	/**
	 * Hides the active format popover for a controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function hideFormatPopover(controller) {
		if (!controller || !controller.formatPopover) {
			return;
		}
		if (controller.formatPopover.type !== 'jquery' && typeof controller.formatPopover.hide === 'function') {
			controller.formatPopover.hide();
			return;
		}
		if (controller.$formatPopoverButton && $.fn.popover) {
			controller.$formatPopoverButton.popover('hide');
		}
	}

	/**
	 * Disposes the active format popover for a controller.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function disposeFormatPopover(controller) {
		if (!controller) {
			return;
		}
		$(document).off(controller.eventNamespace);
		if (!controller.formatPopover) {
			return;
		}
		if (controller.formatPopover.type !== 'jquery' && typeof controller.formatPopover.dispose === 'function') {
			controller.formatPopover.dispose();
		}
		else if (controller.$formatPopoverButton && $.fn.popover) {
			controller.$formatPopoverButton.popover('destroy');
		}
		controller.formatPopover = null;
	}

	/**
	 * Builds a controller specification for one enhancement mode.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @param {string} mode Enhancement mode.
	 * @returns {object}
	 */
	function getEnhancedTextSpec($control, field, mode) {
		const fieldName = field.name;
		const isMarkdown = mode === VIEW_MARKDOWN;
		const modeConfig = field[mode] || {};
		const editorOnly = !!modeConfig.editorOnly;
		const editorModeId = fieldName + '-' + mode;
		const spec = {
			mode: mode,
			modeConfig: modeConfig,
			editorOnly: editorOnly,
			initialMode: editorOnly ? mode : getInitialMode($control, mode, modeConfig.initialMode),
			editorMode: mode,
			editorId: `rc-text-viewer-ace-${editorModeId}`,
			defaultMode: mode,
			tabs: editorOnly ? [mode] : [VIEW_RAW, mode],
			stateKey: fieldName,
			editorKey: editorModeId,
			status: !isMarkdown,
			buildController: extendAceBackedController,
			mount: mountAceTextViewer,
			setMode: setAceBackedMode,
			syncFromEditor: syncAceTextFromEditor,
			normalizeEditor: normalizeAceTextEditor,
			renderFromControl: renderAceTextFromControl,
			renderFallback: renderAceTextFallback,
			normalizes: modeConfig.normalizes,
		};
		if (isMarkdown) {
			spec.initialMode = editorOnly ? VIEW_MARKDOWN : getInitialMode($control, mode, modeConfig.initialMode);
			spec.defaultMode = VIEW_HTML;
			spec.tabs = editorOnly ? [VIEW_MARKDOWN, VIEW_HTML] : [VIEW_RAW, VIEW_MARKDOWN, VIEW_HTML];
			spec.buildController = extendMarkdownController;
			spec.mount = mountMarkdownViewer;
			spec.setMode = setMarkdownMode;
			spec.afterCreate = initMarkdownWindowResize;
		}
		return spec;
	}

	/**
	 * Builds one enhanced text controller from a mode specification.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @param {string} mode Enhancement mode.
	 * @returns {object}
	 */
	function createEnhancedTextController($control, field, mode, options) {
		const fieldName = field.name;
		options = options || {};
		const spec = getEnhancedTextSpec($control, field, mode);
		if (options.initialMode === mode || (mode === VIEW_MARKDOWN && options.initialMode === VIEW_HTML)) {
			spec.initialMode = options.initialMode;
		}
		const toolbarParts = createToolbarParts(fieldName, field.rowConfig === 'split');
		spec.$themeButton = toolbarParts.$themeButton;
		const $editability = createEditStateIndicator(!!field.readonly);
		const $status = spec.status ? $('<span/>', { class: 'rc-text-viewer-status', 'aria-live': 'polite' }) : $();
		const $viewer = $('<div/>', {
			class: VIEWER_CLASS,
			'data-rc-text-viewer-field': fieldName,
			tabindex: mode === VIEW_MARKDOWN ? '0' : null,
		});
		const $editor = $('<div/>', { id: spec.editorId, class: 'rc-text-viewer__ace' });
		const $rawPanel = createRawPanel(fieldName);
		const controller = createTextViewerController({
			enhancementMode: mode,
			field: field,
			$control: $control,
			$toolbar: toolbarParts.$toolbar,
			$viewer: $viewer,
			$editorViewer: mode === VIEW_MARKDOWN ? $('<div/>', {
				class: 'rc-text-viewer-md-editor',
				'data-rc-text-viewer-field': fieldName,
			}) : $(),
			$editor: $editor,
			$rawPanel: $rawPanel,
			$resizeHandle: createResizeHandle(),
			$editorResizeHandle: mode === VIEW_MARKDOWN ? createResizeHandle() : $(),
			$rawResizeHandle: createResizeHandle(),
			$actions: toolbarParts.$actions,
			$expandButton: toolbarParts.$expandButton,
			$fullscreenButton: toolbarParts.$fullscreenButton,
			$collapseButton: toolbarParts.$collapseButton,
			$themeButton: toolbarParts.$themeButton,
			initialHeight: getInitialViewerHeight(spec.modeConfig),
		});
		controller.$anchor = options.$anchor || getOrCreateTextViewerAnchor($control, fieldName);
		controller.configuredModes = getConfiguredTextModes(field);

		spec.buildController(controller, spec, $status);
		if (field.readonly) {
			applyReadonlyState($control, controller.$row);
		}

		appendControllerTabs(toolbarParts.$tabs, $editability, spec, $status, field, mode);
		spec.mount(controller);
		bindTextViewerToolbar(controller, spec.setMode);
		initFormatPopover(controller);
		initTextViewerResizeHandles(controller);
		initEnhancedEditor(controller, spec.editorId, field, spec);
		if (spec.afterCreate) {
			spec.afterCreate(controller);
		}

		spec.setMode(controller, controller.mode);
		state.controllers[spec.stateKey] = controller;
		LOGGER.log('Controller created', controller);
		return controller;
	}

	/**
	 * Returns whether a configured enhancement mode is supported.
	 *
	 * @param {string} mode Enhancement mode.
	 * @returns {boolean}
	 */
	function isSupportedEnhancementMode(mode) {
		return SUPPORTED_MODES.indexOf(mode) !== -1;
	}

	/**
	 * Attaches one configured enhancement to a field control.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @param {string} mode Enhancement mode.
	 * @returns {void}
	 */
	function attachEnhancedTextViewer($control, field, mode) {
		if (!isSupportedEnhancementMode(mode)) {
			LOGGER.warn('Unsupported enhancement skipped', mode, field.name);
			return;
		}
		createEnhancedTextController($control, field, mode);
	}

	/**
	 * Attaches the read-only file viewer behavior for a REDCap file field.
	 *
	 * @param {object} field Field configuration.
	 * @returns {void}
	 */
	function attachEnhancedFileViewer(field) {
		const $container = findFileContainer(field.name);
		if (!$container.length) {
			LOGGER.warn('File upload container not found', field.name);
			return;
		}

		const key = `${NS}-isFileInitialized`;
		if ($container.data(key)) {
			refreshFileViewerState(state.controllers[field.name]);
			return;
		}

		$container.data(key, true);
		const controller = createFileViewerController(field, $container);
		state.controllers[field.name] = controller;
		initFileViewerObserver(controller);
		refreshFileViewerState(controller);
		LOGGER.log('File viewer controller created', controller);
	}

	/**
	 * Creates the fullscreen-only file viewer controller.
	 *
	 * @param {object} field Field configuration.
	 * @param {jQuery} $container REDCap file upload container.
	 * @returns {object}
	 */
	function createFileViewerController(field, $container) {
		const fieldName = field.name;
		const toolbarParts = createFileToolbarParts(fieldName);
		const $viewer = $('<div/>', {
			class: VIEWER_CLASS + ' rc-text-viewer-file-panel',
			'data-rc-text-viewer-field': fieldName,
		});
		const $editor = $('<div/>', {
			id: 'rc-text-viewer-file-ace-' + fieldName,
			class: 'rc-text-viewer__ace rc-text-viewer-file-ace',
		});
		const $previewScroll = $('<div/>', { class: 'rc-text-viewer-md-preview-scroll rc-text-viewer-file-preview' });
		const $previewContent = $('<div/>', { class: 'markdown-body rc-text-viewer-md-preview-content' });
		const $status = $('<span/>', { class: 'rc-text-viewer-status', 'aria-live': 'polite' });
		$previewScroll.append($previewContent);
		$viewer.append($editor, $previewScroll);

		const controller = {
			fieldName: fieldName,
			field: field,
			$container: $container,
			$downloadLink: $(),
			$linkArea: $(),
			$viewLink: $(),
			$viewSeparator: $(),
			$toolbar: toolbarParts.$toolbar,
			$tabs: toolbarParts.$tabs,
			$actions: toolbarParts.$actions,
			$themeButton: toolbarParts.$themeButton,
			$closeButton: toolbarParts.$closeButton,
			$viewer: $viewer,
			$editor: $editor,
			$previewScroll: $previewScroll,
			$previewContent: $previewContent,
			$status: $status,
			editor: null,
			eventNamespace: '.rcTextViewerFileMode' + String(fieldName).replace(/\W/g, ''),
			mode: null,
			currentFileMode: null,
			themeMode: null,
			currentTheme: THEME_LIGHT,
			fileInfo: null,
			fileContent: '',
			bodyOverflow: null,
			layout: LAYOUT_FULLSCREEN,
			isOpen: false,
			observer: null,
			isThemeableMode: function () { return controller.mode === controller.currentFileMode; },
		};

		bindFileViewerToolbar(controller);
		return controller;
	}

	/**
	 * Builds toolbar elements for the fullscreen file viewer.
	 *
	 * @param {string} fieldName REDCap field name.
	 * @returns {object}
	 */
	function createFileToolbarParts(fieldName) {
		const $toolbar = $('<div/>', {
			class: TOOLBAR_CLASS + ' rc-text-viewer-file-toolbar',
			'data-rc-text-viewer-field': fieldName,
		});
		const $tabs = $('<span/>', { class: 'rc-text-viewer-md-tabs' });
		const $actions = $('<span/>', { class: 'rc-text-viewer-md-actions' });
		const $themeButton = createIconButton('toggle-theme', 'fa-solid fa-moon', getString('button_switch_dark', 'Switch to dark mode'), 'fs10');
		const $closeButton = createIconButton('file-close', 'fa-solid fa-xmark', getString('button_close', 'Close'));
		$actions.append($themeButton, $closeButton);
		$toolbar.append($tabs, $actions);
		return {
			$toolbar: $toolbar,
			$tabs: $tabs,
			$actions: $actions,
			$themeButton: $themeButton,
			$closeButton: $closeButton,
		};
	}

	/**
	 * Wires the file viewer toolbar.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function bindFileViewerToolbar(controller) {
		controller.$toolbar.on('click', MODE_SELECTOR, function (ev) {
			ev.preventDefault();
			setFileViewerMode(controller, $(this).attr(MODE_ATTRIBUTE));
		});
		controller.$toolbar.on('click', '[data-rc-text-viewer-action]', function (ev) {
			ev.preventDefault();
			const action = $(this).attr('data-rc-text-viewer-action');
			if (action === 'toggle-theme') {
				toggleControllerTheme(controller);
			}
			if (action === 'file-close') {
				closeFileViewer(controller);
			}
		});
	}

	/**
	 * Watches REDCap's AJAX-updated file field markup.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function initFileViewerObserver(controller) {
		if (!global.MutationObserver || !controller.$container.length) {
			return;
		}
		const refresh = debounce(function () {
			refreshFileViewerState(controller);
		}, 50);
		controller.observer = new MutationObserver(refresh);
		controller.observer.observe(controller.$container[0], {
			attributes: true,
			attributeFilter: ['class', 'href', 'style', 'title', 'vf'],
			characterData: true,
			childList: true,
			subtree: true,
		});
	}

	/**
	 * Adds, updates, or removes the file View link for the current REDCap markup.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function refreshFileViewerState(controller) {
		if (!controller) {
			return;
		}
		const info = getCurrentFileInfo(controller);
		if (!info || !info.mode) {
			removeFileViewLink(controller);
			if (controller.isOpen) {
				closeFileViewer(controller);
			}
			return;
		}

		ensureFileViewLink(controller);
		controller.$viewLink
			.attr('title', formatString('title_view_file', 'View {mode} file', { mode: getModeLabel(info.mode) }))
			.attr('aria-label', formatString('aria_view_file', 'View {filename}', { filename: info.filename }))
			.data('rcTextViewerFileInfo', info);
		if (controller.isOpen && !isSameFileInfo(controller.fileInfo, info)) {
			closeFileViewer(controller);
		}
	}

	/**
	 * Ensures the file View link exists in REDCap's file action area.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function ensureFileViewLink(controller) {
		if (controller.$viewLink && controller.$viewLink.length && $.contains(document, controller.$viewLink[0])) {
			return;
		}

		controller.$linkArea = $('#' + escapeSelector(controller.fieldName) + '-linknew');
		if (!controller.$linkArea.length) {
			controller.$linkArea = controller.$container;
		}

		controller.$viewLink = $('<a/>', {
			href: 'javascript:;',
			class: FILE_VIEW_LINK_CLASS + ' d-print-none',
		});
		controller.$viewLink.append(
			$('<i/>', { class: 'fa-solid fa-eye me-1', 'aria-hidden': 'true' }),
			$('<span/>', { text: getString('button_view', 'View') })
		);
		controller.$viewLink.on('click', function (ev) {
			ev.preventDefault();
			openFileViewer(controller);
		});
		if ($.trim(controller.$linkArea.text()) !== '') {
			controller.$viewSeparator = $('<span/>', {
				class: 'rc-text-viewer-file-view-separator d-print-none',
				text: getString('label_or', 'or'),
			});
			controller.$linkArea.append(controller.$viewSeparator);
		}
		controller.$linkArea.append(controller.$viewLink);
	}

	/**
	 * Removes the injected View link.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function removeFileViewLink(controller) {
		if (controller.$viewLink && controller.$viewLink.length) {
			controller.$viewLink.remove();
		}
		if (controller.$viewSeparator && controller.$viewSeparator.length) {
			controller.$viewSeparator.remove();
		}
		controller.$viewLink = $();
		controller.$viewSeparator = $();
	}

	/**
	 * Reads the current uploaded file state from REDCap's file field markup.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {object|null}
	 */
	function getCurrentFileInfo(controller) {
		const $link = controller.$container.find('a.filedownloadlink').filter(function () {
			return this.name === controller.fieldName;
		}).first();
		if (!$link.length || $link.css('display') === 'none') {
			return null;
		}

		const href = $link.attr('href') || '';
		const $filename = $link.find('.fu-fn').first();
		const filename = String($filename.attr('vf') || $link.attr('title') || $filename.text() || '').trim();
		if (!href || !filename) {
			return null;
		}

		const mode = determineFileMode(controller.field.viewers || [], filename);
		const params = parseFileDownloadParams(href);
		if (!params.docId || !params.docIdHash) {
			return null;
		}

		return {
			docIdHash: params.docIdHash,
			docId: params.docId,
			filename: filename,
			href: href,
			mode: mode,
		};
	}

	/**
	 * Parses the REDCap file download URL parameters required by the server.
	 *
	 * @param {string} href File download URL.
	 * @returns {object}
	 */
	function parseFileDownloadParams(href) {
		try {
			const url = new URL(href, global.location.href);
			return {
				docIdHash: url.searchParams.get('doc_id_hash') || '',
				docId: url.searchParams.get('id') || '',
			};
		}
		catch (e) {
			return {
				docIdHash: getQueryParamFromString(href, 'doc_id_hash'),
				docId: getQueryParamFromString(href, 'id'),
			};
		}
	}

	/**
	 * Gets one URL query parameter from a string.
	 *
	 * @param {string} value URL-ish string.
	 * @param {string} key Query parameter name.
	 * @returns {string}
	 */
	function getQueryParamFromString(value, key) {
		const match = String(value || '').match(new RegExp('[?&]' + key + '=([^&]*)'));
		return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
	}

	/**
	 * Selects a configured viewer based on uploaded file extension.
	 *
	 * @param {string[]} viewers Configured enhancement modes.
	 * @param {string} filename Uploaded filename.
	 * @returns {string}
	 */
	function determineFileMode(viewers, filename) {
		const extension = getFileExtension(filename);
		if (extension === 'sql') {
			return getConfiguredSqlModes({ viewers: viewers })[0] || '';
		}
		const mode = FILE_EXTENSION_MODES[extension] || '';
		if (!isSupportedEnhancementMode(mode)) {
			return '';
		}
		return (viewers || []).indexOf(mode) !== -1 ? mode : '';
	}

	/**
	 * Returns configured SQL modes for a field in default dialect order.
	 *
	 * @param {object} field Field configuration.
	 * @returns {string[]}
	 */
	function getConfiguredSqlModes(field) {
		const viewers = field.viewers || [];
		return SQL_DIALECT_MODES.filter(function (mode) {
			return viewers.indexOf(mode) !== -1;
		});
	}

	/**
	 * Returns the lowercase extension for a filename.
	 *
	 * @param {string} filename Uploaded filename.
	 * @returns {string}
	 */
	function getFileExtension(filename) {
		const clean = String(filename || '').split(/[?#]/)[0];
		const basename = clean.split(/[\\/]/).pop() || '';
		const dot = basename.lastIndexOf('.');
		return dot > -1 ? basename.substring(dot + 1).toLowerCase() : '';
	}

	/**
	 * Compares two file info objects for the same uploaded document.
	 *
	 * @param {object|null} a First file info.
	 * @param {object|null} b Second file info.
	 * @returns {boolean}
	 */
	function isSameFileInfo(a, b) {
		return !!a && !!b && a.docId === b.docId && a.docIdHash === b.docIdHash && a.mode === b.mode;
	}

	/**
	 * Opens the fullscreen file viewer.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function openFileViewer(controller) {
		const info = getCurrentFileInfo(controller);
		if (!info || !info.mode) {
			refreshFileViewerState(controller);
			return;
		}

		controller.fileInfo = info;
		controller.currentFileMode = info.mode;
		controller.themeMode = info.mode;
		controller.currentTheme = getThemePreference(info.mode);
		controller.fileContent = '';
		controller.mode = getInitialFileViewerMode(controller, info.mode);
		configureFileViewerTabs(controller, info.mode);
		showFileViewerChrome(controller);
		setFileViewerLoading(controller);
		updateFileViewerToolbar(controller);

		ensureFileViewerEditor(controller, info.mode).then(function () {
			setFileViewerLoading(controller);
			return fetchFileViewerContent(controller, info);
		}).then(function (content) {
			if (!isSameFileInfo(controller.fileInfo, info)) {
				return;
			}
			controller.fileContent = content;
			renderFileViewerContent(controller);
			setFileViewerMode(controller, controller.mode);
		}).catch(function (e) {
			setFileViewerError(controller, e);
		});
	}

	/**
	 * Returns the initial file viewer tab.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {string} mode Matched file mode.
	 * @returns {string}
	 */
	function getInitialFileViewerMode(controller, mode) {
		if (mode !== VIEW_MARKDOWN) {
			return mode;
		}
		const modeConfig = controller.field.markdown || {};
		return modeConfig.initialMode === VIEW_MARKDOWN ? VIEW_MARKDOWN : VIEW_HTML;
	}

	/**
	 * Configures the file viewer tabs for a matched mode.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {string} mode Matched file mode.
	 * @returns {void}
	 */
	function configureFileViewerTabs(controller, mode) {
		const tabs = mode === VIEW_MARKDOWN ? [VIEW_MARKDOWN, VIEW_HTML] : [mode];
		const tabItems = tabs.map(function (tabMode) {
			if (tabMode === mode && shouldShowFileFormatPopover(controller)) {
				return createFileFormatModeTab(controller, mode);
			}
			return createThemeableModeTab(tabMode, getModeLabel(tabMode), mode, controller.$themeButton);
		});
		controller.$tabs.empty();
		controller.$tabs.append(createEditStateIndicator(true));
		if (tabItems.length === 1) {
			controller.$tabs.append(tabItems[0]);
		}
		else {
			appendSeparatedTabs(controller.$tabs, tabItems);
		}
		if (mode !== VIEW_MARKDOWN) {
			controller.$tabs.append(controller.$status);
		}
		initFileFormatPopover(controller);
	}

	/**
	 * Returns whether the current file viewer should expose SQL dialect switching.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {boolean}
	 */
	function shouldShowFileFormatPopover(controller) {
		if (!controller || !controller.fileInfo || getFileExtension(controller.fileInfo.filename) !== 'sql') {
			return false;
		}
		return getConfiguredSqlModes(controller.field).length > 1;
	}

	/**
	 * Builds the file viewer's selected SQL dialect tab with popover trigger.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {string} selectedMode Currently selected SQL dialect mode.
	 * @returns {jQuery}
	 */
	function createFileFormatModeTab(controller, selectedMode) {
		return createFormatModeTab(selectedMode, {
			name: controller.fieldName,
			viewers: getConfiguredSqlModes(controller.field),
		}, selectedMode, controller.$themeButton);
	}

	/**
	 * Initializes the SQL dialect popover for file previews.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function initFileFormatPopover(controller) {
		disposeFileFormatPopover(controller);
		const $button = controller.$toolbar.find(FORMAT_POPOVER_BUTTON_SELECTOR).first();
		if (!$button.length) {
			return;
		}
		controller.$formatPopoverButton = $button;
		$button.data('rcTextViewerController', controller);
		const modes = getConfiguredSqlModes(controller.field);
		const options = {
			html: true,
			content: createFormatPopoverContentForModes({ name: controller.fieldName }, controller.currentFileMode, modes),
			container: 'body',
			customClass: 'rc-text-viewer-format-popover-container',
			placement: 'bottom',
			trigger: 'click',
			sanitize: false,
			title: '',
		};
		if (global.bootstrap && global.bootstrap.Popover) {
			controller.formatPopover = new global.bootstrap.Popover($button[0], options);
		}
		else if ($.fn.popover) {
			$button.popover(options);
			controller.formatPopover = { type: 'jquery' };
		}
		$button.attr('title', getString('button_switch_format', 'Switch format'));
		$(document).on('click' + controller.eventNamespace, FORMAT_RADIO_SELECTOR, function () {
			const mode = $(this).val();
			const activeController = $button.data('rcTextViewerController');
			const fieldName = $(this).closest('.rc-text-viewer-format-popover').attr('data-rc-text-viewer-field') || '';
			if (!activeController || fieldName !== activeController.fieldName || !mode) {
				return;
			}
			switchFileViewerSqlMode(activeController, mode);
		});
	}

	/**
	 * Switches an open SQL file preview to another configured dialect mode.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {string} mode Requested SQL dialect mode.
	 * @returns {void}
	 */
	function switchFileViewerSqlMode(controller, mode) {
		if (!controller || !controller.fileInfo || getConfiguredSqlModes(controller.field).indexOf(mode) === -1 || getFileExtension(controller.fileInfo.filename) !== 'sql') {
			return;
		}
		hideFileFormatPopover(controller);
		if (mode === controller.currentFileMode) {
			return;
		}
		controller.currentFileMode = mode;
		controller.themeMode = mode;
		controller.currentTheme = getThemePreference(mode);
		controller.mode = mode;
		ensureFileViewerEditor(controller, mode).then(function () {
			renderFileViewerContent(controller);
			configureFileViewerTabs(controller, mode);
			setFileViewerMode(controller, mode);
		}).catch(function (e) {
			setFileViewerError(controller, e);
		});
	}

	/**
	 * Hides the active file format popover.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function hideFileFormatPopover(controller) {
		if (!controller || !controller.formatPopover) {
			return;
		}
		if (controller.formatPopover.type !== 'jquery' && typeof controller.formatPopover.hide === 'function') {
			controller.formatPopover.hide();
			return;
		}
		if (controller.$formatPopoverButton && $.fn.popover) {
			controller.$formatPopoverButton.popover('hide');
		}
	}

	/**
	 * Disposes the file format popover.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function disposeFileFormatPopover(controller) {
		if (!controller) {
			return;
		}
		$(document).off(controller.eventNamespace);
		if (!controller.formatPopover) {
			return;
		}
		if (controller.formatPopover.type !== 'jquery' && typeof controller.formatPopover.dispose === 'function') {
			controller.formatPopover.dispose();
		}
		else if (controller.$formatPopoverButton && $.fn.popover) {
			controller.$formatPopoverButton.popover('destroy');
		}
		controller.formatPopover = null;
	}

	/**
	 * Shows the fullscreen file viewer toolbar and panel.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function showFileViewerChrome(controller) {
		if (controller.isOpen) {
			return;
		}
		controller.bodyOverflow = $('body').css('overflow');
		$('body').css('overflow', 'hidden');
		$('body').append(controller.$toolbar, controller.$viewer);
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--fullscreen rc-text-viewer-file-toolbar--fullscreen');
		controller.$viewer.addClass('rc-text-viewer-md-preview--fullscreen rc-text-viewer-file-panel--fullscreen');
		controller.$toolbar.css('display', 'flex');
		controller.$viewer.css('display', 'flex');
		controller.isOpen = true;
	}

	/**
	 * Closes the fullscreen file viewer.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function closeFileViewer(controller) {
		if (!controller || !controller.isOpen) {
			return;
		}
		disposeFileFormatPopover(controller);
		controller.$toolbar.detach();
		controller.$viewer.detach();
		if (controller.bodyOverflow !== null) {
			$('body').css('overflow', controller.bodyOverflow);
			controller.bodyOverflow = null;
		}
		controller.isOpen = false;
	}

	/**
	 * Ensures an Ace editor exists and is configured for the current file mode.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {string} mode Matched file mode.
	 * @returns {Promise}
	 */
	function ensureFileViewerEditor(controller, mode) {
		return ensureAce().then(function () {
			const modeConfig = getFileModeConfig(controller, mode);
			if (!controller.editor) {
				controller.editor = createAceEditor(controller.$editor.attr('id'), {
					mode: mode,
					theme: getPreferredAceTheme(mode),
					readOnly: true,
					useWorker: false,
					indent: modeConfig.indent || 2,
				});
			}
			else {
				const aceMode = getAceModeConfig(mode);
				if (aceMode.module) {
					controller.editor.session.setMode(aceMode.module);
				}
				configureAceIndent(controller.editor, modeConfig.indent || 2);
				controller.editor.setReadOnly(true);
				controller.editor.setTheme(getAceThemeConfig(getPreferredAceTheme(mode)).module);
			}
			controller.editor.resize(true);
		});
	}

	/**
	 * Fetches file text through the module AJAX hook.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {object} info File info parsed from REDCap markup.
	 * @returns {Promise<string>}
	 */
	function fetchFileViewerContent(controller, info) {
		const jsmo = getJavascriptModuleObject();
		if (!jsmo) {
			return Promise.reject(new Error(getString('error_ajax_unavailable', 'The module AJAX object is unavailable.')));
		}
		return jsmo.ajax(AJAX_GET_FILE_CONTENT, {
			docIdHash: info.docIdHash,
			fieldName: controller.fieldName,
			docId: info.docId,
			filename: info.filename,
			mode: info.mode,
		}).then(function (response) {
			if (typeof response === 'string') {
				return response;
			}
			if (response && response.ok === true && typeof response.content === 'string') {
				return response.content;
			}
			if (response && response.ok === false) {
				return rejectFileViewerResponse(response.error || getString('error_file_unavailable', 'This file is not currently available for viewing.'));
			}
			return rejectFileViewerResponse(getString('error_file_preview_response', 'The file preview response was not recognized.'));
		});
	}

	/**
	 * Shows a REDCap dialog for a failed file preview response and rejects the promise chain.
	 *
	 * @param {string} message Error message.
	 * @returns {Promise<never>}
	 */
	function rejectFileViewerResponse(message) {
		return Promise.reject(new Error(message));
	}

	/**
	 * Displays a file preview error using REDCap's dialog helper when available.
	 *
	 * @param {string} message Error message.
	 * @returns {void}
	 */
	function showFileViewerErrorDialog(message) {
		const safeMessage = $('<div class="red"></div>').text(message || getString('error_file_preview_unavailable', 'Unable to load file.'));
		if (typeof global.simpleDialog === 'function') {
			global.simpleDialog(safeMessage, getString('title_file_preview_unavailable', 'File preview unavailable'));
			return;
		}
		LOGGER.warn('File preview unavailable', message);
	}

	/**
	 * Renders fetched file text into Ace and Markdown preview panes.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function renderFileViewerContent(controller) {
		if (!controller.editor) {
			return;
		}
		const mode = controller.currentFileMode;
		const modeConfig = getFileModeConfig(controller, mode);
		const formatted = formatAceText(controller.fileContent, mode, 'pretty', modeConfig.indent || 2);
		controller.editor.setValue(formatted.text, -1);
		if (mode === VIEW_MARKDOWN) {
			renderMarkdownContent(controller.fileContent, controller.$previewContent);
		}
		else {
			setFileViewerStatus(controller, formatted);
		}
		controller.editor.resize(true);
	}

	/**
	 * Sets the active file viewer tab.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {string} mode Desired tab mode.
	 * @returns {void}
	 */
	function setFileViewerMode(controller, mode) {
		if (controller.currentFileMode === VIEW_MARKDOWN) {
			controller.mode = mode === VIEW_MARKDOWN ? VIEW_MARKDOWN : VIEW_HTML;
		}
		else {
			controller.mode = controller.currentFileMode;
		}

		const showEditor = controller.mode === controller.currentFileMode;
		controller.$editor.css('display', showEditor ? 'block' : 'none');
		controller.$previewScroll.css('display', !showEditor && controller.currentFileMode === VIEW_MARKDOWN ? 'block' : 'none');
		if (controller.editor && showEditor) {
			controller.editor.resize(true);
		}
		updateFileViewerToolbar(controller);
	}

	/**
	 * Updates file viewer toolbar state.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function updateFileViewerToolbar(controller) {
		controller.$toolbar.find(MODE_SELECTOR).each(function () {
			const $tab = $(this);
			const active = $tab.attr(MODE_ATTRIBUTE) === controller.mode;
			$tab.toggleClass('active', active);
			$tab.attr('aria-current', active ? 'true' : 'false');
		});
		controller.$toolbar.attr(LAYOUT_ATTRIBUTE, LAYOUT_FULLSCREEN);
		updateThemeButton(controller);
		controller.$themeButton[isThemeToggleVisible(controller) ? 'show' : 'hide']();
	}

	/**
	 * Returns mode config for a file viewer.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {string} mode Enhancement mode.
	 * @returns {object}
	 */
	function getFileModeConfig(controller, mode) {
		return controller.field[mode] || {};
	}

	/**
	 * Shows loading text in the file viewer.
	 *
	 * @param {object} controller File viewer controller.
	 * @returns {void}
	 */
	function setFileViewerLoading(controller) {
		controller.$status.empty();
		controller.$viewer.removeClass('rc-text-viewer--invalid');
		controller.$previewContent.html($('<p/>').text(getString('status_loading', 'Loading...')));
		if (controller.editor) {
			controller.editor.setValue(getString('status_loading', 'Loading...'), -1);
		}
	}

	/**
	 * Shows an error message in the file viewer.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {Error} error Error object.
	 * @returns {void}
	 */
	function setFileViewerError(controller, error) {
		const message = error && error.message ? error.message : String(error || getString('error_file_preview_unavailable', 'Unable to load file.'));
		closeFileViewer(controller);
		showFileViewerErrorDialog(message);
		LOGGER.warn(`File viewer load failed for field '${controller.fieldName}'.`, error);
	}

	/**
	 * Updates file viewer validation status.
	 *
	 * @param {object} controller File viewer controller.
	 * @param {object} formatted Formatting result.
	 * @returns {void}
	 */
	function setFileViewerStatus(controller, formatted) {
		controller.$viewer.toggleClass('rc-text-viewer--invalid', !formatted.ok);
		if (!formatted || formatted.empty) {
			controller.$status.html('').attr('title', '').attr('aria-label', '');
			return;
		}
		if (formatted.ok) {
			const title = formatString('status_valid', 'Valid {mode}', { mode: getModeLabel(controller.currentFileMode) });
			controller.$status
				.attr('title', title)
				.attr('aria-label', title)
				.html($('<i/>', { class: 'fa-solid fa-check text-muted rc-text-viewer-status__valid', 'aria-hidden': 'true' }));
			return;
		}
		const title = formatString('status_invalid', 'Invalid {mode}: {error}', { mode: getModeLabel(controller.currentFileMode), error: formatted.error });
		controller.$status
			.attr('title', title)
			.attr('aria-label', title)
			.html($('<i/>', { class: 'fa-solid fa-triangle-exclamation text-warning rc-text-viewer-status__invalid', 'aria-hidden': 'true' }));
	}

	/**
	 * Appends mode tabs for a controller.
	 *
	 * @param {jQuery} $tabs Toolbar tabs container.
	 * @param {jQuery} $editability Editable/readonly indicator.
	 * @param {object} spec Controller specification.
	 * @param {jQuery} $status Optional status indicator.
	 * @param {object} field Field configuration.
	 * @param {string} selectedMode Selected enhancement mode.
	 * @returns {void}
	 */
	function appendControllerTabs($tabs, $editability, spec, $status, field, selectedMode) {
		const tabItems = spec.tabs.map(function (tabMode) {
			if (tabMode === spec.mode && getConfiguredTextModes(field).length > 1) {
				return createFormatModeTab(tabMode, field, selectedMode, spec.$themeButton);
			}
			return createThemeableModeTab(tabMode, getModeLabel(tabMode), spec.mode, spec.$themeButton);
		});
		$tabs.append($editability);
		if (spec.editorOnly && tabItems.length === 1) {
			$tabs.append(tabItems[0]);
		}
		else {
			appendSeparatedTabs($tabs, tabItems);
		}
		if ($status && $status.length) {
			$tabs.append($status);
		}
	}

	/**
	 * Builds a mode tab and, when applicable, places the theme toggle immediately after it.
	 *
	 * @param {string} tabMode Mode value for this tab.
	 * @param {string|jQuery} label Visible tab label or replacement control.
	 * @param {string} themeMode Mode that supports theme switching.
	 * @param {jQuery} $themeButton Theme toggle button.
	 * @returns {jQuery}
	 */
	function createThemeableModeTab(tabMode, label, themeMode, $themeButton) {
		const $tab = label && label.jquery
			? $('<span/>', { class: 'rc-text-viewer-md-tab active', [MODE_ATTRIBUTE]: tabMode }).append(label)
			: createModeTab(tabMode, label);
		if (!$themeButton || !$themeButton.length || tabMode !== themeMode) {
			return $tab;
		}
		return $('<span/>', { class: 'rc-text-viewer-md-tab-group' }).append($tab, $themeButton);
	}

	/**
	 * Extends a base controller with Markdown behavior.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {object} spec Controller specification.
	 * @returns {void}
	 */
	function extendMarkdownController(controller, spec) {
		const $viewerScroll = $('<div/>', { class: 'rc-text-viewer-md-preview-scroll' });
		const $viewerContent = $('<div/>', { class: 'markdown-body rc-text-viewer-md-preview-content' });
		$.extend(controller, {
			$viewerScroll: $viewerScroll,
			$viewerContent: $viewerContent,
			mdOnly: spec.editorOnly,
			mode: spec.initialMode,
			getActivePanel: function () { return getMarkdownActivePanel(controller); },
			getPanelSet: function () { return controller.$viewer.add(controller.$editorViewer).add(controller.$rawPanel); },
			getContentHeight: function () { return getMarkdownContentHeight(controller); },
			setHeight: function (height, userResize) { setTextViewerHeight(controller, height, userResize !== false); },
			syncSize: function (captureHeight) { syncTextViewerNormalSize(controller, captureHeight); },
			restoreVisibleMode: function () { restoreMarkdownVisibleMode(controller); },
			setMode: function (nextMode) { setMarkdownMode(controller, nextMode); },
			updateToolbar: function () { updateMarkdownToolbar(controller); },
			isPanelMode: function () { return controller.mode === VIEW_MARKDOWN || controller.mode === VIEW_HTML || (controller.mode === VIEW_RAW && controller.canExpandRaw); },
			isThemeableMode: function () { return controller.mode === VIEW_MARKDOWN; },
			defaultMode: spec.defaultMode,
		});
	}

	/**
	 * Extends a base controller with shared Ace-backed behavior.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {object} spec Controller specification.
	 * @param {jQuery} $status Validation status indicator.
	 * @returns {void}
	 */
	function extendAceBackedController(controller, spec, $status) {
		const storageFormat = controller.$control.is('textarea') && spec.modeConfig.format !== 'compact' ? 'pretty' : 'compact';
		$.extend(controller, {
			$status: $status,
			aceMode: spec.mode,
			modeLabel: spec.modeConfig.label || getModeLabel(spec.mode),
			editorOnly: spec.editorOnly,
			normalizes: !!spec.normalizes,
			displayFormat: 'pretty',
			storageFormat: storageFormat,
			indent: spec.modeConfig.indent || 2,
			mode: spec.initialMode,
			renderFromControl: function () { spec.renderFromControl(controller); },
			normalizeEditor: function () { spec.normalizeEditor(controller); },
			getActivePanel: function () { return getAceBackedActivePanel(controller); },
			getPanelSet: function () { return controller.$viewer.add(controller.$rawPanel); },
			getContentHeight: function () { return getAceBackedContentHeight(controller); },
			setHeight: function (height, userResize) { setTextViewerHeight(controller, height, userResize !== false); },
			syncSize: function (captureHeight) { syncTextViewerNormalSize(controller, captureHeight); },
			restoreVisibleMode: function () { restoreAceBackedVisibleMode(controller); },
			setMode: function (nextMode) { setAceBackedMode(controller, nextMode); },
			updateToolbar: function () { updateTextViewerToolbar(controller); },
			isPanelMode: function () { return controller.mode === controller.aceMode || (controller.mode === VIEW_RAW && controller.canExpandRaw); },
			isThemeableMode: function () { return controller.mode === controller.aceMode; },
			defaultMode: spec.defaultMode,
			updatingEditor: false,
			updatingControl: false,
			skipNextControlRender: false,
			editorChangeGeneration: 0,
			suppressedEditorChangeGeneration: null,
		});
	}

	/**
	 * Returns the initial visible mode for a field.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {string} mode Enhanced text field mode.
	 * @param {string} initialMode Initial view mode.
	 * @returns {string}
	 */
	function getInitialMode($control, mode, initialMode) {
		if (mode === VIEW_MARKDOWN && initialMode === VIEW_HTML) {
			return String($control.val() || '').trim() === '' ? VIEW_RAW : initialMode;
		}
		if (initialMode === mode) {
			return initialMode;
		}
		return VIEW_RAW;
	}

	/**
	 * Sets the visible Markdown field mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @param {string} mode Desired mode.
	 * @returns {void}
	 */
	function setMarkdownMode(controller, mode) {
		if (mode === VIEW_HTML) {
			mode = VIEW_HTML;
		}
		else if (controller.mdOnly || mode === VIEW_MARKDOWN) {
			mode = VIEW_MARKDOWN;
		}
		else {
			mode = VIEW_RAW;
		}

		const previousMode = controller.mode;
		const previousLayout = controller.layout;
		if (previousMode === VIEW_RAW && mode !== VIEW_RAW) {
			syncMarkdownFromRaw(controller);
		}
		if (previousMode !== mode && previousLayout !== LAYOUT_NORMAL) {
			rememberTextViewerHeight(controller);
			restoreTextViewerLayout(controller);
		}

		controller.mode = mode;
		if (mode === VIEW_RAW) {
			syncTextViewerNormalSize(controller, true);
			showRawMode(controller);
		}
		else if (mode === VIEW_MARKDOWN) {
			syncTextViewerNormalSize(controller, true);
			showMarkdownEditorMode(controller);
		}
		else {
			syncTextViewerNormalSize(controller, true);
			showHtmlMode(controller);
			renderMarkdown(controller);
		}

		updateMarkdownToolbar(controller);
		if (previousMode !== mode && previousLayout === LAYOUT_EXPANDED) {
			expandTextViewer(controller);
		}
		if (previousMode !== mode && previousLayout === LAYOUT_FULLSCREEN) {
			fullscreenTextViewer(controller);
		}
	}

	/**
	 * Updates Markdown editor/preview from the raw field when leaving Raw mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function syncMarkdownFromRaw(controller) {
		if (controller.editor && controller.editor.getValue() !== (controller.$control.val() || '')) {
			controller.editor.setValue(controller.$control.val() || '', -1);
		}
		renderMarkdown(controller);
	}

	/**
	 * Shows the original REDCap raw textarea state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showRawMode(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			restoreDataCellContents(controller);
		}
		controller.$control.show();
		controller.$rawPanel.css('display', 'flex');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'none');
		controller.$editorViewer.css('display', 'none');
	}

	/**
	 * Shows the normal Markdown editor state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showMarkdownEditorMode(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			restoreDataCellContents(controller);
		}
		controller.$control.hide();
		controller.$rawPanel.css('display', 'none');
		controller.$expandLink.hide();
		controller.$viewer.css('display', 'none');
		controller.$editorViewer.css('display', 'flex');
		if (controller.editor) {
			controller.editor.resize();
		}
	}

	/**
	 * Shows the rendered Markdown HTML preview state.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function showHtmlMode(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			restoreDataCellContents(controller);
		}
		controller.$control.hide();
		controller.$rawPanel.css('display', 'none');
		controller.$expandLink.hide();
		controller.$editorViewer.css('display', 'none');
		controller.$viewer.css('display', 'flex');
	}

	/**
	 * Restores the visible panel for the current Markdown mode.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function restoreMarkdownVisibleMode(controller) {
		if (controller.mode === VIEW_RAW) {
			showRawMode(controller);
			return;
		}
		if (controller.mode === VIEW_MARKDOWN) {
			showMarkdownEditorMode(controller);
			return;
		}
		showHtmlMode(controller);
	}

	/**
	 * Updates toolbar active states and visible action buttons.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function updateMarkdownToolbar(controller) {
		LOGGER.log(`Updating Markdown toolbar for '${controller.fieldName}' in mode '${controller.mode}' and layout '${controller.layout}'`, controller);
		updateTextViewerToolbar(controller);
	}

	/**
	 * Renders current textarea Markdown into the preview.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function renderMarkdown(controller) {
		const markdown = controller.$control.val() || '';
		renderMarkdownContent(markdown, controller.$viewerContent);
	}

	/**
	 * Renders Markdown text into a target element.
	 *
	 * @param {string} markdown Markdown source.
	 * @param {jQuery} $target Target element.
	 * @returns {void}
	 */
	function renderMarkdownContent(markdown, $target) {
		if (!global.marked || typeof global.marked.parse !== 'function') {
			$target.html($('<pre/>').text(markdown));
			return;
		}

		try {
			const html = global.marked.parse(markdown, { breaks: true, gfm: true });
			$target.html(sanitizeHtml(html));
			if (global.hljs) {
				$target.find('pre code').each(function () {
					global.hljs.highlightElement(this);
				});
			}
		}
		catch (e) {
			$target.html($('<pre/>').text(markdown));
			LOGGER.warn('Markdown render failed', e);
		}
	}

	/**
	 * Keeps Markdown panels sized to their REDCap row while in normal layout.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function initMarkdownWindowResize(controller) {
		$(global).on('resize' + controller.eventNamespace, debounce(function () {
			if ((controller.mode === VIEW_MARKDOWN || controller.mode === VIEW_HTML) && controller.layout === LAYOUT_NORMAL) {
				syncTextViewerNormalSize(controller, false);
			}
		}, 100));
	}

	/**
	 * Initializes the full-width resize handles.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function initTextViewerResizeHandles(controller) {
		controller.$resizeHandle.add(controller.$editorResizeHandle).add(controller.$rawResizeHandle).on('mousedown', function (ev) {
			if (controller.layout === LAYOUT_FULLSCREEN) {
				return;
			}
			ev.preventDefault();
			const startY = ev.pageY;
			const startHeight = controller.getActivePanel().outerHeight();
			let resized = false;

			const resizeNamespace = '.rcTextViewerResize' + String(controller.fieldName).replace(/\W/g, '');
			$(document).on('mousemove' + resizeNamespace, function (moveEv) {
				if (!resized) {
					controller.fitToContentActive = false;
					controller.fitToContentRestoreHeight = null;
					resized = true;
				}
				const nextHeight = Math.max(MIN_HEIGHT, startHeight + (moveEv.pageY - startY));
				controller.setHeight(nextHeight, true);
			});
			$(document).on('mouseup' + resizeNamespace, function () {
				$(document).off(resizeNamespace);
			});
		}).on('dblclick', function (ev) {
			ev.preventDefault();
			toggleTextViewerContentHeight(controller);
		});
	}

	/**
	 * Stores the current viewer height for its active layout.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function rememberTextViewerHeight(controller) {
		const height = controller.getActivePanel().outerHeight();
		if (!height) {
			return;
		}
		if (controller.layout === LAYOUT_NORMAL) {
			controller.normalHeight = height;
		}
		if (controller.layout === LAYOUT_EXPANDED) {
			controller.expandedHeight = height;
		}
		if (controller.layout === LAYOUT_FULLSCREEN) {
			controller.fullscreenHeight = height;
		}
	}

	/**
	 * Sets and remembers the viewer height for its active layout.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {number} height Viewer height in pixels.
	 * @returns {void}
	 */
	function setTextViewerHeight(controller, height, userResize) {
		height = Math.max(MIN_HEIGHT, Math.floor(height));
		controller.getPanelSet().css({
			height: height + 'px',
			'min-height': MIN_HEIGHT + 'px',
		});
		controller.$control.css('min-height', '');
		controller.$editor.css('min-height', '');
		if (controller.layout === LAYOUT_NORMAL) {
			controller.normalHeight = height;
			controller.expandedHeight = height;
			if (userResize !== false) {
				controller.userHeight = height;
			}
		}
		if (controller.layout === LAYOUT_EXPANDED) {
			controller.normalHeight = height;
			controller.expandedHeight = height;
			if (userResize !== false) {
				controller.userHeight = height;
			}
		}
		if (controller.layout === LAYOUT_FULLSCREEN) {
			controller.fullscreenHeight = height;
		}
		resizeTextViewerEditor(controller);
	}

	/**
	 * Refreshes an Ace editor after its container size or position changes.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function resizeTextViewerEditor(controller) {
		if (!controller.editor) {
			return;
		}

		controller.editor.resize(true);
		if (global.requestAnimationFrame) {
			global.requestAnimationFrame(function () {
				controller.editor.resize(true);
				global.requestAnimationFrame(function () {
					controller.editor.resize(true);
				});
			});
			return;
		}
		global.setTimeout(function () {
			controller.editor.resize(true);
		}, 0);
	}

	/**
	 * Mirrors the raw field footprint for normal viewer mode.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {boolean} captureHeight Whether to update the remembered normal height.
	 * @returns {void}
	 */
	function syncTextViewerNormalSize(controller, captureHeight) {
		if (controller.layout !== LAYOUT_NORMAL) {
			return;
		}

		const measuredWidth = controller.$control.is(':visible') ? controller.$control.outerWidth() : 0;
		const measuredHeight = controller.$control.is(':visible') ? controller.$control.outerHeight() : 0;
		const width = measuredWidth || controller.normalWidth || controller.$control.parent().width() || 200;
		const cssWidth = controller.canExpandToRowWidth ? width + 'px' : '100%';
		const height = Math.max(controller.userHeight || controller.normalHeight || measuredHeight || MIN_HEIGHT, MIN_HEIGHT);
		if (measuredWidth) {
			controller.normalWidth = measuredWidth;
		}
		if (captureHeight && measuredHeight && !controller.normalHeight && !controller.userHeight) {
			controller.normalHeight = measuredHeight;
		}
		else if (!controller.normalHeight) {
			controller.normalHeight = height;
		}
		controller.$toolbar.css('width', cssWidth);
		controller.$viewer.css({
			width: cssWidth,
			height: height + 'px',
			'min-height': MIN_HEIGHT + 'px',
			'margin-left': '',
		});
		if (controller.$editorViewer && controller.$editorViewer.length) {
			controller.$editorViewer.css({
				width: cssWidth,
				height: height + 'px',
				'min-height': MIN_HEIGHT + 'px',
				'margin-left': '',
			});
		}
		controller.$rawPanel.css({
			width: cssWidth,
			height: height + 'px',
			'min-height': MIN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.$control.css('min-height', '');
		controller.$editor.css('min-height', '');
		controller.$toolbar.css({
			width: cssWidth,
			'margin-left': '',
		});
		resizeTextViewerEditor(controller);
	}

	/**
	 * Expands the active viewer panel to the full REDCap field row width.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function expandTextViewer(controller) {
		if (!controller.canExpandToRowWidth) {
			return;
		}
		if (!controller.isPanelMode()) {
			controller.setMode(controller.defaultMode);
		}
		if (controller.layout !== LAYOUT_NORMAL) {
			rememberTextViewerHeight(controller);
			restoreTextViewerLayout(controller);
		}

		const $panel = controller.getActivePanel();
		const $target = getTextViewerExpandTarget(controller);
		const $expandedCell = createExpandedRow(controller);
		const rowWidth = Math.max((controller.$row.length ? controller.$row.outerWidth() : $target.outerWidth()), $panel.outerWidth());
		const currentHeight = $panel.outerHeight();
		const expandedHeight = controller.userHeight || controller.expandedHeight || Math.max(currentHeight, Math.floor(rowWidth / 2));
		captureTextViewerPlacement(controller);
		$expandedCell.append(controller.$toolbar);
		$expandedCell.append($panel);
		hideDataCellContents(controller, $target);
		controller.$toolbar.css({
			width: '100%',
			'margin-left': '',
		});
		$panel.css({
			width: '100%',
			height: expandedHeight + 'px',
			'min-height': MIN_HEIGHT + 'px',
			'margin-left': '',
		});
		controller.layout = LAYOUT_EXPANDED;
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--expanded');
		$panel.addClass('rc-text-viewer-md-preview--expanded');
		resizeTextViewerEditor(controller);
		controller.updateToolbar();
	}

	/**
	 * Opens the active viewer panel in a fullscreen overlay.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function fullscreenTextViewer(controller) {
		if (!controller.isPanelMode()) {
			controller.setMode(controller.defaultMode);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			rememberTextViewerHeight(controller);
		}
		if (controller.layout !== LAYOUT_FULLSCREEN) {
			captureTextViewerPlacement(controller);
		}
		const $panel = controller.getActivePanel();
		controller.bodyOverflow = $('body').css('overflow');
		$('body').css('overflow', 'hidden');
		$('body').append(controller.$toolbar);
		$('body').append($panel);
		const fullscreenHeight = controller.fullscreenHeight || Math.max($panel.outerHeight(), $(global).height() - 64);
		controller.$toolbar.css({
			width: '',
			'margin-left': '',
		});
		$panel.css({
			width: '',
			height: fullscreenHeight + 'px',
			'min-height': '',
			'margin-left': '',
		});
		controller.layout = LAYOUT_FULLSCREEN;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded');
		controller.$toolbar.addClass('rc-text-viewer-md-toolbar--fullscreen');
		$panel.removeClass('rc-text-viewer-md-preview--expanded');
		$panel.addClass('rc-text-viewer-md-preview--fullscreen');
		resizeTextViewerEditor(controller);
		controller.updateToolbar();
	}

	/**
	 * Collapses an expanded/fullscreen viewer panel.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function collapseTextViewer(controller) {
		if (controller.layout === LAYOUT_NORMAL) {
			controller.updateToolbar();
			return;
		}
		rememberTextViewerHeight(controller);
		restoreTextViewerLayout(controller);
		controller.syncSize(false);
		controller.restoreVisibleMode();
		resizeTextViewerEditor(controller);
		controller.updateToolbar();
	}

	/**
	 * Creates or returns the dedicated expanded table row.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {jQuery}
	 */
	function createExpandedRow(controller) {
		if (controller.$expandedRow && controller.$expandedRow.length) {
			return controller.$expandedRow.find('td').first();
		}

		const colSpan = Math.max(controller.$row.children('td,th').length, 1);
		const $cell = $('<td/>', {
			class: 'rc-text-viewer-md-expanded-cell',
			colspan: colSpan,
		});
		controller.$expandedRow = $('<tr/>', {
			class: 'rc-text-viewer-md-expanded-row',
			'data-rc-text-viewer-expanded-for': controller.fieldName,
		}).append($cell);
		controller.$row.after(controller.$expandedRow);
		return $cell;
	}

	/**
	 * Returns the container used for row-expanded mode.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {jQuery}
	 */
	function getTextViewerExpandTarget(controller) {
		let $target = controller.$row.length ? controller.$row.find('td.data').last() : controller.$control.closest('td');
		if (!$target.length && controller.$row.length) {
			$target = controller.$row.find('td').last();
		}
		if (!$target.length) {
			$target = controller.$control.parent();
		}
		if (
			$target[0] === controller.$toolbar[0]
			|| $target[0] === controller.$viewer[0]
			|| (controller.$editorViewer && $target[0] === controller.$editorViewer[0])
			|| (controller.$rawPanel && $target[0] === controller.$rawPanel[0])
			|| $.contains(controller.$toolbar[0], $target[0])
			|| $.contains(controller.$viewer[0], $target[0])
			|| (controller.$editorViewer && controller.$editorViewer[0] && $.contains(controller.$editorViewer[0], $target[0]))
			|| (controller.$rawPanel && controller.$rawPanel[0] && $.contains(controller.$rawPanel[0], $target[0]))
		) {
			$target = controller.$control.parent();
		}
		return $target;
	}

	/**
	 * Restores moved toolbar and active panel from expanded/fullscreen layouts.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function restoreTextViewerLayout(controller) {
		restoreTextViewerPlacement(controller);
		restoreDataCellContents(controller);
		if (controller.$expandedRow && controller.$expandedRow.length) {
			controller.$expandedRow.remove();
			controller.$expandedRow = null;
		}
		controller.layout = LAYOUT_NORMAL;
		controller.$toolbar.removeClass('rc-text-viewer-md-toolbar--expanded rc-text-viewer-md-toolbar--fullscreen');
		controller.getPanelSet().removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		controller.$rawPanel.removeClass('rc-text-viewer-md-preview--expanded rc-text-viewer-md-preview--fullscreen');
		if (controller.bodyOverflow !== null) {
			$('body').css('overflow', controller.bodyOverflow);
			controller.bodyOverflow = null;
		}
	}

	/**
	 * Temporarily hides original data-cell contents while row-expanded.
	 *
	 * @param {object} controller Text viewer controller.
	 * @param {jQuery} $dataCell Original REDCap data cell.
	 * @returns {void}
	 */
	function hideDataCellContents(controller, $dataCell) {
		controller.$dataCell = $dataCell;
		$dataCell.children().each(function () {
			const $child = $(this);
			if (
				$child[0] === controller.$toolbar[0]
				|| $child[0] === controller.$viewer[0]
				|| (controller.$editorViewer && $child[0] === controller.$editorViewer[0])
				|| (controller.$rawPanel && $child[0] === controller.$rawPanel[0])
			) {
				return;
			}
			if (typeof $child.data('rcTextViewerOriginalDisplay') === 'undefined') {
				$child.data('rcTextViewerOriginalDisplay', this.style.display || '');
			}
			$child.hide();
		});
	}

	/**
	 * Restores original data-cell contents after row-expanded mode.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function restoreDataCellContents(controller) {
		if (!controller.$dataCell || !controller.$dataCell.length) {
			return;
		}
		controller.$dataCell.children().each(function () {
			const $child = $(this);
			const originalDisplay = $child.data('rcTextViewerOriginalDisplay');
			if (typeof originalDisplay === 'undefined') {
				return;
			}
			this.style.display = originalDisplay;
			$child.removeData('rcTextViewerOriginalDisplay');
		});
		controller.$dataCell = null;
	}

	/**
	 * Captures the current preview DOM position.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function captureTextViewerPlacement(controller) {
		if (controller.restoreParent) {
			return;
		}
		const $panel = controller.getActivePanel();
		controller.$movedPanel = $panel;
		controller.restoreParent = $panel.parent()[0];
		controller.restoreNext = $panel[0].nextSibling;
	}

	/**
	 * Restores the preview to its original DOM position.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {void}
	 */
	function restoreTextViewerPlacement(controller) {
		if (!controller.restoreParent) {
			return;
		}
		const $panel = controller.$movedPanel || controller.getActivePanel();
		if (controller.restoreNext) {
			controller.restoreParent.insertBefore($panel[0], controller.restoreNext);
		}
		else {
			controller.restoreParent.appendChild($panel[0]);
		}
		const $toolbarAnchor = controller.$rawPanel && controller.$rawPanel.parent().length ? controller.$rawPanel : controller.$control;
		$toolbarAnchor.before(controller.$toolbar);
		controller.restoreParent = null;
		controller.restoreNext = null;
		controller.$movedPanel = null;
	}

	/**
	 * Returns the active enhanced Markdown panel.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {jQuery}
	 */
	function getMarkdownActivePanel(controller) {
		if (controller.mode === VIEW_RAW) {
			return controller.$rawPanel;
		}
		return controller.mode === VIEW_MARKDOWN ? controller.$editorViewer : controller.$viewer;
	}

	/**
	 * Calculates the content height for the active Markdown panel.
	 *
	 * @param {object} controller Markdown controller.
	 * @returns {number}
	 */
	function getMarkdownContentHeight(controller) {
		if (controller.mode === VIEW_RAW) {
			const control = controller.$control[0];
			return control ? control.scrollHeight + controller.$rawResizeHandle.outerHeight() : MIN_HEIGHT;
		}
		if (controller.mode === VIEW_MARKDOWN && controller.editor) {
			const lineHeight = controller.editor.renderer.lineHeight || 16;
			return (controller.editor.session.getScreenLength() * lineHeight) + 24;
		}
		if (controller.mode === VIEW_HTML) {
			return controller.$viewerContent.outerHeight(true) + controller.$resizeHandle.outerHeight() + 24;
		}
		return MIN_HEIGHT;
	}

	/**
	 * Expands the active panel to fit its content vertically.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function expandTextViewerToContent(controller) {
		controller.setHeight(controller.getContentHeight(), true);
	}

	/**
	 * Toggles the active panel between fit-content and its previous height.
	 *
	 * @param {object} controller Text viewer controller.
	 * @returns {void}
	 */
	function toggleTextViewerContentHeight(controller) {
		if (controller.fitToContentActive) {
			controller.setHeight(controller.fitToContentRestoreHeight || MIN_HEIGHT, true);
			controller.fitToContentActive = false;
			controller.fitToContentRestoreHeight = null;
			return;
		}
		controller.fitToContentRestoreHeight = Math.max(controller.getActivePanel().outerHeight() || MIN_HEIGHT, MIN_HEIGHT);
		expandTextViewerToContent(controller);
		controller.fitToContentActive = true;
	}

	/**
	 * Ensures the bundled Ace editor is loaded and configured.
	 *
	 * @returns {Promise}
	 */
	function ensureAce() {
		const aceConfig = getAceConfig();
		const scriptUrl = aceConfig.script || (state.config.urls && state.config.urls.ace);
		return ensureScript(scriptUrl, function () {
			return !!global.ace;
		}).then(function () {
			configureAce(aceConfig);
			return global.ace;
		});
	}

	/**
	 * Returns Ace loader and module configuration.
	 *
	 * @returns {object}
	 */
	function getAceConfig() {
		return state.config.ace || {};
	}

	/**
	 * Registers bundled Ace module URLs.
	 *
	 * @param {object} aceConfig Ace loader and module configuration.
	 * @returns {void}
	 */
	function configureAce(aceConfig) {
		if (state.aceConfigured || !global.ace || !global.ace.config) {
			return;
		}

		registerAceModuleUrls(aceConfig.modes || {});
		registerAceModuleUrls(aceConfig.themes || {});
		Object.keys(aceConfig.workers || {}).forEach(function (module) {
			global.ace.config.setModuleUrl(module, aceConfig.workers[module]);
		});
		state.aceConfigured = true;
	}

	/**
	 * Registers a keyed Ace module descriptor map.
	 *
	 * @param {object} modules Ace module descriptor map.
	 * @returns {void}
	 */
	function registerAceModuleUrls(modules) {
		Object.keys(modules || {}).forEach(function (key) {
			const moduleConfig = modules[key] || {};
			if (moduleConfig.module && moduleConfig.url) {
				global.ace.config.setModuleUrl(moduleConfig.module, moduleConfig.url);
			}
		});
	}

	/**
	 * Creates an Ace editor with module-local defaults.
	 *
	 * @param {string} editorId Ace editor element id.
	 * @param {object} options Editor options.
	 * @returns {object}
	 */
	function createAceEditor(editorId, options) {
		const aceConfig = getAceConfig();
		const modeConfig = getAceModeConfig(options.mode);
		const themeConfig = getAceThemeConfig(options.theme || aceConfig.theme);
		const editor = global.ace.edit(editorId);
		editor.setTheme(themeConfig.module);
		if (modeConfig.module) {
			editor.session.setMode(modeConfig.module);
		}
		configureAceIndent(editor, options.indent);
		editor.setReadOnly(!!options.readOnly);
		editor.setShowPrintMargin(false);
		editor.setHighlightActiveLine(false);
		editor.session.setUseWorker(!!options.useWorker && !!aceConfig.useWorker);
		editor.renderer.setShowGutter(true);
		editor.renderer.setScrollMargin(6, 6, 0, 0);
		return editor;
	}

	/**
	 * Applies indentation settings to an Ace editor session.
	 *
	 * @param {object} editor Ace editor.
	 * @param {number|string} indent Indentation config.
	 * @returns {void}
	 */
	function configureAceIndent(editor, indent) {
		if (indent === 'tab') {
			editor.session.setUseSoftTabs(false);
			return;
		}
		const spaces = parseInt(indent, 10);
		if (Number.isFinite(spaces) && spaces > 0) {
			editor.session.setUseSoftTabs(true);
			editor.session.setTabSize(Math.min(spaces, 8));
		}
	}

	/**
	 * Returns the configured Ace mode descriptor for a language key.
	 *
	 * @param {string} mode Language mode key.
	 * @returns {object}
	 */
	function getAceModeConfig(mode) {
		const modes = getAceConfig().modes || {};
		const modeConfig = modes[mode] || {};
		return $.extend({
			module: mode ? 'ace/mode/' + mode : null,
			url: null,
			worker: null,
		}, modeConfig);
	}

	/**
	 * Returns the configured Ace theme descriptor.
	 *
	 * @param {string} theme Theme key or Ace theme module id.
	 * @returns {object}
	 */
	function getAceThemeConfig(theme) {
		const themeName = theme || 'github_light_default';
		const themes = getAceConfig().themes || {};
		const themeConfig = themes[themeName] || {};
		return $.extend({
			module: themeName.indexOf('ace/theme/') === 0 ? themeName : 'ace/theme/' + themeName,
			url: null,
			worker: null,
		}, themeConfig);
	}

	/**
	 * Ensures a script URL is available.
	 *
	 * @param {string} url Script URL.
	 * @param {Function} isReady Ready check.
	 * @returns {Promise}
	 */
	function ensureScript(url, isReady) {
		if (isReady()) {
			return Promise.resolve();
		}
		if (state.acePromise) {
			return state.acePromise;
		}
		state.acePromise = new Promise(function (resolve, reject) {
			if (!url) {
				reject(new Error('Script URL is missing'));
				return;
			}
			const script = document.createElement('script');
			script.src = url;
			script.type = 'text/javascript';
			script.onload = function () { resolve(); };
			script.onerror = function () { reject(new Error('Unable to load ' + url)); };
			document.head.appendChild(script);
		});
		return state.acePromise;
	}

	/**
	 * Formats text for an Ace language mode.
	 *
	 * @param {string} raw Raw editor value.
	 * @param {string} mode Ace language mode key.
	 * @param {string} format Storage/display format.
	 * @param {number|string} indent Indentation config.
	 * @returns {object}
	 */
	function formatAceText(raw, mode, format, indent) {
		const text = String(raw || '');
		if (text.trim() === '') {
			return { ok: true, empty: true, text: '' };
		}
		if (mode === 'css') {
			return { ok: true, empty: false, text: formatCss(text, format, indent) };
		}
		if (mode === 'xml') {
			return formatXml(text, format, indent);
		}
		if (mode === 'json') {
			return formatJson(text, format, indent);
		}
		return { ok: true, empty: false, text: text };
	}

	/**
	 * Returns formatted JSON text and validation state.
	 *
	 * @param {string} raw Raw field value.
	 * @param {string} format Storage/display format.
	 * @returns {object}
	 */
	function formatJson(raw, format, indent) {
		try {
			const parsed = JSON.parse(raw);
			return { ok: true, empty: false, text: stringifyJson(parsed, format, indent) };
		}
		catch (e) {
			return { ok: false, empty: false, text: raw, error: e.message || String(e) };
		}
	}

	/**
	 * Serializes parsed JSON using the requested format.
	 *
	 * @param {any} parsed Parsed JSON value.
	 * @param {string} format Storage/display format.
	 * @returns {string}
	 */
	function stringifyJson(parsed, format, indent) {
		return JSON.stringify(parsed, null, format === 'compact' ? 0 : getIndentText(indent));
	}

	/**
	 * Returns an indentation string for formatter modes.
	 *
	 * @param {number|string} indent Indentation config.
	 * @returns {string}
	 */
	function getIndentText(indent) {
		if (indent === 'tab') {
			return '\t';
		}
		const spaces = parseInt(indent, 10);
		if (Number.isFinite(spaces) && spaces > 0) {
			return new Array(Math.min(spaces, 8) + 1).join(' ');
		}
		return '  ';
	}

	/**
	 * Formats CSS with a small, conservative token-based formatter.
	 *
	 * @param {string} raw Raw CSS.
	 * @param {string} format Storage/display format.
	 * @param {number|string} indent Indentation config.
	 * @returns {string}
	 */
	function formatCss(raw, format, indent) {
		const compact = String(raw || '')
			.replace(/\/\*[\s\S]*?\*\//g, function (match) { return match.replace(/\s+/g, ' '); })
			.replace(/\s+/g, ' ')
			.replace(/\s*([{}:;,>+~])\s*/g, '$1')
			.replace(/;}/g, '}')
			.trim();
		if (format === 'compact') {
			return compact;
		}

		const indentText = getIndentText(indent);
		let level = 0;
		return compact
			.replace(/\{/g, ' {\n')
			.replace(/;/g, ';\n')
			.replace(/\}/g, '\n}\n')
			.split('\n')
			.map(function (line) {
				line = line.trim();
				if (line === '') {
					return '';
				}
				if (line.charAt(0) === '}') {
					level = Math.max(level - 1, 0);
				}
				const output = new Array(level + 1).join(indentText) + line;
				if (line.charAt(line.length - 1) === '{') {
					level += 1;
				}
				return output;
			})
			.filter(function (line) { return line !== ''; })
			.join('\n');
	}

	/**
	 * Formats XML and reports parser errors.
	 *
	 * @param {string} raw Raw XML.
	 * @param {string} format Storage/display format.
	 * @param {number|string} indent Indentation config.
	 * @returns {object}
	 */
	function formatXml(raw, format, indent) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(String(raw || ''), 'application/xml');
		const parseError = doc.getElementsByTagName('parsererror')[0];
		if (parseError) {
			return { ok: false, empty: false, text: raw, error: parseError.textContent || getString('error_xml_parse', 'XML parse error') };
		}

		const serialized = new XMLSerializer().serializeToString(doc);
		const compact = serialized.replace(/>\s+</g, '><').trim();
		if (format === 'compact') {
			return { ok: true, empty: false, text: compact };
		}
		return { ok: true, empty: false, text: prettyXml(compact, indent) };
	}

	/**
	 * Pretty-prints compact XML.
	 *
	 * @param {string} compactXml Compact XML.
	 * @param {number|string} indent Indentation config.
	 * @returns {string}
	 */
	function prettyXml(compactXml, indent) {
		const indentText = getIndentText(indent);
		let level = 0;
		return compactXml
			.replace(/(>)(<)(\/*)/g, '$1\n$2$3')
			.split('\n')
			.map(function (line) {
				line = line.trim();
				if (line === '') {
					return '';
				}
				if (/^<\//.test(line)) {
					level = Math.max(level - 1, 0);
				}
				const output = new Array(level + 1).join(indentText) + line;
				if (/^<[^!?/][^>]*[^/]?>$/.test(line) && !/^<[^>]+>.*<\/[^>]+>$/.test(line)) {
					level += 1;
				}
				return output;
			})
			.filter(function (line) { return line !== ''; })
			.join('\n');
	}

	/**
	 * Renders the raw field value into a generic Ace editor.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function renderAceTextFromControl(controller) {
		const formatted = formatAceText(controller.$control.val() || '', controller.aceMode, controller.displayFormat, controller.indent);
		setAceTextStatus(controller, formatted);
		if (!controller.editor) {
			return;
		}
		controller.updatingEditor = true;
		setAceTextEditorValue(controller, formatted.text);
		controller.updatingEditor = false;
		resizeTextViewerEditor(controller);
	}

	/**
	 * Sets Ace editor text without treating the event as a user edit.
	 *
	 * @param {object} controller Ace text controller.
	 * @param {string} value Editor value.
	 * @returns {void}
	 */
	function setAceTextEditorValue(controller, value) {
		controller.editorChangeGeneration += 1;
		controller.suppressedEditorChangeGeneration = controller.editorChangeGeneration;
		controller.editor.setValue(value, -1);
	}

	/**
	 * Syncs Ace editor content into the raw REDCap field.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function syncAceTextFromEditor(controller) {
		if (!controller.editor || controller.updatingEditor) {
			return;
		}
		const raw = controller.editor.getValue();
		const displayFormatted = formatAceText(raw, controller.aceMode, controller.displayFormat, controller.indent);
		setAceTextStatus(controller, displayFormatted);
		if (!displayFormatted.ok || controller.editor.getReadOnly()) {
			return;
		}
		const storageFormatted = formatAceText(raw, controller.aceMode, controller.storageFormat, controller.indent);
		if ((controller.$control.val() || '') === storageFormatted.text) {
			return;
		}
		controller.skipNextControlRender = true;
		controller.updatingControl = true;
		controller.$control.val(storageFormatted.text).trigger('change');
		controller.updatingControl = false;
	}

	/**
	 * Normalizes Ace editor content when supported by the mode.
	 *
	 * @param {object} controller Ace text controller.
	 * @returns {void}
	 */
	function normalizeAceTextEditor(controller) {
		if (!controller.editor || controller.updatingEditor || !controller.normalizes) {
			return;
		}
		const formatted = formatAceText(controller.editor.getValue(), controller.aceMode, controller.displayFormat, controller.indent);
		setAceTextStatus(controller, formatted);
		if (!formatted.ok) {
			return;
		}
		controller.updatingEditor = true;
		setAceTextEditorValue(controller, formatted.text);
		controller.updatingEditor = false;
		syncAceTextFromEditor(controller);
		resizeTextViewerEditor(controller);
	}

	/**
	 * Updates generic Ace text validation status.
	 *
	 * @param {object} controller Ace text controller.
	 * @param {object} formatted Formatting result.
	 * @returns {void}
	 */
	function setAceTextStatus(controller, formatted) {
		controller.$viewer.toggleClass('rc-text-viewer--invalid', !formatted.ok);
		controller.$toolbar.toggleClass('rc-text-viewer--invalid', !formatted.ok);
		if (!controller.normalizes || formatted.empty) {
			controller.$status.html('').attr('title', '').attr('aria-label', '');
			return;
		}
		if (formatted.ok) {
			const title = formatString('status_valid', 'Valid {mode}', { mode: controller.modeLabel });
			controller.$status
				.attr('title', title)
				.attr('aria-label', title)
				.html($('<i/>', { class: 'fa-solid fa-check text-muted rc-text-viewer-status__valid', 'aria-hidden': 'true' }));
			return;
		}
		const title = formatString('status_invalid', 'Invalid {mode}: {error}', { mode: controller.modeLabel, error: formatted.error });
		controller.$status
			.attr('title', title)
			.attr('aria-label', title)
			.html($('<i/>', { class: 'fa-solid fa-triangle-exclamation text-warning rc-text-viewer-status__invalid', 'aria-hidden': 'true' }));
	}

	/**
	 * Attaches all configured viewers after REDCap has rendered the form.
	 *
	 * @returns {void}
	 */
	function attachConfiguredViewers() {
		(state.config.fields || []).forEach(function (field) {
			if (field.isFile) {
				attachEnhancedFileViewer(field);
				return;
			}

			const $control = findFieldControl(field.name);
			if (!$control.length) {
				LOGGER.warn('Field control not found', field.name);
				return;
			}

			const mode = determineInitialModeForField($control, field);
			const key = `${NS}-isInitialized`;
			if (mode === '' || $control.data(key)) {
				return;
			}
			$control.data(key, true);
			attachEnhancedTextViewer($control, field, mode);
		});
	}

	/**
	 * Returns supported text enhancement modes configured for a field.
	 *
	 * @param {object} field Field configuration.
	 * @returns {string[]}
	 */
	function getConfiguredTextModes(field) {
		const seen = {};
		return (field.viewers || []).filter(function (mode) {
			if (!isSupportedEnhancementMode(mode) || seen[mode]) {
				return false;
			}
			seen[mode] = true;
			return true;
		});
	}

	/**
	 * Determines the initial enhancement mode for a text field.
	 *
	 * @param {jQuery} $control Field input or textarea.
	 * @param {object} field Field configuration.
	 * @returns {string}
	 */
	function determineInitialModeForField($control, field) {
		const modes = getConfiguredTextModes(field);
		if (!modes.length) {
			return '';
		}
		const sniffedMode = sniffConfiguredTextMode($control.val() || '', modes);
		if (sniffedMode) {
			return sniffedMode;
		}
		const configuredInitial = modes.filter(function (mode) {
			const modeConfig = field[mode] || {};
			return modeConfig.initialMode === mode || (mode === VIEW_MARKDOWN && modeConfig.initialMode === VIEW_HTML);
		})[0];
		return configuredInitial || modes[0];
	}

	/**
	 * Guesses the content type among configured enhancement modes.
	 *
	 * @param {string} value Field content.
	 * @param {string[]} modes Configured enhancement modes.
	 * @returns {string}
	 */
	function sniffConfiguredTextMode(value, modes) {
		const text = String(value || '').trim();
		if (text === '') {
			return '';
		}
		const sniffers = {
			json: sniffJson,
			xml: sniffXml,
			css: sniffCss,
			sql: sniffSql,
			mysql: sniffSql,
			mariadb: sniffSql,
			pgsql: sniffSql,
			ini: sniffIni,
			yaml: sniffYaml,
			r: sniffR,
			markdown: sniffMarkdown,
			text: sniffPlainText,
		};
		return modes.filter(function (mode) {
			return sniffers[mode] && sniffers[mode](text, modes);
		})[0] || '';
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffJson(text) {
		if (!/^[\[{"]|^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$|^(?:true|false|null)$/.test(text)) {
			return false;
		}
		try {
			JSON.parse(text);
			return true;
		}
		catch (e) {
			return false;
		}
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffXml(text) {
		if (text.charAt(0) !== '<' || text.indexOf('>') === -1) {
			return false;
		}
		return formatXml(text, 'compact', 2).ok;
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffCss(text) {
		return /[.#@a-zA-Z][^{;]*\{[^}]*:[^}]*\}/.test(text) || /^@[a-z-]+\s+/i.test(text);
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffSql(text) {
		return /\b(?:select|insert|update|delete|create|alter|drop|with|from|where|join|table|view|index)\b/i.test(text)
			|| (/;\s*$/.test(text) && /\b(?:on|set|values|group\s+by|order\s+by|limit|returning)\b/i.test(text));
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffIni(text) {
		return /(^|\n)\s*\[[^\]\n]+\]\s*(\n|$)/.test(text) || /(^|\n)\s*[A-Za-z0-9_.-]+\s*=\s*.+/.test(text);
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffYaml(text) {
		if (/^---\s*(\n|$)/.test(text)) {
			return true;
		}
		return /(^|\n)\s*[A-Za-z0-9_.-]+\s*:\s+\S/.test(text) || /(^|\n)\s*-\s+\S/.test(text);
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffR(text) {
		return /(^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*<-\s*/.test(text)
			|| /\b(?:library|require|data\.frame|function)\s*\(/.test(text);
	}

	/**
	 * @param {string} text Field content.
	 * @returns {boolean}
	 */
	function sniffMarkdown(text) {
		return /(^|\n)#{1,6}\s+\S/.test(text)
			|| /(^|\n)\s*[-*+]\s+\S/.test(text)
			|| /\[[^\]]+\]\([^)]+\)/.test(text)
			|| /(^|\n)```/.test(text);
	}

	/**
	 * @param {string} text Field content.
	 * @param {string[]} modes Configured enhancement modes.
	 * @returns {boolean}
	 */
	function sniffPlainText(text, modes) {
		return modes.length === 1 && modes[0] === 'text' && text !== '';
	}

	/**
	 * Initializes the module.
	 *
	 * @param {object} config Client configuration emitted by PHP.
	 * @returns {object}
	 */
	function init(config) {
		state.config = $.extend(true, {
			debug: false,
			fields: [],
			jsmoName: null,
			labels: {
				raw: 'Raw',
				text: 'Text',
				markdown: 'Markdown',
				html: 'HTML',
				json: 'JSON',
				css: 'CSS',
				sql: 'SQL',
				mysql: 'SQL (MySQL)',
				mariadb: 'SQL (MariaDB)',
				pgsql: 'SQL (PostgreSQL)',
				ini: 'INI',
				r: 'R',
				xml: 'XML',
				yaml: 'YAML',
			},
			strings: {
				display_editable: 'Editable',
				display_readonly: 'Readonly',
				button_close: 'Close',
				button_collapse: 'Collapse',
				button_expand: 'Expand to row width',
				button_fullscreen: 'Fullscreen',
				button_switch_format: 'Switch format',
				button_switch_dark: 'Switch to dark mode',
				button_switch_light: 'Switch to light mode',
				button_view: 'View',
				aria_view_file: 'View {filename}',
				error_ajax_unavailable: 'The module AJAX object is unavailable.',
				error_file_preview_response: 'The file preview response was not recognized.',
				error_file_preview_unavailable: 'Unable to load file.',
				error_file_unavailable: 'This file is not currently available for viewing.',
				error_xml_parse: 'XML parse error',
				label_format: 'Format',
				label_or: 'or',
				status_loading: 'Loading...',
				status_invalid: 'Invalid {mode}: {error}',
				status_valid: 'Valid {mode}',
				title_file_preview_unavailable: 'File preview unavailable',
				title_resize: 'Drag to resize',
				title_view_file: 'View {mode} file',
			},
			themePreferences: {
				text: THEME_LIGHT,
				json: THEME_LIGHT,
				markdown: THEME_LIGHT,
				css: THEME_LIGHT,
				sql: THEME_LIGHT,
				mysql: THEME_LIGHT,
				mariadb: THEME_LIGHT,
				pgsql: THEME_LIGHT,
				ini: THEME_LIGHT,
				r: THEME_LIGHT,
				xml: THEME_LIGHT,
				yaml: THEME_LIGHT,
			},
			ace: {
				script: null,
				theme: 'github_light_default',
				useWorker: false,
				modes: {},
				themes: {},
				workers: {},
			},
			urls: {
				ace: null,
			},
		}, config || {});

		LOGGER.configure({ active: !!state.config.debug });
		LOGGER.log('Initialized', state.config);

		$(attachConfiguredViewers);
		return {
			config: state.config,
			refresh: attachConfiguredViewers,
			editors: state.editors,
			controllers: state.controllers,
		};
	}

	global[NS] = {
		init: init,
		refresh: attachConfiguredViewers,
	};
})(window, jQuery);
