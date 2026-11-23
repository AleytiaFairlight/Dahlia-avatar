class_name DahliaExportPlugin
extends EditorExportPlugin

## The Kirie web UI built by `kirie build`. Godot's export packs imported
## assets (textures, models, translations) as Godot resources, which the CEF
## webview cannot decode, and files with no importer never reach the .pck —
## either way the exported app fails ("File not found:
## res://src-web/dist/index.html", broken sticker images and fonts). This
## plugin adds every file under the web root as raw bytes (remap=false),
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
		# `.import` sidecars themselves must never ship as web files. Everything
		# else ships as raw bytes (remap=false below): files WITH an importer
		# (png, woff2, svg, ...) would otherwise export as imported Godot
		# resources (textures, fonts), which the webview cannot decode — that
		# broke sticker images and bundled fonts.
		if entry.ends_with(".import"):
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
