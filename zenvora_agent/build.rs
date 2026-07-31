extern crate winres;

fn main() {
    if cfg!(target_os = "windows") {
        let mut res = winres::WindowsResource::new();
        // Legitimate version info reduces generic ML false positives vs blank PE metadata.
        res.set("FileDescription", "Zenvora Remote Administration Agent");
        res.set("ProductName", "Zenvora Agent");
        res.set("CompanyName", "Zenvora");
        res.set("LegalCopyright", "Copyright (c) Zenvora");
        res.set("OriginalFilename", "ZenvoraAgent.exe");
        res.set("InternalName", "ZenvoraAgent");
        res.set_version_info(winres::VersionInfo::PRODUCTVERSION, 0x0001_0000_0000_0000);
        res.set_version_info(winres::VersionInfo::FILEVERSION, 0x0001_0000_0000_0000);
        res.set_manifest(
            r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <assemblyIdentity version="1.0.0.0" name="Zenvora.Agent" type="win32"/>
</assembly>
"#,
        );
        res.compile().unwrap();
    }
}
