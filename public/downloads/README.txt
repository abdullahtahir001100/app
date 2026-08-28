Place ZenvoraAgent.exe here after: cargo build --release (from zenvora_agent/).

Android APKs:
  Lite (Play Protect soft):  public/downloads/Zenvora-lite.apk
    build: cd android-agent-kotlin && gradlew assembleLiteRelease
  Full (all + Device Admin): public/downloads/Zenvora-full.apk
    build: cd android-agent-kotlin && gradlew assembleFullRelease

  Download URLs:
    /api/agent/download?platform=android&flavor=lite
    /api/agent/download?platform=android&flavor=full
