; Keep the existing application identity and current-user registry paths.
; Skip the user/machine choice page, including on reinstall and uninstall.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
