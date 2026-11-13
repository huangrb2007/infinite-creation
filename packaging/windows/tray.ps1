# 短剧制作 Studio · 系统托盘图标（由 launcher.mjs 在 Windows 上启动）
param(
  [string]$Url = "http://127.0.0.1:4710",
  [int]$ControlPort = 4719,
  [string]$Icon = "",
  [string]$LogDir = ""
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$tray = New-Object System.Windows.Forms.NotifyIcon
if ($Icon -and (Test-Path $Icon)) { $tray.Icon = New-Object System.Drawing.Icon($Icon) } else { $tray.Icon = [System.Drawing.SystemIcons]::Application }
$tray.Text = "短剧制作 Studio（运行中）"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("打开短剧制作")
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Start-Process $Url })
$logs = $menu.Items.Add("打开日志文件夹")
$logs.add_Click({ if ($LogDir) { Start-Process explorer.exe $LogDir } })
[void]$menu.Items.Add("-")
$quit = $menu.Items.Add("退出")
$quit.add_Click({
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$ControlPort/stop" | Out-Null } catch {}
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu
$tray.add_MouseDoubleClick({ Start-Process $Url })
$tray.ShowBalloonTip(3000, "短剧制作 Studio", "已在后台运行，双击托盘图标打开界面，右键可退出。", [System.Windows.Forms.ToolTipIcon]::Info)

# 主程序被其它方式停止时，托盘也跟着退出
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $ControlPort); $c.Close() } catch { $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
