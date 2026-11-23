; Dahlia Kirie Windows installer (Inno Setup 6).
;
; Built by the Dahlia Release workflow after the Godot export: the export
; folder (dist\Dahlia-Kirie-windows-x64) becomes a per-user install, so the
; host can write its logs next to the exe without elevation. From 0.9 the
; setup exe is the only Kirie release file: the portable zip is gone, and
; the updater feed (kirie-latest-x64.json) points at this installer.
;
; CI passes both defines, e.g.:
;   iscc /DAppVersion="0.7.0-alpha.1" /DAppVersionInfo="0.7.0.1" /DOutDir="<repo>\dahlia-release" installer.iss
; Without them the script still compiles (dev defaults) but must not ship.
;
; AppId must never change: it ties upgrades and uninstall to this app.

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef AppVersionInfo
  #define AppVersionInfo "0.0.0.1"
#endif
#ifndef OutDir
  #define OutDir "dist-installer"
#endif

#define AppName "Dahlia Kirie"

[Setup]
AppId={{F260BA30-8A12-4839-921E-75785E5AB217}
AppName={#AppName}
AppVerName={#AppName} {#AppVersion}
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersionInfo}
AppPublisher=Aleytia Fairlight
AppPublisherURL=https://github.com/AleytiaFairlight/Dahlia-avatar
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; The host holds this mutex while it runs (see dahlia-app-mutex.cs); a silent
; update install (/CLOSEAPPLICATIONS) waits on it instead of racing the
; exiting host. This name must never change.
AppMutex=DahliaKirieApp
MinVersion=10.0
OutputDir={#OutDir}
OutputBaseFilename=Dahlia-Kirie-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; The app may be running when the user upgrades; ask to close it first.
CloseApplications=yes
; Only one Kirie install per user: a newer setup upgrades it in place.
UsePreviousAppDir=yes
DirExistsWarning=yes
UninstallDisplayIcon={app}\dahlia.exe

[Files]
; Everything the export produced (exe, .pck, CEF, VC++ DLLs, host scripts).
; The smoke run's leftovers are not a fresh install: skip its logs.
Source: "dist\Dahlia-Kirie-windows-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "logs\*,smoke-*.txt"

[Icons]
Name: "{group}\Dahlia"; Filename: "{app}\dahlia.exe"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Dahlia"; Filename: "{app}\dahlia.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\dahlia.exe"; Description: "Launch Dahlia"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Per-user logs live next to the exe; remove them with the app. CEF and
; updater state under AppData stay (shared caches, harmless).
Type: filesandordirs; Name: "{app}\logs"
