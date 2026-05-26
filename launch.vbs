Set objShell = CreateObject("WScript.Shell")
' Start the local server
objShell.Run "npx serve -l 3000 -s C:\Users\panyi\weather", 0, False
' Wait for server to start
WScript.Sleep 2000
' Open in Edge app mode (no browser chrome, standalone window)
objShell.Run "msedge --app=http://localhost:3000 --window-size=420,850"
Set objShell = Nothing
