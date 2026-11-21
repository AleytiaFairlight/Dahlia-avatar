class_name DahliaExportPlugin
extends EditorExportPlugin

## The Kirie web UI built by `kirie build`. Godot's export packs imported
## assets (textures, models, translations) on its own, but files with no
## importer (index.html, beat-sync.html, .js, .css, .wasm) never reach the
## .pck — the exported app then fails with "File not found:
## res://src-web/dist/index.html". This plugin adds exactly those files,
## mirroring what Kirie's own export plugin does for its mobile web bundles.
const WEB_ROOT := "res://src-web/dist"


func _supports_platform(platform: EditorExportPlatform) -> bool:
	var os_name := platform.get_os_name().to_lower()
	return os_name == "windows" or os_name == "linux" or os_name == "macos"


func _get_name() -> String:
	return "DahliaExport"


func _export_begin(_features: PackedStringArray, _is_debug: bool, _path: String, _flags: int) -> void:
	if not DirAccess.dir_exists_absolute(WEB_ROOT):
		push_error("Dahlia export needs the Kirie web bundle: run `kirie build` first so res://src-web/dist exists.")
		return
	var added := _add_dir_recursive(WEB_ROOT)
	print("[Dahlia][export] shipped " + str(added) + " web bundle files from " + WEB_ROOT)


func _add_dir_recursive(directory: String) -> int:
	var added := 0
	for entry in DirAccess.get_files_at(directory):
		var path := directory.path_join(entry)
		# Imported assets (textures, fonts, models) already ship through the
		# normal export; only the importer-less files need explicit adding.
		# `.import` sidecars themselves must never ship as web files.
		if entry.ends_with(".import"):
			continue
		if FileAccess.file_exists(path + ".import"):
			continue
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.is_empty() and FileAccess.get_open_error() != OK:
			push_error("Dahlia export cannot read " + path)
			continue
		add_file(path, bytes, false)
		added += 1
	for entry in DirAccess.get_directories_at(directory):
		added += _add_dir_recursive(directory.path_join(entry))
	return added
