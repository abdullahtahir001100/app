use rusqlite::{Connection, Result as SqliteResult};
use std::fs;
use std::path::{Path, PathBuf};
use chrono::{DateTime, Local};
use serde_json::json;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserHistory {
    pub browser: String,
    pub url: String,
    pub title: String,
    pub visit_time: String,
    pub visit_count: i32,
    #[serde(default)]
    pub windows_user: String,
    #[serde(default)]
    pub browser_profile: String,
}

pub struct BrowserHistoryCollector;

impl BrowserHistoryCollector {
    pub fn collect_all_history() -> Vec<BrowserHistory> {
        Self::search("", 500, "desc")
    }

    pub fn search(query: &str, limit: usize, order: &str) -> Vec<BrowserHistory> {
        let max_limit = limit.clamp(1, 500);
        let order_asc = order.eq_ignore_ascii_case("asc");
        let mut all_history = Vec::new();

        for local_app_data in Self::local_app_data_roots() {
            let user = Self::username_from_path(&local_app_data);
            all_history.extend(Self::search_chrome_history_from(&local_app_data, &user, query, max_limit, order_asc));
            all_history.extend(Self::search_edge_history_from(&local_app_data, &user, query, max_limit, order_asc));
            all_history.extend(Self::search_brave_history_from(&local_app_data, &user, query, max_limit, order_asc));
            all_history.extend(Self::search_opera_history_from(&local_app_data, &user, query, max_limit, order_asc));
            all_history.extend(Self::search_vivaldi_history_from(&local_app_data, &user, query, max_limit, order_asc));
        }

        for app_data in Self::roaming_app_data_roots() {
            let user = Self::username_from_path(&app_data);
            all_history.extend(Self::search_firefox_history_from(&app_data, &user, query, max_limit, order_asc));
        }

        // Sort by visit time
        if order_asc {
            all_history.sort_by(|a, b| a.visit_time.cmp(&b.visit_time));
        } else {
            all_history.sort_by(|a, b| b.visit_time.cmp(&a.visit_time));
        }

        all_history.dedup_by(|a, b| {
            a.url == b.url
                && a.visit_time == b.visit_time
                && a.browser == b.browser
                && a.windows_user == b.windows_user
                && a.browser_profile == b.browser_profile
        });

        if all_history.len() > max_limit {
            all_history.truncate(max_limit);
        }

        all_history
    }


    /// Incremental: only visits newer than the given Chromium / Firefox high-water marks.
    /// Returns (entries, max_chromium_time, max_firefox_time).
    /// When cursors are 0 (first run), seeds to current MAX and returns empty — no full dump.
    pub fn collect_since(min_chromium_time: i64, min_firefox_time: i64) -> (Vec<BrowserHistory>, i64, i64) {
        if min_chromium_time <= 0 && min_firefox_time <= 0 {
            let (max_chrome, max_ff) = Self::discover_high_water();
            return (Vec::new(), max_chrome, max_ff);
        }

        let mut all_history = Vec::new();
        let mut max_chrome = min_chromium_time;
        let mut max_ff = min_firefox_time;

        for local_app_data in Self::local_app_data_roots() {
            let user = Self::username_from_path(&local_app_data);
            let chromium_roots: [(&str, &str); 7] = [
                ("Chrome", r"Google\Chrome\User Data"),
                ("Edge", r"Microsoft\Edge\User Data"),
                ("Brave", r"BraveSoftware\Brave-Browser\User Data"),
                ("Opera", r"Opera Software\Opera Stable"),
                ("Opera GX", r"Opera Software\Opera GX Stable"),
                ("Opera", r"Opera Software\Opera Stable\User Data"),
                ("Vivaldi", r"Vivaldi\User Data"),
            ];
            for (browser, rel) in chromium_roots {
                for (profile, path) in Self::chromium_profile_history_paths(&local_app_data.join(rel)) {
                    if let Ok((entries, hi)) =
                        Self::read_chromium_history_since(&path, browser, &user, &profile, min_chromium_time)
                    {
                        max_chrome = max_chrome.max(hi);
                        all_history.extend(entries);
                    }
                }
            }
        }

        for app_data in Self::roaming_app_data_roots() {
            let user = Self::username_from_path(&app_data);
            let profiles = app_data.join("Mozilla").join("Firefox").join("Profiles");
            if profiles.is_dir() {
                if let Ok(entries) = fs::read_dir(&profiles) {
                    for entry in entries.flatten() {
                        let profile_path = entry.path().join("places.sqlite");
                        let profile_name = entry.file_name().to_string_lossy().to_string();
                        if let Ok((rows, hi)) = Self::read_firefox_history_since(&profile_path, &user, &profile_name, min_firefox_time) {
                            max_ff = max_ff.max(hi);
                            all_history.extend(rows);
                        }
                    }
                }
            }
        }

        all_history.sort_by(|a, b| b.visit_time.cmp(&a.visit_time));
        all_history.dedup_by(|a, b| {
            a.url == b.url
                && a.visit_time == b.visit_time
                && a.browser == b.browser
                && a.windows_user == b.windows_user
                && a.browser_profile == b.browser_profile
        });
        if all_history.len() > 500 {
            all_history.truncate(500);
        }

        (all_history, max_chrome, max_ff)
    }

    pub fn discover_high_water() -> (i64, i64) {
        let mut max_chrome: i64 = 0;
        let mut max_ff: i64 = 0;

        for local_app_data in Self::local_app_data_roots() {
            let chromium_roots = [
                r"Google\Chrome\User Data",
                r"Microsoft\Edge\User Data",
                r"BraveSoftware\Brave-Browser\User Data",
                r"Opera Software\Opera Stable",
                r"Opera Software\Opera GX Stable",
                r"Opera Software\Opera Stable\User Data",
                r"Vivaldi\User Data",
            ];
            for rel in chromium_roots {
                for (_profile, path) in Self::chromium_profile_history_paths(&local_app_data.join(rel)) {
                    if let Ok(hi) = Self::chromium_max_time(&path) {
                        max_chrome = max_chrome.max(hi);
                    }
                }
            }
        }
        for app_data in Self::roaming_app_data_roots() {
            let profiles = app_data.join("Mozilla").join("Firefox").join("Profiles");
            if let Ok(entries) = fs::read_dir(profiles) {
                for entry in entries.flatten() {
                    let profile_path = entry.path().join("places.sqlite");
                    if let Ok(hi) = Self::firefox_max_time(&profile_path) {
                        max_ff = max_ff.max(hi);
                    }
                }
            }
        }
        (max_chrome, max_ff)
    }

    fn chromium_max_time(db_path: &Path) -> SqliteResult<i64> {
        let conn = Self::open_unlocked_sqlite(db_path, "Chrome")?;
        conn.query_row(
            "SELECT COALESCE(MAX(last_visit_time), 0) FROM urls",
            [],
            |row| row.get(0),
        )
    }

    fn firefox_max_time(db_path: &Path) -> SqliteResult<i64> {
        if !db_path.exists() {
            return Ok(0);
        }
        let conn = Self::open_unlocked_sqlite(db_path, "Firefox")?;
        conn.query_row(
            "SELECT COALESCE(MAX(last_visit_date), 0) FROM moz_places",
            [],
            |row| row.get(0),
        )
    }

    fn username_from_path(path: &Path) -> String {
        // C:\Users\<name>\AppData\Local -> name
        let parts: Vec<_> = path.components().collect();
        for (i, part) in parts.iter().enumerate() {
            if part.as_os_str().eq_ignore_ascii_case("Users") {
                if let Some(user) = parts.get(i + 1) {
                    return user.as_os_str().to_string_lossy().to_string();
                }
            }
        }
        whoami::username()
    }

    /// Current-user env vars plus profiles for Windows, macOS, and Linux.
    fn local_app_data_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        #[cfg(windows)]
        {
            if let Ok(path) = std::env::var("LOCALAPPDATA") {
                let p = PathBuf::from(path);
                if p.is_dir() {
                    roots.push(p);
                }
            }
            for user_home in Self::windows_user_homes() {
                let candidate = user_home.join(r"AppData\Local");
                if candidate.is_dir() && !roots.iter().any(|r| r == &candidate) {
                    roots.push(candidate);
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(home) = dirs::home_dir() {
                let candidate = home.join("Library").join("Application Support");
                if candidate.is_dir() {
                    roots.push(candidate);
                }
            }
            if let Ok(entries) = fs::read_dir("/Users") {
                for entry in entries.flatten() {
                    let candidate = entry.path().join("Library").join("Application Support");
                    if candidate.is_dir() && !roots.iter().any(|r| r == &candidate) {
                        roots.push(candidate);
                    }
                }
            }
        }
        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            if let Some(home) = dirs::home_dir() {
                let candidate = home.join(".config");
                if candidate.is_dir() {
                    roots.push(candidate);
                }
            }
        }
        roots
    }

    fn roaming_app_data_roots() -> Vec<PathBuf> {
        #[cfg(windows)]
        {
            let mut roots = Vec::new();
            if let Ok(path) = std::env::var("APPDATA") {
                let p = PathBuf::from(path);
                if p.is_dir() {
                    roots.push(p);
                }
            }
            for user_home in Self::windows_user_homes() {
                let candidate = user_home.join(r"AppData\Roaming");
                if candidate.is_dir() && !roots.iter().any(|r| r == &candidate) {
                    roots.push(candidate);
                }
            }
            roots
        }
        #[cfg(not(windows))]
        {
            Self::local_app_data_roots()
        }
    }

    fn windows_user_homes() -> Vec<PathBuf> {
        let mut homes = Vec::new();
        #[cfg(windows)]
        {
            let users_dir = PathBuf::from(r"C:\Users");
            if let Ok(entries) = fs::read_dir(&users_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if matches!(
                        name.as_str(),
                        "Public" | "Default" | "Default User" | "All Users" | "desktop.ini"
                    ) {
                        continue;
                    }
                    let path = entry.path();
                    if path.is_dir() {
                        homes.push(path);
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(entries) = fs::read_dir("/Users") {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with('.') && name != "Shared" {
                        let path = entry.path();
                        if path.is_dir() {
                            homes.push(path);
                        }
                    }
                }
            }
        }
        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            if let Some(home) = dirs::home_dir() {
                homes.push(home);
            }
        }
        homes
    }

    fn open_unlocked_sqlite(db_path: &Path, prefix: &str) -> SqliteResult<Connection> {
        let temp_path = std::env::temp_dir().join(format!(
            "zenvora_tmp_history_{}_{}.sqlite",
            prefix,
            std::process::id()
        ));

        if fs::copy(db_path, &temp_path).is_ok() {
            Connection::open(&temp_path)
        } else {
            Connection::open(db_path)
        }
    }

    fn chromium_profile_history_paths(user_data: &Path) -> Vec<(String, PathBuf)> {
        let mut paths = Vec::new();
        // Opera / some forks keep History at the user-data root (no Default folder).
        let root_history = user_data.join("History");
        if root_history.exists() {
            let label = Self::chromium_profile_display_name(user_data, "");
            paths.push((
                if label.is_empty() || label == "." {
                    "Default".to_string()
                } else {
                    label
                },
                root_history,
            ));
        }
        let candidates = [
            "Default",
            "Guest Profile",
            "System Profile",
        ];
        for name in candidates {
            let history = user_data.join(name).join("History");
            if history.exists() {
                let label = Self::chromium_profile_display_name(user_data, name);
                paths.push((label, history));
            }
        }
        if let Ok(entries) = fs::read_dir(user_data) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Chromium: "Profile 1", "Profile 2", … also numeric-looking dirs on some forks
                let is_profile = name.starts_with("Profile ")
                    || (name.chars().all(|c| c.is_ascii_digit()) && name.len() <= 3);
                if !is_profile {
                    continue;
                }
                let history = entry.path().join("History");
                if history.exists() {
                    let label = Self::chromium_profile_display_name(user_data, &name);
                    paths.push((label, history));
                }
            }
        }
        paths
    }

    /// Read Preferences `profile.name` so we show "Work" instead of "Profile 1" / "86".
    fn chromium_profile_display_name(user_data: &Path, folder: &str) -> String {
        let prefs = if folder.is_empty() {
            user_data.join("Preferences")
        } else {
            user_data.join(folder).join("Preferences")
        };
        if let Ok(raw) = fs::read_to_string(&prefs) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(name) = v
                    .pointer("/profile/name")
                    .and_then(|x| x.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    if folder.is_empty() {
                        return name.to_string();
                    }
                    return format!("{} ({})", name, folder);
                }
            }
        }
        if folder.is_empty() {
            "Default".to_string()
        } else {
            folder.to_string()
        }
    }

    fn search_chromium_family(
        local_app_data: &Path,
        windows_user: &str,
        browser_name: &str,
        relative_user_data: &str,
        query: &str,
        limit: usize,
        order_asc: bool,
    ) -> Vec<BrowserHistory> {
        let mut history = Vec::new();
        let user_data = local_app_data.join(relative_user_data);
        for (profile, path) in Self::chromium_profile_history_paths(&user_data) {
            if let Ok(entries) =
                Self::read_chromium_history_search(&path, browser_name, windows_user, &profile, query, limit, order_asc)
            {
                history.extend(entries);
            }
        }
        history
    }

    fn search_chrome_history_from(local_app_data: &Path, windows_user: &str, query: &str, limit: usize, order_asc: bool) -> Vec<BrowserHistory> {
        Self::search_chromium_family(
            local_app_data,
            windows_user,
            "Chrome",
            r"Google\Chrome\User Data",
            query,
            limit,
            order_asc,
        )
    }

    fn search_edge_history_from(local_app_data: &Path, windows_user: &str, query: &str, limit: usize, order_asc: bool) -> Vec<BrowserHistory> {
        Self::search_chromium_family(
            local_app_data,
            windows_user,
            "Edge",
            r"Microsoft\Edge\User Data",
            query,
            limit,
            order_asc,
        )
    }

    fn search_brave_history_from(local_app_data: &Path, windows_user: &str, query: &str, limit: usize, order_asc: bool) -> Vec<BrowserHistory> {
        Self::search_chromium_family(
            local_app_data,
            windows_user,
            "Brave",
            r"BraveSoftware\Brave-Browser\User Data",
            query,
            limit,
            order_asc,
        )
    }

    fn search_opera_history_from(local_app_data: &Path, windows_user: &str, query: &str, limit: usize, order_asc: bool) -> Vec<BrowserHistory> {
        let mut out = Vec::new();
        out.extend(Self::search_chromium_family(
            local_app_data,
            windows_user,
            "Opera",
            r"Opera Software\Opera Stable",
            query,
            limit,
            order_asc,
        ));
        out.extend(Self::search_chromium_family(
            local_app_data,
            windows_user,
            "Opera GX",
            r"Opera Software\Opera GX Stable",
            query,
            limit,
            order_asc,
        ));
        out.extend(Self::search_chromium_family(
            local_app_data,
            windows_user,
            "Opera",
            r"Opera Software\Opera Stable\User Data",
            query,
            limit,
            order_asc,
        ));
        out
    }

    fn search_vivaldi_history_from(local_app_data: &Path, windows_user: &str, query: &str, limit: usize, order_asc: bool) -> Vec<BrowserHistory> {
        Self::search_chromium_family(
            local_app_data,
            windows_user,
            "Vivaldi",
            r"Vivaldi\User Data",
            query,
            limit,
            order_asc,
        )
    }

    fn search_firefox_history_from(
        app_data: &Path,
        windows_user: &str,
        query: &str,
        limit: usize,
        order_asc: bool,
    ) -> Vec<BrowserHistory> {
        let mut history = Vec::new();
        let firefox_path = app_data.join("Mozilla").join("Firefox").join("Profiles");
        if !firefox_path.exists() {
            return history;
        }
        if let Ok(entries) = fs::read_dir(firefox_path) {
            for entry in entries.flatten() {
                let profile_name = entry.file_name().to_string_lossy().to_string();
                let profile_path = entry.path().join("places.sqlite");
                if profile_path.exists() {
                    if let Ok(entries) =
                        Self::read_firefox_history_search(&profile_path, windows_user, &profile_name, query, limit, order_asc)
                    {
                        history.extend(entries);
                    }
                }
            }
        }
        history
    }

    fn read_chromium_history_search(
        db_path: &Path,
        browser_name: &str,
        windows_user: &str,
        browser_profile: &str,
        query: &str,
        limit: usize,
        order_asc: bool,
    ) -> SqliteResult<Vec<BrowserHistory>> {
        let conn = Self::open_unlocked_sqlite(db_path, browser_name)?;
        let order_clause = if order_asc { "ASC" } else { "DESC" };
        let user = windows_user.to_string();
        let profile = browser_profile.to_string();
        let query_trimmed = query.trim();

        let mapper = |row: &rusqlite::Row| {
            let url: String = row.get(0)?;
            let title: String = row.get(1)?;
            let timestamp: i64 = row.get(2)?;
            let visit_count: i32 = row.get(3)?;

            let visit_time = if timestamp > 0 {
                let secs = (timestamp / 1_000_000) - 11_644_473_600;
                DateTime::from_timestamp(secs, 0)
                    .map(|dt| dt.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|| "Unknown".to_string())
            } else {
                "Unknown".to_string()
            };

            Ok(BrowserHistory {
                browser: browser_name.to_string(),
                url,
                title,
                visit_time,
                visit_count,
                windows_user: user.clone(),
                browser_profile: profile.clone(),
            })
        };

        let history: Vec<BrowserHistory> = if query_trimmed.is_empty() {
            let sql = format!(
                "SELECT url, title, last_visit_time, visit_count FROM urls ORDER BY last_visit_time {} LIMIT ?1",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([limit as i64], mapper)?;
            rows.filter_map(|r| r.ok()).collect()
        } else {
            let sql = format!(
                "SELECT url, title, last_visit_time, visit_count FROM urls WHERE (url LIKE '%' || ?1 || '%' OR title LIKE '%' || ?1 || '%') ORDER BY last_visit_time {} LIMIT ?2",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params![query_trimmed, limit as i64], mapper)?;
            rows.filter_map(|r| r.ok()).collect()
        };

        Ok(history)
    }

    fn read_firefox_history_search(
        db_path: &Path,
        windows_user: &str,
        browser_profile: &str,
        query: &str,
        limit: usize,
        order_asc: bool,
    ) -> SqliteResult<Vec<BrowserHistory>> {
        let conn = Self::open_unlocked_sqlite(db_path, "Firefox")?;
        let order_clause = if order_asc { "ASC" } else { "DESC" };
        let user = windows_user.to_string();
        let profile = browser_profile.to_string();
        let query_trimmed = query.trim();

        let mapper = |row: &rusqlite::Row| {
            let url: String = row.get(0)?;
            let title: String = row.get(1)?;
            let timestamp: i64 = row.get(2)?;

            let visit_time = if timestamp > 0 {
                let secs = timestamp / 1_000_000;
                DateTime::from_timestamp(secs, 0)
                    .map(|dt| dt.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|| "Unknown".to_string())
            } else {
                "Unknown".to_string()
            };

            Ok(BrowserHistory {
                browser: "Firefox".to_string(),
                url,
                title,
                visit_time,
                visit_count: 0,
                windows_user: user.clone(),
                browser_profile: profile.clone(),
            })
        };

        let history: Vec<BrowserHistory> = if query_trimmed.is_empty() {
            let sql = format!(
                "SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date {} LIMIT ?1",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([limit as i64], mapper)?;
            rows.filter_map(|r| r.ok()).collect()
        } else {
            let sql = format!(
                "SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL AND (url LIKE '%' || ?1 || '%' OR title LIKE '%' || ?1 || '%') ORDER BY last_visit_date {} LIMIT ?2",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params![query_trimmed, limit as i64], mapper)?;
            rows.filter_map(|r| r.ok()).collect()
        };

        Ok(history)
    }

    fn read_chromium_history(
        db_path: &Path,
        browser_name: &str,
        windows_user: &str,
        browser_profile: &str,
    ) -> SqliteResult<Vec<BrowserHistory>> {
        Self::read_chromium_history_search(db_path, browser_name, windows_user, browser_profile, "", 500, false)
    }

    fn read_firefox_history(
        db_path: &Path,
        windows_user: &str,
        browser_profile: &str,
    ) -> SqliteResult<Vec<BrowserHistory>> {
        Self::read_firefox_history_search(db_path, windows_user, browser_profile, "", 500, false)
    }


    fn read_chromium_history_since(
        db_path: &Path,
        browser_name: &str,
        windows_user: &str,
        browser_profile: &str,
        min_time: i64,
    ) -> SqliteResult<(Vec<BrowserHistory>, i64)> {
        let conn = Self::open_unlocked_sqlite(db_path, browser_name)?;
        let mut stmt = conn.prepare(
            "SELECT url, title, last_visit_time, visit_count FROM urls \
             WHERE last_visit_time > ?1 \
             ORDER BY last_visit_time ASC LIMIT 500",
        )?;

        let user = windows_user.to_string();
        let profile = browser_profile.to_string();
        let history = stmt
            .query_map([min_time], |row| {
                let url: String = row.get(0)?;
                let title: String = row.get(1)?;
                let timestamp: i64 = row.get(2)?;
                let visit_count: i32 = row.get(3)?;

                let visit_time = if timestamp > 0 {
                    let secs = (timestamp / 1_000_000) - 11_644_473_600;
                    DateTime::from_timestamp(secs, 0)
                        .map(|dt| dt.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_else(|| "Unknown".to_string())
                } else {
                    "Unknown".to_string()
                };

                Ok(BrowserHistory {
                    browser: browser_name.to_string(),
                    url,
                    title,
                    visit_time,
                    visit_count,
                    windows_user: user.clone(),
                    browser_profile: profile.clone(),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        let max_from_db: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(last_visit_time), 0) FROM urls WHERE last_visit_time > ?1",
                [min_time],
                |row| row.get(0),
            )
            .unwrap_or(min_time);

        Ok((history, max_from_db.max(min_time)))
    }

    fn read_firefox_history_since(
        db_path: &Path,
        windows_user: &str,
        browser_profile: &str,
        min_time: i64,
    ) -> SqliteResult<(Vec<BrowserHistory>, i64)> {
        if !db_path.exists() {
            return Ok((Vec::new(), min_time));
        }
        let conn = Self::open_unlocked_sqlite(db_path, "Firefox")?;
        let mut stmt = conn.prepare(
            "SELECT url, title, last_visit_date FROM moz_places \
             WHERE last_visit_date IS NOT NULL AND last_visit_date > ?1 \
             ORDER BY last_visit_date ASC LIMIT 500",
        )?;

        let user = windows_user.to_string();
        let profile = browser_profile.to_string();
        let history = stmt
            .query_map([min_time], |row| {
                let url: String = row.get(0)?;
                let title: String = row.get(1)?;
                let timestamp: i64 = row.get(2)?;

                let visit_time = if timestamp > 0 {
                    let secs = timestamp / 1_000_000;
                    DateTime::from_timestamp(secs, 0)
                        .map(|dt| dt.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_else(|| "Unknown".to_string())
                } else {
                    "Unknown".to_string()
                };

                Ok(BrowserHistory {
                    browser: "Firefox".to_string(),
                    url,
                    title,
                    visit_time,
                    visit_count: 0,
                    windows_user: user.clone(),
                    browser_profile: profile.clone(),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        let max_from_db: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(last_visit_date), 0) FROM moz_places WHERE last_visit_date > ?1",
                [min_time],
                |row| row.get(0),
            )
            .unwrap_or(min_time);

        Ok((history, max_from_db.max(min_time)))
    }

    pub fn to_json_array(history: &[BrowserHistory]) -> serde_json::Value {
        json!(history.iter().map(|h| json!({
            "browser": h.browser,
            "url": h.url,
            "title": h.title,
            "visitTime": h.visit_time,
            "visitCount": h.visit_count,
            "windowsUser": h.windows_user,
            "browserProfile": h.browser_profile,
        })).collect::<Vec<_>>())
    }
}
