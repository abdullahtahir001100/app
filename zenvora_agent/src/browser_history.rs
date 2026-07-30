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
        let mut all_history = Vec::new();

        for local_app_data in Self::local_app_data_roots() {
            let user = Self::username_from_path(&local_app_data);
            all_history.extend(Self::collect_chrome_history_from(&local_app_data, &user));
            all_history.extend(Self::collect_edge_history_from(&local_app_data, &user));
        }

        for app_data in Self::roaming_app_data_roots() {
            let user = Self::username_from_path(&app_data);
            all_history.extend(Self::collect_firefox_history_from(&app_data, &user));
        }

        // Sort by visit time descending and de-dupe exact url+time pairs.
        all_history.sort_by(|a, b| b.visit_time.cmp(&a.visit_time));
        all_history.dedup_by(|a, b| {
            a.url == b.url
                && a.visit_time == b.visit_time
                && a.browser == b.browser
                && a.windows_user == b.windows_user
                && a.browser_profile == b.browser_profile
        });
        if all_history.len() > 4000 {
            all_history.truncate(4000);
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
            for (profile, path) in Self::chromium_profile_history_paths(&local_app_data.join("Google").join("Chrome").join("User Data")) {
                if let Ok((entries, hi)) = Self::read_chromium_history_since(&path, "Chrome", &user, &profile, min_chromium_time) {
                    max_chrome = max_chrome.max(hi);
                    all_history.extend(entries);
                }
            }
            for (profile, path) in Self::chromium_profile_history_paths(&local_app_data.join("Microsoft").join("Edge").join("User Data")) {
                if let Ok((entries, hi)) = Self::read_chromium_history_since(&path, "Edge", &user, &profile, min_chromium_time) {
                    max_chrome = max_chrome.max(hi);
                    all_history.extend(entries);
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

    fn discover_high_water() -> (i64, i64) {
        let mut max_chrome: i64 = 0;
        let mut max_ff: i64 = 0;

        for local_app_data in Self::local_app_data_roots() {
            for (_profile, path) in Self::chromium_profile_history_paths(&local_app_data.join("Google").join("Chrome").join("User Data")) {
                if let Ok(hi) = Self::chromium_max_time(&path) {
                    max_chrome = max_chrome.max(hi);
                }
            }
            for (_profile, path) in Self::chromium_profile_history_paths(&local_app_data.join("Microsoft").join("Edge").join("User Data")) {
                if let Ok(hi) = Self::chromium_max_time(&path) {
                    max_chrome = max_chrome.max(hi);
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

    /// Current-user env vars plus every Windows profile under C:\Users.
    fn local_app_data_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
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
        roots
    }

    fn roaming_app_data_roots() -> Vec<PathBuf> {
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

    fn windows_user_homes() -> Vec<PathBuf> {
        let mut homes = Vec::new();
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
        let default = user_data.join(r"Default\History");
        if default.exists() {
            paths.push(("Default".to_string(), default));
        }
        if let Ok(entries) = fs::read_dir(user_data) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("Profile ") {
                    let history = entry.path().join("History");
                    if history.exists() {
                        paths.push((name, history));
                    }
                }
            }
        }
        paths
    }

    fn collect_chrome_history_from(local_app_data: &Path, windows_user: &str) -> Vec<BrowserHistory> {
        let mut history = Vec::new();
        let user_data = local_app_data.join(r"Google\Chrome\User Data");
        for (profile, path) in Self::chromium_profile_history_paths(&user_data) {
            if let Ok(entries) = Self::read_chromium_history(&path, "Chrome", windows_user, &profile) {
                history.extend(entries);
            }
        }
        history
    }

    fn collect_edge_history_from(local_app_data: &Path, windows_user: &str) -> Vec<BrowserHistory> {
        let mut history = Vec::new();
        let user_data = local_app_data.join(r"Microsoft\Edge\User Data");
        for (profile, path) in Self::chromium_profile_history_paths(&user_data) {
            if let Ok(entries) = Self::read_chromium_history(&path, "Edge", windows_user, &profile) {
                history.extend(entries);
            }
        }
        history
    }

    fn collect_firefox_history_from(app_data: &Path, windows_user: &str) -> Vec<BrowserHistory> {
        let mut history = Vec::new();
        let firefox_path = app_data.join(r"Mozilla\Firefox\Profiles");
        if !firefox_path.exists() {
            return history;
        }
        if let Ok(entries) = fs::read_dir(firefox_path) {
            for entry in entries.flatten() {
                let profile_name = entry.file_name().to_string_lossy().to_string();
                let profile_path = entry.path().join("places.sqlite");
                if profile_path.exists() {
                    if let Ok(entries) =
                        Self::read_firefox_history(&profile_path, windows_user, &profile_name)
                    {
                        history.extend(entries);
                    }
                }
            }
        }
        history
    }

    fn read_chromium_history(
        db_path: &Path,
        browser_name: &str,
        windows_user: &str,
        browser_profile: &str,
    ) -> SqliteResult<Vec<BrowserHistory>> {
        let conn = Self::open_unlocked_sqlite(db_path, browser_name)?;
        let mut stmt = conn.prepare(
            "SELECT url, title, last_visit_time, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 500"
        )?;

        let user = windows_user.to_string();
        let profile = browser_profile.to_string();
        let history = stmt
            .query_map([], |row| {
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

        Ok(history)
    }

    fn read_firefox_history(
        db_path: &Path,
        windows_user: &str,
        browser_profile: &str,
    ) -> SqliteResult<Vec<BrowserHistory>> {
        let conn = Self::open_unlocked_sqlite(db_path, "Firefox")?;
        let mut stmt = conn.prepare(
            "SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 500"
        )?;

        let user = windows_user.to_string();
        let profile = browser_profile.to_string();
        let history = stmt
            .query_map([], |row| {
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

        Ok(history)
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
