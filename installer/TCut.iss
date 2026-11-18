#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef NodeBinary
  #error NodeBinary must point to node.exe
#endif
#ifndef CorelYear
  #error CorelYear must identify the target CorelDRAW release
#endif
#ifndef CorelInternalVersion
  #error CorelInternalVersion must identify the target CorelDRAW API
#endif

[Setup]
AppId={{D49D9185-5A2F-4EC0-9469-AE683E6D9D35}-{#CorelInternalVersion}
AppName=T-Cut para CorelDRAW {#CorelYear}
AppVersion={#AppVersion}
AppPublisher=T-Cut
DefaultDirName={autopf}\T-Cut
DefaultGroupName=T-Cut
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=T-Cut-CorelDRAW-{#CorelYear}-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
UninstallDisplayName=T-Cut para CorelDRAW {#CorelYear}

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\app.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\corel-bridge.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\irregular.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\letterbox.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\letterbox-geometry.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\style.css"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\pvc 15mm 2.svg"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#NodeBinary}"; DestDir: "{app}\runtime"; DestName: "node.exe"; Flags: ignoreversion
Source: "third-party\Node-LICENSE.txt"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "..\corel\docker\AppUI.xslt"; DestDir: "{code:GetAddonDir}\TCutDocker"; Flags: ignoreversion
Source: "..\corel\docker\UserUI.xslt"; DestDir: "{code:GetAddonDir}\TCutDocker"; Flags: ignoreversion
Source: "..\corel\docker\Coreldrw.addon"; DestDir: "{code:GetAddonDir}\TCutDocker"; Flags: ignoreversion
Source: "..\corel\webview2\Microsoft.Web.WebView2.Core.dll"; DestDir: "{code:GetAddonDir}\TCutDocker"; Flags: ignoreversion
Source: "..\corel\webview2\Microsoft.Web.WebView2.Wpf.dll"; DestDir: "{code:GetAddonDir}\TCutDocker"; Flags: ignoreversion
Source: "..\corel\webview2\WebView2Loader.dll"; DestDir: "{code:GetAddonDir}\TCutDocker"; Flags: ignoreversion
Source: "..\corel\webview2\WEBVIEW2-LICENSE.txt"; DestDir: "{code:GetAddonDir}\TCutDocker"; Flags: ignoreversion
Source: "..\corel\webview2\TCutPanel.cs"; DestDir: "{app}\panel-build"; Flags: ignoreversion
Source: "..\corel\webview2\build.ps1"; DestDir: "{app}\panel-build"; Flags: ignoreversion
Source: "..\corel\webview2\compile-installed-panel.ps1"; DestDir: "{app}\panel-build"; Flags: ignoreversion
Source: "..\corel\webview2\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}\panel-build"; Flags: ignoreversion
Source: "..\corel\webview2\Microsoft.Web.WebView2.Wpf.dll"; DestDir: "{app}\panel-build"; Flags: ignoreversion
Source: "third-party\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[InstallDelete]
Type: files; Name: "{code:GetAddonDir}\TCutDocker\project-path.txt"

[UninstallDelete]
Type: files; Name: "{code:GetPanelDllPath}"
Type: dirifempty; Name: "{code:GetAddonDir}\TCutDocker"

[Registry]
Root: HKLM; Subkey: "SOFTWARE\T-Cut\{#CorelInternalVersion}"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKLM; Subkey: "SOFTWARE\T-Cut\{#CorelInternalVersion}"; ValueType: string; ValueName: "CorelAddonsPath"; ValueData: "{code:GetAddonDir}"; Flags: uninsdeletevalue uninsdeletekeyifempty

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Instalando Microsoft WebView2..."; Check: not WebView2Installed
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\panel-build\compile-installed-panel.ps1"" -CorelInteropPath ""{code:GetCorelInteropPath}"" -OutputPath ""{code:GetPanelDllPath}"""; StatusMsg: "Preparando o painel para CorelDRAW {#CorelYear}..."; Flags: runhidden waituntilterminated

[Code]
var
  CorelPage: TInputDirWizardPage;

function FindCorelAddons: String;
var
  Candidate: String;
begin
  Result := '';
  Candidate := ExpandConstant('{autopf}\Corel\CorelDRAW Graphics Suite\{#CorelInternalVersion}\Programs64\Addons');
  if DirExists(Candidate) then Result := Candidate;
end;

function GetAddonDir(Param: String): String;
begin
  Result := RemoveBackslashUnlessRoot(CorelPage.Values[0]);
end;

function GetCorelInteropPath(Param: String): String;
begin
  Result := AddBackslash(ExtractFileDir(GetAddonDir(''))) + 'Assemblies\Corel.Interop.VGCore.dll';
end;

function GetPanelDllPath(Param: String): String;
begin
  Result := AddBackslash(GetAddonDir('')) + 'TCutDocker\TCutPanel.dll';
end;

function ValidCorelAddons(const Addons: String; var ErrorText: String): Boolean;
var
  ProgramsDir: String;
  ExePath: String;
  FileVersion: String;
begin
  Result := False;
  if not DirExists(Addons) then
  begin
    ErrorText := 'A pasta Addons selecionada não existe.';
    Exit;
  end;
  if LowerCase(ExtractFileName(RemoveBackslashUnlessRoot(Addons))) <> 'addons' then
  begin
    ErrorText := 'Selecione a pasta Addons, dentro de Programs64.';
    Exit;
  end;
  ProgramsDir := ExtractFileDir(Addons);
  ExePath := AddBackslash(ProgramsDir) + 'CorelDRW.exe';
  if not FileExists(ExePath) or
     not FileExists(AddBackslash(ProgramsDir) + 'Assemblies\Corel.Interop.VGCore.dll') then
  begin
    ErrorText := 'Selecione a pasta Programs64\Addons de uma instalação do CorelDRAW.';
    Exit;
  end;
  if not GetVersionNumbersString(ExePath, FileVersion) or
     (Pos('{#CorelInternalVersion}.', FileVersion) <> 1) then
  begin
    ErrorText := 'Este instalador exige o CorelDRAW {#CorelYear} de 64 bits.';
    Exit;
  end;
  Result := True;
end;

function WebView2Installed: Boolean;
var
  Version: String;
  MachineKey: String;
  UserKey: String;
begin
  MachineKey := 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  UserKey := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKLM32, MachineKey, 'pv', Version) and
             (Version <> '') and (Version <> '0.0.0.0')) or
            (RegQueryStringValue(HKCU, UserKey, 'pv', Version) and
             (Version <> '') and (Version <> '0.0.0.0'));
end;

function CorelRunning: Boolean;
var
  Locator: Variant;
  Service: Variant;
  Processes: Variant;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Processes := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''CorelDRW.exe''');
    Result := Processes.Count > 0;
  except
    Result := False;
  end;
end;

procedure InitializeWizard;
var
  Suggested: String;
begin
  CorelPage := CreateInputDirPage(wpSelectDir, 'CorelDRAW',
    'Selecione a instalação do CorelDRAW {#CorelYear} que receberá o painel T-Cut.',
    'Escolha a pasta Programs64\Addons do CorelDRAW {#CorelYear}, versão de 64 bits.',
    False, '');
  CorelPage.Add('Pasta Addons do CorelDRAW:');
  if not RegQueryStringValue(HKLM, 'SOFTWARE\T-Cut\{#CorelInternalVersion}', 'CorelAddonsPath', Suggested) or
     not DirExists(Suggested) then
    Suggested := FindCorelAddons;
  if Suggested = '' then
    Suggested := ExpandConstant('{autopf}\Corel\CorelDRAW Graphics Suite\{#CorelInternalVersion}\Programs64\Addons');
  CorelPage.Values[0] := Suggested;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ErrorText: String;
begin
  Result := True;
  if CurPageID = CorelPage.ID then
  begin
    Result := ValidCorelAddons(GetAddonDir(''), ErrorText);
    if not Result then MsgBox(ErrorText, mbError, MB_OK);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if CorelRunning then
    Result := 'Feche o CorelDRAW antes de instalar ou atualizar o painel T-Cut.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssDone) and not WebView2Installed then
    MsgBox('O T-Cut foi instalado, mas o Microsoft WebView2 não foi detectado. Conecte-se à internet e instale o WebView2 Runtime da Microsoft antes de abrir o painel.', mbError, MB_OK);
end;

function InitializeUninstall: Boolean;
begin
  Result := not CorelRunning;
  if not Result then
    MsgBox('Feche o CorelDRAW antes de desinstalar o painel T-Cut.', mbError, MB_OK);
end;
