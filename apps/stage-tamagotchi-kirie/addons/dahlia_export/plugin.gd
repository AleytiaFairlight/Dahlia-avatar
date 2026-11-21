@tool
extends EditorPlugin

var _export_plugin: DahliaExportPlugin


func _enter_tree() -> void:
	_export_plugin = DahliaExportPlugin.new()
	add_export_plugin(_export_plugin)


func _exit_tree() -> void:
	remove_export_plugin(_export_plugin)
	_export_plugin = null
