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
	function redcap_data_entry_form($project_id, $record, $instrument, $event_id, $group_id, $repeat_instance)
	{
		$this->injectViewers($project_id, $record, $instrument, $event_id, $repeat_instance);
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
	function redcap_survey_page($project_id, $record, $instrument, $event_id, $group_id, $survey_hash, $response_id, $repeat_instance)
	{
		$this->injectViewers($project_id, $record, $instrument, $event_id, $repeat_instance);
	}

	#endregion

	/**
	 * Finds tagged fields and injects all required CSS/JS for the current page.
	 *
	 * @param int         $project_id      REDCap project id.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @return void
	 */
	private function injectViewers($project_id, $record, $instrument, $event_id, $repeat_instance)
	{
		$viewer_fields = $this->getViewerFields($project_id, $record, $instrument, $event_id, $repeat_instance);
		if (empty($viewer_fields)) {
			return;
		}

		$this->js_debug = $this->getProjectSetting('javascript-debug') == '1';

		$inject = InjectionHelper::init($this);
		$has_markdown = $this->hasViewerType($viewer_fields, 'markdown');
		$config = $this->getClientConfig($viewer_fields);
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
			REDCapTextViewers.init(<?= $config_json ?>);
		</script>
		<?php
	}

	/**
	 * Builds viewer definitions from the configured action tags.
	 *
	 * @param int         $project_id      REDCap project id.
	 * @param string|null $record          Current record id.
	 * @param string      $instrument      Current instrument name.
	 * @param int|null    $event_id        Current event id.
	 * @param int|null    $repeat_instance Current repeat instance.
	 * @return array
	 */
	private function getViewerFields($project_id, $record, $instrument, $event_id, $repeat_instance)
	{
		$context = array(
			'project_id' => $project_id,
			'record' => $record,
			'instrument' => $instrument,
			'event_id' => $event_id,
			'instance' => $repeat_instance ?: 1,
		);
		$tags = array(self::AT_JSON_VIEWER, self::AT_MARKDOWN_VIEWER);
		$action_tags = ActionTagHelper::getActionTags($tags, null, $instrument, $context);
		$viewer_fields = array();

		foreach ($action_tags as $action_tag => $fields) {
			foreach (array_keys($fields) as $field_name) {
				if (!isset($viewer_fields[$field_name])) {
					$viewer_fields[$field_name] = array(
						'name' => $field_name,
						'viewers' => array(),
					);
				}
				if ($action_tag === self::AT_JSON_VIEWER) {
					$viewer_fields[$field_name]['viewers'][] = 'json';
				}
				if ($action_tag === self::AT_MARKDOWN_VIEWER) {
					$viewer_fields[$field_name]['viewers'][] = 'markdown';
				}
			}
		}

		return array_values($viewer_fields);
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
	 * Builds the JSON-serializable client configuration.
	 *
	 * @param array $viewer_fields Viewer field definitions.
	 * @return array
	 */
	private function getClientConfig($viewer_fields)
	{
		$config = array(
			'debug' => $this->js_debug,
			'fields' => $viewer_fields,
			'urls' => array(
				'ace' => $this->getRedcapResourceUrl('Resources/js/Libraries/ace.js'),
			),
		);
		return $config;
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
