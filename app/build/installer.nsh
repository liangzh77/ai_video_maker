!macro customInstall
  !ifdef APP_PRODUCT_FILENAME
    StrCpy $0 "$APPDATA\${APP_PRODUCT_FILENAME}"
  !else
    StrCpy $0 "$APPDATA\${APP_FILENAME}"
  !endif

  SetShellVarContext current
  CreateDirectory "$0"
  Delete "$0\config.json"
  ClearErrors
  CopyFiles /SILENT /FILESONLY "$INSTDIR\resources\config.json" "$0\config.json"
  IfErrors 0 +2
    Abort "配置文件写入失败：无法写入 $0\config.json，请检查当前用户的 AppData\Roaming 目录权限。"
!macroend
