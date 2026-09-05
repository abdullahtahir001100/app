#[cfg(target_os = "windows")]
extern crate winres;

fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut res = winres::WindowsResource::new();
        // Legitimate version info reduces generic ML false positives vs blank PE metadata.
        res.set("FileDescription", "Zenvora Agent");
        res.set("ProductName", "Zenvora");
        res.set("CompanyName", "Zenvora");
        res.set("LegalCopyright", "Copyright (c) Zenvora");
        res.set("OriginalFilename", "ZenvoraAgent.exe");
        res.set("InternalName", "Zenvora");
        res.set_version_info(winres::VersionInfo::PRODUCTVERSION, 0x0001_0000_0000_0000);
        res.set_version_info(winres::VersionInfo::FILEVERSION, 0x0001_0000_0000_0000);
        res.set_manifest(
            r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <!-- asInvoker: service CreateProcessAsUser into user session cannot launch
             requireAdministrator (ERROR_ELEVATION_REQUIRED / 0x800702E4).
             Install/pair already runs elevated; the worker does not need admin. -->
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
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
