<?php

namespace DE\RUB\SEG\TextViewersExternalModule;

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

/**
 * External Module entry point for text-based field viewers.
 */
class TextViewersExternalModule extends \ExternalModules\AbstractExternalModule
{
	/**
	 * Whether browser-side debug logging should be enabled.
	 *
	 * @var bool
	 */
	private $js_debug = false;

	/**
	 * REDCap action tag that enables the JSON viewer.
	 *
	 * @var string
	 */
	const AT_JSON_VIEWER = "@JSON-VIEWER";

	/**
	 * REDCap action tag that enables the Markdown viewer.
	 *
	 * @var string
	 */
	const AT_MARKDOWN_VIEWER = "@MARKDOWN-VIEWER";

	#region Hooks

	/**
	 * Inject text viewers on regular data entry forms.
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
		$this->injectViewers($Proj, $record, $instrument, $event_id, $repeat_instance, false);
	}

	/**
	 * Inject text viewers on survey pages.
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
		$this->injectViewers($Proj, $record, $instrument, $event_id, $repeat_instance, true);
	}

	#endregion

	/**
	 * Finds tagged fields and injects all required CSS/JS for the current page.
	 *
	 * @param \Project    $Proj            REDCap project.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @param bool        $is_survey       Whether the current page is a survey page.
	 * @return void
	 */
	private function injectViewers($Proj, $record, $instrument, $event_id, $repeat_instance, $is_survey)
	{
		$viewer_fields = $this->getViewerFields($Proj, $record, $instrument, $event_id, $repeat_instance, $is_survey);
		if (empty($viewer_fields)) {
			return;
		}
		$this->removeREDCapReadonly($Proj, $viewer_fields);

		$this->js_debug = $this->getProjectSetting('javascript-debug') == '1';

		$inject = InjectionHelper::init($this);
		$has_markdown = $this->hasViewerType($viewer_fields, 'markdown');
		// Build client config
		$config = array(
			'debug' => $this->js_debug,
			'isSurvey' => $is_survey,
			'fields' => $viewer_fields,
			'urls' => array(
				'ace' => $this->getRedcapResourceUrl('Resources/js/Libraries/ace.js'),
			),
		);
		$config_json = json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

		$inject->css('css/rc-viewers.css');
		if ($has_markdown) {
			$inject->css('css/github-markdown-light.css');
			$inject->css('css/highlight-theme.css');
			$inject->js('js/marked.min.js');
			$inject->js('js/highlight.min.js');
			$inject->js('js/sir-hljs-languages.js');
		}
		$inject->js('js/ConsoleDebugLogger.js');
		$inject->js('js/rc-viewers.js');
		?>
		<script type="text/javascript">
			DE_RUB_SEG_TextViewersEM.init(<?= $config_json ?>);
		</script>
		<?php
	}


	/**
	 * Removes readonly action tags from viewer fields to allow client-side viewers to control readonly state.
	 * @param \Project $Proj 
	 * @param array $viewer_fields 
	 * @return void 
	 */
	private function removeREDCapReadonly($Proj, $viewer_fields) {
		// Remove readonly action tags from viewer fields
		$metadata_name = \Design::isDraftPreview($Proj->project_id) ? 'metadata_temp' : 'metadata';
		$metadata = &$Proj->$metadata_name;
		foreach ($viewer_fields as $vf) {
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
	 * Builds viewer definitions from the configured action tags.
	 *
	 * @param \Project    $Proj            REDCap project.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @param bool        $is_survey       Whether the current page is a survey page.
	 * @return array
	 */
	private function getViewerFields($Proj, $record, $instrument, $event_id, $repeat_instance, $is_survey)
	{
		$context = [
			'project_id' => $Proj->project_id,
			'record' => $record,
			'instrument' => $instrument,
			'event_id' => $event_id,
			'instance' => $repeat_instance ?: 1,
		];
		$tags = [
			self::AT_JSON_VIEWER, 
			self::AT_MARKDOWN_VIEWER,
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

		foreach ($actionTags[self::AT_MARKDOWN_VIEWER] ?? [] as $fieldName => $tagInfo) {
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
		foreach ($actionTags[self::AT_JSON_VIEWER] ?? [] as $fieldName => $tagInfo) {
			$fieldMetadata = $metadata[$fieldName] ?? null;
			if (empty($fieldMetadata)) continue;
			if (!isset($viewerFields[$fieldName])) {
				$viewerFields[$fieldName] = [
					'name' => $fieldName,
					'viewers' => ['json'],
					'readonly' => $is_readonly($fieldName),
					'rowConfig' => in_array($fieldMetadata['custom_alignment'] ?? '', ['LH', 'LV']) ? 'full' : 'split',
				];
			} else {
				$viewerFields[$fieldName]['viewers'][] = 'json';
			}
		}

		return array_values($viewerFields);
	}

	/**
	 * Parses @MARKDOWN-VIEWER parameters.
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
	 * Checks whether any field has a specific viewer type.
	 *
	 * @param array  $viewer_fields Viewer field definitions.
	 * @param string $viewer_type   Viewer type to search for.
	 * @return bool
	 */
	private function hasViewerType($viewer_fields, $viewer_type)
	{
		foreach ($viewer_fields as $field) {
			if (in_array($viewer_type, $field['viewers'], true)) {
				return true;
			}
		}
		return false;
	}


	/**
	 * Returns a URL for a REDCap core resource.
	 *
	 * @param string $resource_path Path relative to REDCap's web root.
	 * @return string
	 */
	private function getRedcapResourceUrl($resource_path)
	{
		$webroot = defined('APP_PATH_WEBROOT') ? APP_PATH_WEBROOT : '';
		return $webroot . $resource_path;
	}
}
