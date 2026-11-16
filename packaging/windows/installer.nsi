; 短剧制作 Studio · Windows 安装包（NSIS，可在 Linux 上用 makensis 构建）
; 构建：makensis -DVERSION=0.2.0 -DSTAGE=<staging 目录> -DOUTFILE=<输出 exe> installer.nsi
; staging 目录结构：app\（程序文件）  heavy\（大体积静态内容，装到 app\ 下）  node\node.exe  bin\ffmpeg.exe bin\ffprobe.exe
; 加 -DUPDATE=1 生成只含程序文件的升级包
Unicode true
ManifestDPIAware true
; 完整包不用 solid 压缩：升级时运行环境（Node、ffmpeg、node_modules，约 5 万个文件）没变就整段跳过，
; solid 压缩下跳过也得把前面的数据解一遍，快不起来。升级包只有程序文件，用 solid 压得更小。
!ifdef UPDATE
  SetCompressor /SOLID lzma
!else
  SetCompressor lzma
!endif
SetCompressorDictSize 64

!ifndef RUNTIME_SIG
  !define RUNTIME_SIG "dev"
!endif

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APPNAME "短剧制作 Studio"
!define APPKEY "DuanjuStudio"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"

!include "MUI2.nsh"
!include "LogicLib.nsh"

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
!ifndef UPDATE
  !insertmacro MUI_PAGE_DIRECTORY
!endif
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function LaunchApp
  ExecShell "open" "$INSTDIR\${APPKEY}.exe"
FunctionEnd

; 读已安装版本的运行环境标识（Node 版本 + ffmpeg 版本 + 依赖清单的摘要），放进 $1；没有则为空
Function ReadRuntimeSig
  StrCpy $1 ""
  IfFileExists "$INSTDIR\runtime.sig" 0 done
  ClearErrors
  FileOpen $0 "$INSTDIR\runtime.sig" r
  IfErrors done
  FileRead $0 $1
  FileClose $0
  done:
FunctionEnd

!ifdef UPDATE
Function .onInit
  ; 升级包只换程序文件，必须装在已有的完整安装之上，而且运行环境要和这个版本一致
  ReadRegStr $0 HKCU "Software\${APPKEY}" "InstallDir"
  ${If} $0 == ""
    MessageBox MB_ICONSTOP "没有找到已安装的${APPNAME}。$\r$\n请下载完整安装包 DuanjuStudio-Setup-${VERSION}.exe 安装。"
    Abort
  ${EndIf}
  StrCpy $INSTDIR $0
  Call ReadRuntimeSig
  ${If} $1 != "${RUNTIME_SIG}"
    MessageBox MB_ICONSTOP "这个升级包和已安装版本的运行环境不一致（依赖有更新，或者你装的是 0.2.10 及更早的版本）。$\r$\n请下载完整安装包 DuanjuStudio-Setup-${VERSION}.exe 安装一次，之后就可以用升级包了。"
    Abort
  ${EndIf}
FunctionEnd
!endif

Section "主程序" SecMain
  SectionIn RO
  ; 升级安装前先停掉正在运行的旧版本
  IfFileExists "$INSTDIR\node\node.exe" 0 +2
    nsExec::Exec '"$INSTDIR\node\node.exe" "$INSTDIR\app\packaging\launcher.mjs" --stop'
  Sleep 1500

  ; —— 程序文件（每次都换，约 2700 个文件）——
  ; 只清掉会留下旧文件的几个目录；用户数据在 %LOCALAPPDATA%\DuanjuStudio，自己装的技能在 app\skills，都不动
  RMDir /r "$INSTDIR\app\.next"
  RMDir /r "$INSTDIR\app\app"
  RMDir /r "$INSTDIR\app\lib"
  RMDir /r "$INSTDIR\app\studio"
  ; 2026-11 起内置技能只保留「导演助理 + h3-prompt-writing」：删掉旧版带的技能目录（用户自己装的其它技能不动）
  RMDir /r "$INSTDIR\app\skills\0715-scriptwriter"
  RMDir /r "$INSTDIR\app\skills\3d-animation-short-generator"
  RMDir /r "$INSTDIR\app\skills\ai-manga-planner"
  RMDir /r "$INSTDIR\app\skills\ai-music-studio"
  RMDir /r "$INSTDIR\app\skills\ai-video-script"
  RMDir /r "$INSTDIR\app\skills\brand-promo-video-generator"
  RMDir /r "$INSTDIR\app\skills\cinematic-ai-comic-director"
  RMDir /r "$INSTDIR\app\skills\co-op-game-intro-generator"
  RMDir /r "$INSTDIR\app\skills\comic-drama-generator"
  RMDir /r "$INSTDIR\app\skills\era-consistency-optimizer"
  RMDir /r "$INSTDIR\app\skills\h3-prompt-writing"
  RMDir /r "$INSTDIR\app\skills\handdrawn-live-video-generator"
  RMDir /r "$INSTDIR\app\skills\hf-drama-storyboard-script"
  RMDir /r "$INSTDIR\app\skills\image-prompt-writing"
  RMDir /r "$INSTDIR\app\skills\manga-drama-generator"
  RMDir /r "$INSTDIR\app\skills\manga-full-stack"
  RMDir /r "$INSTDIR\app\skills\manju-director-agent"
  RMDir /r "$INSTDIR\app\skills\media-storyboard-design"
  RMDir /r "$INSTDIR\app\skills\micro-drama-creator"
  RMDir /r "$INSTDIR\app\skills\minimalist-product-ad-generator"
  RMDir /r "$INSTDIR\app\skills\minimax-drama-prompt"
  RMDir /r "$INSTDIR\app\skills\music-video-subtitle-generator"
  RMDir /r "$INSTDIR\app\skills\novel-to-skitscreenplay"
  RMDir /r "$INSTDIR\app\skills\novel-to-storyboard"
  RMDir /r "$INSTDIR\app\skills\novel-to-video"
  RMDir /r "$INSTDIR\app\skills\paper-collage-explainer-generator"
  RMDir /r "$INSTDIR\app\skills\papercraft-stop-motion-explainer"
  RMDir /r "$INSTDIR\app\skills\prompt-bozo"
  RMDir /r "$INSTDIR\app\skills\scene-blocking-consistency"
  RMDir /r "$INSTDIR\app\skills\script-master"
  RMDir /r "$INSTDIR\app\skills\script-to-manga"
  RMDir /r "$INSTDIR\app\skills\script-to-storyboard"
  RMDir /r "$INSTDIR\app\skills\sd-asset-engine"
  RMDir /r "$INSTDIR\app\skills\sd-combat-engine"
  RMDir /r "$INSTDIR\app\skills\sd-decision-engine"
  RMDir /r "$INSTDIR\app\skills\sd-feed-engine"
  RMDir /r "$INSTDIR\app\skills\sd-jieshuo-engine"
  RMDir /r "$INSTDIR\app\skills\sd-overseas-engine"
  RMDir /r "$INSTDIR\app\skills\sd-qc-engine"
  RMDir /r "$INSTDIR\app\skills\sd-real-engine"
  RMDir /r "$INSTDIR\app\skills\sd-recon-engine"
  RMDir /r "$INSTDIR\app\skills\sd-script-engine"
  RMDir /r "$INSTDIR\app\skills\sd-storyboard-engine"
  RMDir /r "$INSTDIR\app\skills\sd-xuanhuan-engine"
  RMDir /r "$INSTDIR\app\skills\short-drama-director"
  RMDir /r "$INSTDIR\app\skills\short-drama-scriptwriting"
  RMDir /r "$INSTDIR\app\skills\story-pipeline-cn"
  RMDir /r "$INSTDIR\app\skills\tts-voice-design"
  RMDir /r "$INSTDIR\app\skills\video-cinematography"
  SetOutPath "$INSTDIR\app"
  File /r /x node_modules "${STAGE}\app\*.*"

!ifndef UPDATE
  ; —— 运行环境（Node、ffmpeg、node_modules，约 5 万个文件）：和已安装的一样就整段跳过 ——
  Call ReadRuntimeSig
  ${If} $1 == "${RUNTIME_SIG}"
  ${AndIf} ${FileExists} "$INSTDIR\node\node.exe"
  ${AndIf} ${FileExists} "$INSTDIR\bin\ffmpeg.exe"
  ${AndIf} ${FileExists} "$INSTDIR\app\node_modules\next\package.json"
    DetailPrint "运行环境没有变化，跳过（只更新程序文件）"
  ${Else}
    DetailPrint "安装运行环境（首次安装或依赖有更新，需要几分钟）"
    Delete "$INSTDIR\runtime.sig"
    RMDir /r "$INSTDIR\app\node_modules"
    SetOutPath "$INSTDIR\app"
    File /r "${STAGE}\app\node_modules"
    ; Agent 内核、代码电影素材库、示例媒体：体积大、几乎不变，和运行环境一起装
    RMDir /r "$INSTDIR\app\vendor"
    File /r "${STAGE}\heavy\*.*"
    SetOutPath "$INSTDIR"
    File /r "${STAGE}\node"
    File /r "${STAGE}\bin"
    FileOpen $0 "$INSTDIR\runtime.sig" w
    FileWrite $0 "${RUNTIME_SIG}"
    FileClose $0
  ${EndIf}
!endif

  SetOutPath "$INSTDIR"
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
  Delete "$INSTDIR\runtime.sig"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APPKEY}"
  ; 用户数据（项目、素材、配置）保留在 %LOCALAPPDATA%\DuanjuStudio，需要时手动删除
SectionEnd
