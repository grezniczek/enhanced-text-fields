<?php

namespace DE\RUB\SEG\TextViewersExternalModule;

class TextViewersExternalModule extends \ExternalModules\AbstractExternalModule
{
	private $js_debug = false;

	const AT_JSON_VIEWER = "@JSON-VIEWER";
	const AT_MARKDOWN_VIEWER = "@MARKDOWN-VIEWER";

	#region Hooks

	function redcap_data_entry_form($project_id, $record, $instrument, $event_id, $group_id, $repeat_instance)
	{
	}

	function redcap_survey_page($project_id, $record, $instrument, $event_id, $group_id, $survey_hash, $response_id, $repeat_instance)
	{
	}

	#endregion

}
