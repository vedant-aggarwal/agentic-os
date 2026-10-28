# One line of JSON every RIBBON_EVERY seconds (30 by default): the foreground window's title, its process name
# and pid, and how long the keyboard and mouse have been idle. Read by ribbon-watch.ts; nothing is stored here.
# user32 GetForegroundWindow + GetWindowText first; when that gives nothing, the newest process with a main window.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace Ribbon -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
'@
$every = 0
if ($env:RIBBON_EVERY) { $every = [int]$env:RIBBON_EVERY }
if ($every -lt 5) { $every = 30 }

while ($true) {
  $title = ''; $proc = ''; $procId = [uint32]0
  $h = [Ribbon.Win]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 1024
    [void][Ribbon.Win]::GetWindowText($h, $sb, 1024)
    $title = $sb.ToString()
    [void][Ribbon.Win]::GetWindowThreadProcessId($h, [ref]$procId)
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) { $proc = $p.ProcessName }
  }
  if (-not $title -and -not $proc) {
    $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Sort-Object StartTime -Descending | Select-Object -First 1
    if ($p) { $title = $p.MainWindowTitle; $proc = $p.ProcessName; $procId = [uint32]$p.Id }
  }
  $idle = -1
  $lii = New-Object -TypeName 'Ribbon.Win+LASTINPUTINFO'
  $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
  if ([Ribbon.Win]::GetLastInputInfo([ref]$lii)) { $idle = [int](([uint32][Environment]::TickCount - $lii.dwTime) / 1000) }
  $o = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); title = $title; process = $proc; pid = [int]$procId; idle = $idle }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds $every
}
