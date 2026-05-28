<?php

namespace DE\RUB\SEG\EnhancedTextFieldsExternalModule;

/**
 * External Module entry point for enhanced text fields.
 */
class EnhancedTextFieldsExternalModule extends \ExternalModules\AbstractExternalModule
{
	/**
	 * Whether browser-side debug logging should be enabled.
	 *
	 * @var bool
	 */
	private $js_debug = false;

	// Action tags
	const AT_ENHANCED_TEXT_PLAIN = "@ENHANCED-TEXT-PLAIN";
	const AT_ENHANCED_TEXT_JSON = "@ENHANCED-TEXT-JSON";
	const AT_ENHANCED_TEXT_MARKDOWN = "@ENHANCED-TEXT-MARKDOWN";
	const AT_ENHANCED_TEXT_CSS = "@ENHANCED-TEXT-CSS";
	const AT_ENHANCED_TEXT_INI = "@ENHANCED-TEXT-INI";
	const AT_ENHANCED_TEXT_R = "@ENHANCED-TEXT-R";
	const AT_ENHANCED_TEXT_XML = "@ENHANCED-TEXT-XML";
	const AT_ENHANCED_TEXT_YAML = "@ENHANCED-TEXT-YAML";

	// AJAX actions
	const AJAX_SAVE_THEME_PREFERENCE = 'save-theme-preference';
	const AJAX_GET_FILE_CONTENT = 'get-file-content';

	const DEFAULT_FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

	// Theme setting persistence
	const THEME_SETTING_PREFIX = 'theme-preference:';



	#region Hooks

	/**
	 * Inject enhanced text fields on regular data entry forms.
	 *
	 * @param int         $project_id      REDCap project id.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $group_id        Current DAG id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @return void
	 */
	function redcap_data_entry_form_top($project_id, $record, $instrument, $event_id, $group_id, $repeat_instance)
	{
		try {
			$user_id = $this->framework->getUser()->getUsername();
			$Proj = $GLOBALS['Proj'];
			$this->injectEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, $user_id);
		} catch (\Throwable $e) {
			// Ignore - if there is no user, we should not do anything
		}
	}

	/**
	 * Inject enhanced text fields on survey pages.
	 *
	 * @param int         $project_id      REDCap project id.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $group_id        Current DAG id.
	 * @param string      $survey_hash     Survey hash.
	 * @param int|null    $response_id     Survey response id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @return void
	 */
	function redcap_survey_page_top($project_id, $record, $instrument, $event_id, $group_id, $survey_hash, $response_id, $repeat_instance)
	{
		$Proj = $GLOBALS['Proj'];
		$this->injectEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, null);
	}

	/**
	 * Handles authenticated ajax requests from the JavaScript Module Object.
	 *
	 * @param string      $action             Ajax action name.
	 * @param mixed       $payload            Ajax payload sent by the client.
	 * @param int|null    $project_id         REDCap project id.
	 * @param string|null $record             Current record id.
	 * @param string|null $instrument         Current instrument name.
	 * @param int|null    $event_id           Current event id.
	 * @param int|null    $repeat_instance    Current repeat instance.
	 * @param string|null $survey_hash        Current survey hash.
	 * @param int|null    $response_id        Current survey response id.
	 * @param string|null $survey_queue_hash  Current survey queue hash.
	 * @param string|null $page               Current page.
	 * @param string|null $page_full          Current full page path.
	 * @param string|null $user_id            Current REDCap username.
	 * @param int|null    $group_id           Current DAG id.
	 * @return array|null
	 */
	function redcap_module_ajax($action, $payload, $project_id, $record, $instrument, $event_id, $repeat_instance, $survey_hash, $response_id, $survey_queue_hash, $page, $page_full, $user_id, $group_id)
	{
		switch ($action) {
			case self::AJAX_SAVE_THEME_PREFERENCE:
				return $this->saveThemePreference($payload, $user_id);
			case self::AJAX_GET_FILE_CONTENT:
				return $this->getFileContent($payload, $project_id, $user_id, $instrument, $survey_hash, $record);
		}
	}

	#endregion

	/**
	 * Finds enhanced fields and injects all required CSS/JS for the current page.
	 *
	 * @param \Project    $Proj            REDCap project.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @param string|null $user_id         The current user (or null on survey pages).
	 * @return void
	 */
	private function injectEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, $user_id)
	{
		$is_survey = $user_id === null;
		// Check if there are any enhanced fields to inject
		$enhanced_fields = $this->getEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, $is_survey);
		if (empty($enhanced_fields)) {
			return;
		}

		// Remove readonly from enhanced fields
		$this->removeREDCapReadonly($Proj, $enhanced_fields);

		$this->js_debug = $this->getProjectSetting('javascript-debug') == '1';

		// Build client config
		$config = array(
			'debug' => $this->js_debug,
			'isSurvey' => $is_survey,
			'jsmoName' => $this->getJavascriptModuleObjectName(),
			'themePreferences' => $this->getThemePreferences($user_id),
			'fields' => $enhanced_fields,
			'labels' => $this->getModeLabels(),
			'ace' => $this->getAceConfig(),
		);
		$config_json = json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

		// Inject CSS and JS
		$inject = InjectionHelper::init($this);
		$inject->css('css/enhanced-text-fields.css');
		if ($this->hasEnhancementType($enhanced_fields, 'markdown')) {
			$inject->css('css/github-markdown-light.css');
			$inject->css('css/highlight-theme.css');
			$inject->js('js/marked.min.js');
			$inject->js('js/highlight.min.js');
			$inject->js('js/sir-hljs-languages.js');
		}
		$inject->js('js/ConsoleDebugLogger.js');
		$inject->js('js/enhanced-text-fields.js');

		// Inject the JSMO and the module initialization code.
		$this->initializeJavascriptModuleObject();
?>
		<script type="text/javascript">
			DE_RUB_SEG_EnhancedTextFieldsEM.init(<?= $config_json ?>);
		</script>
<?php
	}


	/**
	 * Builds client-side Ace loader configuration from the bundled Ace assets.
	 *
	 * @return array
	 */
	private function getAceConfig()
	{
		$ace_path = 'js/ace/src-noconflict/';
		return array(
			'script' => $this->getModuleResourceUrl($ace_path . 'ace.js'),
			'theme' => 'github_light_default',
			'useWorker' => false,
			'modes' => array(
				'json' => $this->getAceModuleConfig('ace/mode/json', $ace_path . 'mode-json.js', 'ace/mode/json_worker'),
				'markdown' => $this->getAceModuleConfig('ace/mode/markdown', $ace_path . 'mode-markdown.js', null),
				'text' => $this->getAceModuleConfig('ace/mode/text', $ace_path . 'mode-text.js', null),
				'ini' => $this->getAceModuleConfig('ace/mode/ini', $ace_path . 'mode-ini.js', null),
				'css' => $this->getAceModuleConfig('ace/mode/css', $ace_path . 'mode-css.js', 'ace/mode/css_worker'),
				'r' => $this->getAceModuleConfig('ace/mode/r', $ace_path . 'mode-r.js', null),
				'xml' => $this->getAceModuleConfig('ace/mode/xml', $ace_path . 'mode-xml.js', 'ace/mode/xml_worker'),
				'yaml' => $this->getAceModuleConfig('ace/mode/yaml', $ace_path . 'mode-yaml.js', 'ace/mode/yaml_worker'),
			),
			'themes' => array(
				'github_light_default' => $this->getAceModuleConfig('ace/theme/github_light_default', $ace_path . 'theme-github_light_default.js', null),
				'github_dark' => $this->getAceModuleConfig('ace/theme/github_dark', $ace_path . 'theme-github_dark.js', null),
			),
			'workers' => array(
				'ace/mode/css_worker' => $this->getModuleResourceUrl($ace_path . 'worker-css.js'),
				'ace/mode/html_worker' => $this->getModuleResourceUrl($ace_path . 'worker-html.js'),
				'ace/mode/javascript_worker' => $this->getModuleResourceUrl($ace_path . 'worker-javascript.js'),
				'ace/mode/json_worker' => $this->getModuleResourceUrl($ace_path . 'worker-json.js'),
				'ace/mode/xml_worker' => $this->getModuleResourceUrl($ace_path . 'worker-xml.js'),
				'ace/mode/yaml_worker' => $this->getModuleResourceUrl($ace_path . 'worker-yaml.js'),
			),
		);
	}

	/**
	 * Builds an Ace module descriptor.
	 *
	 * @param string      $module Ace module id.
	 * @param string      $file   Module file path relative to this module.
	 * @param string|null $worker Optional Ace worker module id.
	 * @return array
	 */
	private function getAceModuleConfig($module, $file, $worker)
	{
		return array(
			'module' => $module,
			'url' => $this->getModuleResourceUrl($file),
			'worker' => $worker,
		);
	}

	/**
	 * Returns a URL for a bundled module resource.
	 *
	 * @param string $resource_path Path relative to this module.
	 * @return string
	 */
	private function getModuleResourceUrl($resource_path)
	{
		return $this->framework->getUrl($resource_path);
	}

	/**
	 * Returns globally persisted theme preferences for the current authenticated user.
	 *
	 * @param string $user_id
	 * @return array
	 */
	private function getThemePreferences($user_id)
	{
		$preferences = array();
		foreach ($this->getThemePreferenceTypes() as $type) {
			$preferences[$type] = 'light';
		}
		if (empty($user_id)) {
			return $preferences;
		}
		foreach (array_keys($preferences) as $type) {
			$theme = $this->getSystemSetting($this->getThemePreferenceKey($user_id, $type));
			if (in_array($theme, array('light', 'dark'), true)) {
				$preferences[$type] = $theme;
			}
		}
		return $preferences;
	}

	/**
	 * Saves a globally persisted theme preference for one authenticated user and enhancement type.
	 *
	 * @param array $payload AJAX payload.
	 * @param string $user_id REDCap username.
	 * @return array
	 */
	private function saveThemePreference($payload, $user_id)
	{
		if (!is_array($payload) || !isset($payload['type']) || !isset($payload['theme'])) {
			return array('ok' => false, 'error' => 'Missing payload.');
		}
		$type = isset($payload['type']) ? (string)$payload['type'] : '';
		if (!in_array($type, $this->getThemePreferenceTypes(), true)) {
			return array('ok' => false, 'error' => 'Unsupported type.');
		}
		$theme = isset($payload['theme']) ? (string)$payload['theme'] : '';
		if (!in_array($theme, array('light', 'dark'), true)) {
			return array('ok' => false, 'error' => 'Unsupported theme.');
		}
		$this->setSystemSetting($this->getThemePreferenceKey($user_id, $type), $theme);
		return array('ok' => true);
	}

	/**
	 * Builds a global setting key for a user's theme preference.
	 *
	 * @param string $user_id REDCap username.
	 * @param string $type    Enhancement type.
	 * @return string
	 */
	private function getThemePreferenceKey($user_id, $type)
	{
		return self::THEME_SETTING_PREFIX . sha1((string)$user_id) . ':' . $type;
	}

	/**
	 * Returns supported enhancement type keys for theme persistence.
	 *
	 * @return array
	 */
	private function getThemePreferenceTypes()
	{
		return array('text', 'json', 'markdown', 'css', 'ini', 'r', 'xml', 'yaml');
	}

	/**
	 * Returns file contents for the client-side file viewer.
	 *
	 * This is intentionally stubbed while the client-side viewer behavior is being built.
	 *
	 * @param mixed $payload Client payload.
	 * @param int|string $project_id
	 * @param string|null $user_id
	 * @param string|null $user_id
	 * @param string $instrument
	 * @param string|null $survey_hash
	 * @param string $record
	 * @return string
	 */
	private function getFileContent($payload, $project_id, $user_id, $instrument, $survey_hash, $record)
	{
		$docId = $payload['docId'];
		$content = false;
		$error = 'This file is not currently available for viewing.';
		do {
			// Validate hash
			$docIdHash = $payload['docIdHash'];
			$expectedHash = \Files::docIdHash($docId);
			if ($docIdHash !== $expectedHash) break;

			// Validate context
			$validContext = (!empty($user_id) && empty($survey_hash)) || ($user_id == null && !empty($survey_hash));
			if (!$validContext) break;

			// Validate field context
			$Proj = new \Project($project_id);
			$fieldName = $payload['fieldName'];
			if (!array_key_exists($fieldName, $Proj->forms[$instrument]['fields'])) break;

			// Validate survey
			if (!empty($survey_hash) && empty($Proj->forms[$instrument]['survey_id'])) break;
	
			// Validate file attributes
			$fileInfo = \Files::getEdocInfo($docId, $project_id, false);
			if ($fileInfo['doc_name'] !== $payload['filename']) break;
			$maxFileSize = $this->getMaxAllowedFileSize($project_id);
			if ($maxFileSize > 0 && (intval($fileInfo['doc_size']) > $maxFileSize)) {
				$error = "The file size exceeds maximum allowed size of {$maxFileSize} bytes.";
				break;
			}

			// Validate record DAG
			if (!empty($record) && !empty($user_id)) {
				if (!\Records::recordBelongsToUsersDAG($project_id, $record)) {
					$error = "The record associated with this file does not belong to your data access group.";
					break;
				}
			}

			// All valid, get content
			list ($_, $_, $content) = \Files::getEdocContentsAttributes($docId);

		} while (false);

		return ($content === false) ? [
			'ok' => false,
			'error' => $error,
		] : [
			'ok' => true,
			'content' => $content,
		];
	}
	
	// TODO: Add file size setting to config.json, add PHPDoc, support k/kb/m/mb
	private function getMaxAllowedFileSize($project_id) {
		$maxFileSize = intval($this->framework->getProjectSetting('max-file-size', $project_id) ?? 0);
		return $maxFileSize === 0 ? self::DEFAULT_FILE_SIZE_LIMIT : $maxFileSize;
	}


	/**
	 * Removes readonly action tags from enhanced fields to allow client-side controls to manage readonly state.
	 * @param \Project $Proj 
	 * @param array $enhanced_fields 
	 * @return void 
	 */
	private function removeREDCapReadonly($Proj, $enhanced_fields)
	{
		// Remove readonly action tags from enhanced fields
		$metadata_name = \Design::isDraftPreview($Proj->project_id) ? 'metadata_temp' : 'metadata';
		$metadata = &$Proj->$metadata_name;
		foreach ($enhanced_fields as $vf) {
			if ($vf['readonly'] && !$vf['isFile']) {
				$fieldName = $vf['name'];
				foreach (['@READONLY', '@READONLY-FORM', '@READONLY-SURVEY'] as $readonlyTag) {
					$misc = $metadata[$fieldName]['misc'] ?? '';
					$metadata[$fieldName]['misc'] = str_replace($readonlyTag, ' ', $misc);
				}
			}
		}
	}

	/**
	 * Builds enhancement definitions from the configured action tags.
	 *
	 * @param \Project    $Proj            REDCap project.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @param bool        $is_survey       Whether the current page is a survey page.
	 * @return array
	 */
	private function getEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, $is_survey)
	{
		$context = [
			'project_id' => $Proj->project_id,
			'record' => $record,
			'instrument' => $instrument,
			'event_id' => $event_id,
			'instance' => $repeat_instance ?: 1,
		];
		$tags = [
			self::AT_ENHANCED_TEXT_JSON,
			self::AT_ENHANCED_TEXT_MARKDOWN,
			self::AT_ENHANCED_TEXT_PLAIN,
			self::AT_ENHANCED_TEXT_CSS,
			self::AT_ENHANCED_TEXT_INI,
			self::AT_ENHANCED_TEXT_R,
			self::AT_ENHANCED_TEXT_XML,
			self::AT_ENHANCED_TEXT_YAML,
			'@READONLY',
			'@READONLY-FORM',
			'@READONLY-SURVEY',
		];
		$actionTags = ActionTagHelper::getActionTags($tags, null, $instrument, $context);
		$viewerFields = [];
		$metadata = $Proj->getMetadata();

		$is_readonly = function ($fieldName) use ($actionTags, $is_survey) {
			if (isset($actionTags['@READONLY'][$fieldName])) return true;
			if (isset($actionTags['@READONLY-FORM'][$fieldName]) && !$is_survey) return true;
			if (isset($actionTags['@READONLY-SURVEY'][$fieldName]) && $is_survey) return true;
			return false;
		};

		$text_enhancements = array(
			'text' => array('tag' => self::AT_ENHANCED_TEXT_PLAIN, 'allowTextField' => false),
			'markdown' => array('tag' => self::AT_ENHANCED_TEXT_MARKDOWN, 'allowTextField' => false),
			'json' => array('tag' => self::AT_ENHANCED_TEXT_JSON, 'allowTextField' => true),
			'css' => array('tag' => self::AT_ENHANCED_TEXT_CSS, 'allowTextField' => true),
			'ini' => array('tag' => self::AT_ENHANCED_TEXT_INI, 'allowTextField' => false),
			'r' => array('tag' => self::AT_ENHANCED_TEXT_R, 'allowTextField' => false),
			'xml' => array('tag' => self::AT_ENHANCED_TEXT_XML, 'allowTextField' => true),
			'yaml' => array('tag' => self::AT_ENHANCED_TEXT_YAML, 'allowTextField' => false),
		);
		foreach ($text_enhancements as $mode => $enhancement) {
			foreach ($actionTags[$enhancement['tag']] ?? [] as $fieldName => $tagInfo) {
				$params = $this->parseActionTagParams($tagInfo['params'] ?? '', $mode);
				if (!$this->shouldInjectForScope($params['scope'], $is_survey)) continue;
				$fieldMetadata = $metadata[$fieldName] ?? null;
				$allowedTypes = $enhancement['allowTextField'] ? ['text', 'textarea'] : ['textarea'];
				$allowedTypes[] = 'file';
				if (empty($fieldMetadata) || !in_array($fieldMetadata['element_type'] ?? '', $allowedTypes, true)) continue;
				// Skip any text fields that have a validation or signatures
				if ($fieldMetadata['element_type'] === 'text' && !empty($fieldMetadata['element_validation_type'])) continue;
				if ($fieldMetadata['element_type'] === 'file' && !empty($fieldMetadata['element_validation_type'])) continue;
				if (($fieldMetadata['element_type'] ?? '') === 'text') {
					$params['format'] = 'compact';
				}
				$isFile = $fieldMetadata['element_type'] === 'file';
				if (!isset($viewerFields[$fieldName])) {
					$viewerFields[$fieldName] = [
						'name' => $fieldName,
						'isFile' => $isFile,
						'viewers' => [$mode],
						'readonly' => $isFile || $is_readonly($fieldName), // Files are always read-only
						'rowConfig' => in_array($fieldMetadata['custom_alignment'] ?? '', ['LH', 'LV']) ? 'full' : 'split',
						$mode => $params,
					];
				} else {
					$viewerFields[$fieldName]['viewers'][] = $mode;
					$viewerFields[$fieldName][$mode] = $params;
				}
			}
		}

		return array_values($viewerFields);
	}

	/**
	 * Determines whether an action tag should inject controls in the current page scope.
	 *
	 * @param mixed $scope     Scope (form, survey, all).
	 * @param bool  $is_survey Whether the current page is a survey page.
	 * @return bool
	 */
	private function shouldInjectForScope($scope, $is_survey)
	{
		if ($scope === 'all') {
			return true;
		}
		if ($scope === 'survey') {
			return $is_survey;
		}
		return !$is_survey;
	}


	/**
	 * Gets the mode labels.
	 *
	 * @return array 
	 */
	private function getModeLabels() {
		return array(
			'raw' => 'Raw',
			'text' => 'Text',
			'markdown' => 'Markdown',
			'html' => 'HTML',
			'json' => 'JSON',
			'css' => 'CSS',
			'ini' => 'INI',
			'r' => 'R',
			'xml' => 'XML',
			'yaml' => 'YAML',
		);
	}

	/**
	 * Parses generic text enhancement parameters.
	 *
	 * @param mixed  $params Raw action-tag parameter value.
	 * @param string $mode   Enhancement mode key.
	 * @return array
	 */
	private function parseActionTagParams($params, $mode)
	{
		$config = array(
			'initialMode' => 'raw',
			'editorOnly' => false,
			'height' => null,
			'format' => 'pretty',
			'indent' => 2,
			'mode' => $mode,
			'normalizes' => in_array($mode, ['css', 'json', 'xml'], true),
			'scope' => 'form',
		);

		$value = trim((string)$params);
		if ($value === '') {
			return $config;
		}

		$decoded = json_decode($value, true);
		if (is_string($decoded)) {
			$value = $decoded;
		} else {
			$value = trim($value, "\"'");
		}

		$tokens = array_map('trim', explode(',', strtolower($value)));
		foreach ($tokens as $token) {
			if ($token === '') {
				continue;
			}
			// Editor Only
			if ($token === $mode . '-only' || $token === 'editor-only') {
				$config['editorOnly'] = true;
				$config['initialMode'] = $mode;
				continue;
			}
			// Initial
			if (strpos($token, 'initial:') === 0) {
				$initial_mode = trim(substr($token, strlen('initial:')));
				if ($initial_mode === $mode || $initial_mode === 'editor') {
					$config['initialMode'] = $mode;
				}
				if ($initial_mode === 'raw') {
					$config['initialMode'] = 'raw';
				}
				if ($initial_mode === 'html' && $mode === 'markdown') {
					$config['initialMode'] = 'html';
				}
				continue;
			}
			// Height
			if (strpos($token, 'height:') === 0) {
				$height = trim(substr($token, strlen('height:')));
				if (ctype_digit($height) && (int)$height > 0) {
					$config['height'] = (int)$height;
				}
				continue;
			}
			// Scope
			if (strpos($token, 'scope:') === 0) {
				$scope = trim(substr($token, strlen('scope:')));
				if (in_array($scope, ['form', 'survey', 'all'], true)) {
					$config['scope'] = $scope;
				}
				continue;
			}
			// CSS-, JSON-, XML-specific 
			if (in_array($mode, ['css', 'json', 'xml'], true)) {
				// Format
				if (strpos($token, 'format:') === 0) {
					$format = trim(substr($token, strlen('format:')));
					if (in_array($format, ['pretty', 'compact'], true)) {
						$config['format'] = $format;
					}
					continue;
				}
				// Indent
				if (strpos($token, 'indent:') === 0) {
					$indent = trim(substr($token, strlen('indent:')));
					if ($indent === 'tab') {
						$config['indent'] = 'tab';
					}
					if (ctype_digit($indent) && (int)$indent > 0 && (int)$indent <= 8) {
						$config['indent'] = (int)$indent;
					}
					continue;
				}
			}
		}

		if ($config['editorOnly']) {
			$config['initialMode'] = $mode;
		}
		return $config;
	}

	/**
	 * Checks whether any field has a specific enhancement type.
	 *
	 * @param array  $enhanced_fields Enhancement field definitions.
	 * @param string $enhancement_type Enhancement type to search for.
	 * @return bool
	 */
	private function hasEnhancementType($enhanced_fields, $enhancement_type)
	{
		foreach ($enhanced_fields as $field) {
			if (in_array($enhancement_type, $field['viewers'], true)) {
				return true;
			}
		}
		return false;
	}
}

spl_autoload_register(
	function ($class) {
		$namespace = __NAMESPACE__ . '\\';
		$namespace_position = strpos($class, $namespace);
		if ($namespace_position !== 0) {
			return;
		}
		$relative_class = substr($class, strlen($namespace));
		$class_file = __DIR__ . '/classes/' . str_replace('\\', '/', $relative_class) . '.php';
		if (is_readable($class_file)) {
			require_once $class_file;
		}
	}
);
