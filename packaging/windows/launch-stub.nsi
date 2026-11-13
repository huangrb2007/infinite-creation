; 双击启动用的小程序：不弹黑色命令行窗口，后台运行 node 启动器
; 构建两次：-DMODE=start 输出 DuanjuStudio.exe，-DMODE=stop 输出 DuanjuStudio-stop.exe
Unicode true
SilentInstall silent
RequestExecutionLevel user
SetCompressor /SOLID lzma
OutFile "${OUTFILE}"
Icon "icon.ico"
Name "短剧制作 Studio"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "短剧制作 Studio"
VIAddVersionKey "FileDescription" "短剧制作 Studio"
VIAddVersionKey "FileVersion" "${VERSION}"

Section
  !if "${MODE}" == "stop"
    nsExec::Exec '"$EXEDIR\node\node.exe" "$EXEDIR\app\packaging\launcher.mjs" --stop'
    MessageBox MB_OK|MB_ICONINFORMATION "短剧制作 Studio 已停止。"
  !else
    IfFileExists "$EXEDIR\node\node.exe" +3
      MessageBox MB_OK|MB_ICONSTOP "找不到 node\node.exe，请重新安装。"
      Abort
    ExecShell "open" "$EXEDIR\node\node.exe" '"$EXEDIR\app\packaging\launcher.mjs"' SW_HIDE
  !endif
SectionEnd
