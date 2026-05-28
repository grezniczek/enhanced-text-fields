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

	/**
	 * REDCap action tag that enables JSON text enhancements.
	 *
	 * @var string
	 */
	const AT_ENHANCED_TEXT_JSON = "@ENHANCED-TEXT-JSON";

	/**
	 * REDCap action tag that enables Markdown text enhancements.
	 *
	 * @var string
	 */
	const AT_ENHANCED_TEXT_MARKDOWN = "@ENHANCED-TEXT-MARKDOWN";

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
		$Proj = $GLOBALS['Proj'];
		$this->injectEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, false);
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
		$this->injectEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, true);
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
	 * @param bool        $is_survey       Whether the current page is a survey page.
	 * @return void
	 */
	private function injectEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, $is_survey)
	{
		$enhanced_fields = $this->getEnhancedFields($Proj, $record, $instrument, $event_id, $repeat_instance, $is_survey);
		if (empty($enhanced_fields)) {
			return;
		}
		$this->removeREDCapReadonly($Proj, $enhanced_fields);

		$this->js_debug = $this->getProjectSetting('javascript-debug') == '1';

		$inject = InjectionHelper::init($this);
		$has_markdown = $this->hasEnhancementType($enhanced_fields, 'markdown');
		// Build client config
		$config = array(
			'debug' => $this->js_debug,
			'isSurvey' => $is_survey,
			'fields' => $enhanced_fields,
			'ace' => $this->getAceConfig(),
		);
		$config_json = json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

		$inject->css('css/enhanced-text-fields.css');
		if ($has_markdown) {
			$inject->css('css/github-markdown-light.css');
			$inject->css('css/highlight-theme.css');
			$inject->js('js/marked.min.js');
			$inject->js('js/highlight.min.js');
			$inject->js('js/sir-hljs-languages.js');
		}
		$inject->js('js/ConsoleDebugLogger.js');
		$inject->js('js/enhanced-text-fields.js');
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
		/** @var string $ace_path Bundled Ace distribution path. */
		$ace_path = 'js/ace/src-noconflict/';
		return array(
			'script' => $this->getModuleResourceUrl($ace_path . 'ace.js'),
			'theme' => 'github_light_default',
			'useWorker' => false,
			'modes' => array(
				'json' => $this->getAceModuleConfig('ace/mode/json', $ace_path . 'mode-json.js', 'ace/mode/json_worker'),
				'markdown' => $this->getAceModuleConfig('ace/mode/markdown', $ace_path . 'mode-markdown.js', null),
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
	 * Removes readonly action tags from enhanced fields to allow client-side controls to manage readonly state.
	 * @param \Project $Proj 
	 * @param array $enhanced_fields 
	 * @return void 
	 */
	private function removeREDCapReadonly($Proj, $enhanced_fields) {
		// Remove readonly action tags from enhanced fields
		$metadata_name = \Design::isDraftPreview($Proj->project_id) ? 'metadata_temp' : 'metadata';
		$metadata = &$Proj->$metadata_name;
		foreach ($enhanced_fields as $vf) {
			if ($vf['readonly']) {
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
			'@READONLY',
			'@READONLY-FORM',
			'@READONLY-SURVEY',
		];
		$actionTags = ActionTagHelper::getActionTags($tags, null, $instrument, $context);
		$viewerFields = [];
		$metadata = $Proj->getMetadata();

		$is_readonly = function($fieldName) use ($actionTags, $is_survey) {
			if (isset($actionTags['@READONLY'][$fieldName])) return true;
			if (isset($actionTags['@READONLY-FORM'][$fieldName]) && !$is_survey) return true;
			if (isset($actionTags['@READONLY-SURVEY'][$fieldName]) && $is_survey) return true;
			return false;
		};

		foreach ($actionTags[self::AT_ENHANCED_TEXT_MARKDOWN] ?? [] as $fieldName => $tagInfo) {
			$fieldMetadata = $metadata[$fieldName] ?? null;
			if (empty($fieldMetadata) || ($fieldMetadata['element_type'] ?? '') !== 'textarea') continue;
			$viewerFields[$fieldName] = [
				'name' => $fieldName,
				'viewers' => ['markdown'],
				'readonly' => $is_readonly($fieldName),
				'rowConfig' => in_array($fieldMetadata['custom_alignment'] ?? '', ['LH', 'LV']) ? 'full' : 'split',
				'markdown' => $this->parseMarkdownViewerParams($tagInfo['params'] ?? ''),
			];
		}
		foreach ($actionTags[self::AT_ENHANCED_TEXT_JSON] ?? [] as $fieldName => $tagInfo) {
			$fieldMetadata = $metadata[$fieldName] ?? null;
			if (empty($fieldMetadata) || !in_array($fieldMetadata['element_type'] ?? '', ['text', 'textarea'], true)) continue;
			$jsonParams = $this->parseJsonViewerParams($tagInfo['params'] ?? '');
			if (($fieldMetadata['element_type'] ?? '') === 'text') {
				$jsonParams['format'] = 'compact';
			}
			if (!isset($viewerFields[$fieldName])) {
				$viewerFields[$fieldName] = [
					'name' => $fieldName,
					'viewers' => ['json'],
					'readonly' => $is_readonly($fieldName),
					'rowConfig' => in_array($fieldMetadata['custom_alignment'] ?? '', ['LH', 'LV']) ? 'full' : 'split',
					'json' => $jsonParams,
				];
			} else {
				$viewerFields[$fieldName]['viewers'][] = 'json';
				$viewerFields[$fieldName]['json'] = $jsonParams;
			}
		}

		return array_values($viewerFields);
	}

	/**
	 * Parses @ENHANCED-TEXT-MARKDOWN parameters.
	 *
	 * @param mixed $params Raw action-tag parameter value.
	 * @return array
	 */
	private function parseMarkdownViewerParams($params)
	{
		$config = array(
			'initialMode' => 'raw',
			'mdOnly' => false,
			'height' => null,
		);
		$value = trim((string)$params);
		if ($value === '') {
			return $config;
		}

		$decoded = json_decode($value, true);
		if (is_string($decoded)) {
			$value = $decoded;
		}
		else {
			$value = trim($value, "\"'");
		}

		$tokens = array_map('trim', explode(',', strtolower($value)));
		foreach ($tokens as $token) {
			if ($token === '') {
				continue;
			}
			if ($token === 'md-only') {
				$config['mdOnly'] = true;
				$config['initialMode'] = 'markdown';
				continue;
			}
			if (strpos($token, 'initial:') === 0) {
				$mode = trim(substr($token, strlen('initial:')));
				if ($mode === 'md') {
					$config['initialMode'] = 'markdown';
				}
				if ($mode === 'html') {
					$config['initialMode'] = 'html';
				}
				if ($mode === 'raw') {
					$config['initialMode'] = 'raw';
				}
			}
			if (strpos($token, 'height:') === 0) {
				$height = trim(substr($token, strlen('height:')));
				if (ctype_digit($height) && (int)$height > 0) {
					$config['height'] = (int)$height;
				}
			}
		}

		if ($config['mdOnly']) {
			$config['initialMode'] = 'markdown';
		}
		return $config;
	}

	/**
	 * Parses @ENHANCED-TEXT-JSON parameters.
	 *
	 * @param mixed $params Raw action-tag parameter value.
	 * @return array
	 */
	private function parseJsonViewerParams($params)
	{
		$config = array(
			'initialMode' => 'raw',
			'jsonOnly' => false,
			'height' => null,
			'format' => 'pretty',
		);
		$value = trim((string)$params);
		if ($value === '') {
			return $config;
		}

		$decoded = json_decode($value, true);
		if (is_string($decoded)) {
			$value = $decoded;
		}
		else {
			$value = trim($value, "\"'");
		}

		$tokens = array_map('trim', explode(',', strtolower($value)));
		foreach ($tokens as $token) {
			if ($token === '') {
				continue;
			}
			if ($token === 'json-only') {
				$config['jsonOnly'] = true;
				$config['initialMode'] = 'json';
				continue;
			}
			if (strpos($token, 'initial:') === 0) {
				$mode = trim(substr($token, strlen('initial:')));
				if ($mode === 'json') {
					$config['initialMode'] = 'json';
				}
				if ($mode === 'raw') {
					$config['initialMode'] = 'raw';
				}
			}
			if (strpos($token, 'height:') === 0) {
				$height = trim(substr($token, strlen('height:')));
				if (ctype_digit($height) && (int)$height > 0) {
					$config['height'] = (int)$height;
				}
			}
			if (strpos($token, 'format:') === 0) {
				$format = trim(substr($token, strlen('format:')));
				if (in_array($format, ['pretty', 'compact'], true)) {
					$config['format'] = $format;
				}
			}
		}

		if ($config['jsonOnly']) {
			$config['initialMode'] = 'json';
		}
		return $config;
	}

	/**
	 * Returns data dictionary rows keyed by field name.
	 *
	 * @param string $instrument Current instrument name.
	 * @param array  $context    Context for evaluating @IF action tags.
	 * @return array
	 */
	private function getMetadataByField($instrument, $context)
	{
		$metadata_json = \REDCap::getDataDictionary('json', false, null, $instrument);
		$metadata_rows = json_decode($metadata_json, true);
		$metadata_by_field = array();
		if (!is_array($metadata_rows)) {
			return $metadata_by_field;
		}

		foreach ($metadata_rows as $metadata) {
			$field_name = $metadata['field_name'] ?? '';
			if ($field_name === '') {
				continue;
			}
			$field_annotation = $metadata['field_annotation'] ?? '';
			if (is_array($context) && strpos($field_annotation, "@IF") !== false) {
				$field_annotation = \Form::replaceIfActionTag($field_annotation, $context['project_id'] ?? null, $context['record'] ?? null, $context['event_id'] ?? null, $context['instrument'] ?? null, $context['instance'] ?? 1);
				$metadata['field_annotation'] = $field_annotation;
			}
			$metadata_by_field[$field_name] = $metadata;
		}

		return $metadata_by_field;
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
	/**
	 * Loads classes that belong to this module namespace from the classes folder.
	 *
	 * @param string $class Fully qualified class name requested by PHP.
	 * @return void
	 */
	function ($class) {
		/** @var string $namespace Module namespace prefix. */
		$namespace = __NAMESPACE__ . '\\';
		/** @var int|false $namespace_position Prefix position in the requested class. */
		$namespace_position = strpos($class, $namespace);
		if ($namespace_position !== 0) {
			return;
		}

		/** @var string $relative_class Class name relative to this module namespace. */
		$relative_class = substr($class, strlen($namespace));
		/** @var string $class_file Absolute class file path. */
		$class_file = __DIR__ . '/classes/' . str_replace('\\', '/', $relative_class) . '.php';
		if (is_readable($class_file)) {
			require_once $class_file;
		}
	}
);