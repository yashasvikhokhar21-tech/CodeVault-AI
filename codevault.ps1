$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node "$scriptDir\backend\cli.js" @args
