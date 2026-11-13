; 短剧制作 Studio · Windows 安装包（NSIS，可在 Linux 上用 makensis 构建）
; 构建：makensis -DVERSION=0.2.0 -DSTAGE=<staging 目录> -DOUTFILE=<输出 exe> installer.nsi
; staging 目录结构：app\  node\node.exe  bin\ffmpeg.exe bin\ffprobe.exe
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APPNAME "短剧制作 Studio"
!define APPKEY "DuanjuStudio"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"

!include "MUI2.nsh"

Name "${APPNAME}"
OutFile "${OUTFILE}"
; 安装到当前用户目录：不需要管理员权限，程序目录可写（技能安装、日志）
InstallDir "$LOCALAPPDATA\Programs\${APPKEY}"
InstallDirRegKey HKCU "Software\${APPKEY}" "InstallDir"
RequestExecutionLevel user
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} 安装程序"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT · 基于 SwotAtmk/infinite-creation"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 ${APPNAME}"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function LaunchApp
  ExecShell "open" "$INSTDIR\${APPKEY}.exe"
FunctionEnd

Section "主程序" SecMain
  SectionIn RO
  ; 升级安装前先停掉正在运行的旧版本
  IfFileExists "$INSTDIR\node\node.exe" 0 +2
    nsExec::Exec '"$INSTDIR\node\node.exe" "$INSTDIR\app\packaging\launcher.mjs" --stop'
  Sleep 1500
  ; 旧版本的程序文件整体替换（用户数据在 %LOCALAPPDATA%\DuanjuStudio，不受影响）
  RMDir /r "$INSTDIR\app\.next"
  RMDir /r "$INSTDIR\app\node_modules"

  SetOutPath "$INSTDIR"
  File /r "${STAGE}\app"
  File /r "${STAGE}\node"
  File /r "${STAGE}\bin"
  File "${STAGE}\${APPKEY}.exe"
  File "${STAGE}\${APPKEY}-stop.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${APPKEY}.exe"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\停止 ${APPNAME}.lnk" "$INSTDIR\${APPKEY}-stop.exe"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\卸载.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPKEY}.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\${APPKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "huangrb2007"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec '"$INSTDIR\node\node.exe" "$INSTDIR\app\packaging\launcher.mjs" --stop'
  Sleep 1500
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\bin"
  Delete "$INSTDIR\${APPKEY}.exe"
  Delete "$INSTDIR\${APPKEY}-stop.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APPKEY}"
  ; 用户数据（项目、素材、配置）保留在 %LOCALAPPDATA%\DuanjuStudio，需要时手动删除
SectionEnd
