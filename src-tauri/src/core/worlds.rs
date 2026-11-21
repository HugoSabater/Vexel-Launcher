use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine as _;
use flate2::read::GzDecoder;
use serde::Serialize;

const MAX_DECOMPRESSED_NBT_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ICON_PNG_BYTES: u64 = 512 * 1024;
const MAX_NBT_DEPTH: usize = 32;
const MAX_NBT_COLLECTION_LEN: usize = 2_000_000;
const MAX_CANDIDATE_WORLDS: usize = 24;
const MAX_RECENT_WORLDS: usize = 3;

const TAG_END: u8 = 0;
const TAG_BYTE: u8 = 1;
const TAG_SHORT: u8 = 2;
const TAG_INT: u8 = 3;
const TAG_LONG: u8 = 4;
const TAG_FLOAT: u8 = 5;
const TAG_DOUBLE: u8 = 6;
const TAG_BYTE_ARRAY: u8 = 7;
const TAG_STRING: u8 = 8;
const TAG_LIST: u8 = 9;
const TAG_COMPOUND: u8 = 10;
const TAG_INT_ARRAY: u8 = 11;
const TAG_LONG_ARRAY: u8 = 12;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorldSummary {
    pub folder_name: String,
    pub level_name: String,
    pub game_type: Option<String>,
    pub hardcore: bool,
    pub last_played_ms: u64,
    pub last_modified_ms: u64,
    pub mc_version: Option<String>,
    pub seed: Option<String>,
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct LevelDatMeta {
    pub level_name: Option<String>,
    pub game_type: Option<String>,
    pub hardcore: bool,
    pub last_played_ms: Option<u64>,
    pub mc_version: Option<String>,
    pub seed: Option<String>,
}

struct NbtCursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> NbtCursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(len)?;
        let slice = self.data.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }

    fn skip_bytes(&mut self, len: usize) -> Option<()> {
        let _ = self.read_bytes(len)?;
        Some(())
    }

    fn read_u8(&mut self) -> Option<u8> {
        let bytes = self.read_bytes(1)?;
        bytes.first().copied()
    }

    fn read_i8(&mut self) -> Option<i8> {
        Some(self.read_u8()? as i8)
    }

    fn read_u16_be(&mut self) -> Option<u16> {
        let bytes = self.read_bytes(2)?;
        let arr: [u8; 2] = bytes.try_into().ok()?;
        Some(u16::from_be_bytes(arr))
    }

    fn read_i32_be(&mut self) -> Option<i32> {
        let bytes = self.read_bytes(4)?;
        let arr: [u8; 4] = bytes.try_into().ok()?;
        Some(i32::from_be_bytes(arr))
    }

    fn read_i64_be(&mut self) -> Option<i64> {
        let bytes = self.read_bytes(8)?;
        let arr: [u8; 8] = bytes.try_into().ok()?;
        Some(i64::from_be_bytes(arr))
    }

    fn read_string(&mut self) -> Option<String> {
        let len = usize::from(self.read_u16_be()?);
        let bytes = self.read_bytes(len)?;
        Some(String::from_utf8_lossy(bytes).into_owned())
    }

    fn skip_string(&mut self) -> Option<()> {
        let len = usize::from(self.read_u16_be()?);
        self.skip_bytes(len)
    }

    fn skip_payload(&mut self, tag_type: u8, depth: usize) -> Option<()> {
        if depth > MAX_NBT_DEPTH {
            return None;
        }

        match tag_type {
            TAG_END => Some(()),
            TAG_BYTE => self.skip_bytes(1),
            TAG_SHORT => self.skip_bytes(2),
            TAG_INT | TAG_FLOAT => self.skip_bytes(4),
            TAG_LONG | TAG_DOUBLE => self.skip_bytes(8),
            TAG_BYTE_ARRAY => {
                let len = self.read_i32_be()?;
                let count = usize::try_from(len).ok()?;
                if count > MAX_NBT_COLLECTION_LEN {
                    return None;
                }
                self.skip_bytes(count)
            }
            TAG_STRING => self.skip_string(),
            TAG_LIST => {
                let elem_type = self.read_u8()?;
                let raw_count = self.read_i32_be()?;
                if raw_count <= 0 {
                    // Valid empty list in NBT (commonly encoded as elem_type=TAG_END, count=0)
                    return Some(());
                }
                if elem_type == TAG_END {
                    return None;
                }
                let count = usize::try_from(raw_count).ok()?;
                if count > MAX_NBT_COLLECTION_LEN {
                    return None;
                }
                match elem_type {
                    TAG_BYTE => self.skip_bytes(count),
                    TAG_SHORT => self.skip_bytes(count.checked_mul(2)?),
                    TAG_INT | TAG_FLOAT => self.skip_bytes(count.checked_mul(4)?),
                    TAG_LONG | TAG_DOUBLE => self.skip_bytes(count.checked_mul(8)?),
                    _ => {
                        for _ in 0..count {
                            self.skip_payload(elem_type, depth + 1)?;
                        }
                        Some(())
                    }
                }
            }
            TAG_COMPOUND => {
                loop {
                    let child_type = self.read_u8()?;
                    if child_type == TAG_END {
                        return Some(());
                    }
                    self.skip_string()?;
                    self.skip_payload(child_type, depth + 1)?;
                }
            }
            TAG_INT_ARRAY => {
                let len = self.read_i32_be()?;
                let count = usize::try_from(len).ok()?;
                if count > MAX_NBT_COLLECTION_LEN {
                    return None;
                }
                let byte_len = count.checked_mul(4)?;
                self.skip_bytes(byte_len)
            }
            TAG_LONG_ARRAY => {
                let len = self.read_i32_be()?;
                let count = usize::try_from(len).ok()?;
                if count > MAX_NBT_COLLECTION_LEN {
                    return None;
                }
                let byte_len = count.checked_mul(8)?;
                self.skip_bytes(byte_len)
            }
            _ => None,
        }
    }
}

fn map_game_type(raw: i32) -> Option<String> {
    match raw {
        0 => Some("survival".to_string()),
        1 => Some("creative".to_string()),
        2 => Some("adventure".to_string()),
        3 => Some("spectator".to_string()),
        _ => None,
    }
}

fn parse_version_compound(cursor: &mut NbtCursor<'_>, depth: usize) -> Option<Option<String>> {
    if depth > MAX_NBT_DEPTH {
        return None;
    }
    let mut name = None;
    loop {
        let tag_type = cursor.read_u8()?;
        if tag_type == TAG_END {
            return Some(name);
        }
        let field_name = cursor.read_string()?;
        if field_name == "Name" && tag_type == TAG_STRING {
            let val = cursor.read_string()?;
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                name = Some(trimmed.to_string());
            }
        } else {
            cursor.skip_payload(tag_type, depth + 1)?;
        }
    }
}

fn parse_world_gen_settings_compound(cursor: &mut NbtCursor<'_>, depth: usize) -> Option<Option<i64>> {
    if depth > MAX_NBT_DEPTH {
        return None;
    }
    let mut seed = None;
    loop {
        let tag_type = cursor.read_u8()?;
        if tag_type == TAG_END {
            return Some(seed);
        }
        let field_name = cursor.read_string()?;
        if field_name == "seed" && tag_type == TAG_LONG {
            seed = Some(cursor.read_i64_be()?);
        } else {
            cursor.skip_payload(tag_type, depth + 1)?;
        }
    }
}

fn parse_data_compound(cursor: &mut NbtCursor<'_>, depth: usize) -> Option<LevelDatMeta> {
    if depth > MAX_NBT_DEPTH {
        return None;
    }
    let mut meta = LevelDatMeta::default();
    let mut modern_seed: Option<i64> = None;
    let mut legacy_seed: Option<i64> = None;

    loop {
        let tag_type = cursor.read_u8()?;
        if tag_type == TAG_END {
            break;
        }
        let field_name = cursor.read_string()?;
        match (field_name.as_str(), tag_type) {
            ("LevelName", TAG_STRING) => {
                let raw = cursor.read_string()?;
                let trimmed = raw.trim();
                if !trimmed.is_empty() {
                    meta.level_name = Some(trimmed.to_string());
                }
            }
            ("GameType", TAG_INT) => {
                meta.game_type = map_game_type(cursor.read_i32_be()?);
            }
            ("hardcore", TAG_BYTE) => {
                meta.hardcore = cursor.read_i8()? != 0;
            }
            ("LastPlayed", TAG_LONG) => {
                let val = cursor.read_i64_be()?;
                if val > 0 {
                    meta.last_played_ms = Some(val as u64);
                }
            }
            ("RandomSeed", TAG_LONG) => {
                legacy_seed = Some(cursor.read_i64_be()?);
            }
            ("Version", TAG_COMPOUND) => {
                meta.mc_version = parse_version_compound(cursor, depth + 1)?;
            }
            ("WorldGenSettings", TAG_COMPOUND) => {
                modern_seed = parse_world_gen_settings_compound(cursor, depth + 1)?;
            }
            _ => {
                cursor.skip_payload(tag_type, depth + 1)?;
            }
        }
    }

    meta.seed = modern_seed.or(legacy_seed).map(|s| s.to_string());
    Some(meta)
}

#[must_use]
pub fn parse_level_dat_bytes(raw: &[u8]) -> Option<LevelDatMeta> {
    let decompressed: Vec<u8>;
    let payload: &[u8] = if raw.get(..2) == Some(&[0x1f, 0x8b]) {
        let mut decoder = GzDecoder::new(raw).take(MAX_DECOMPRESSED_NBT_BYTES + 1);
        let mut out = Vec::new();
        decoder.read_to_end(&mut out).ok()?;
        if out.len() as u64 > MAX_DECOMPRESSED_NBT_BYTES {
            return None;
        }
        decompressed = out;
        &decompressed
    } else {
        if raw.len() as u64 > MAX_DECOMPRESSED_NBT_BYTES {
            return None;
        }
        raw
    };

    let mut cursor = NbtCursor::new(payload);
    let root_type = cursor.read_u8()?;
    if root_type != TAG_COMPOUND {
        return None;
    }
    cursor.skip_string()?;

    loop {
        let tag_type = cursor.read_u8()?;
        if tag_type == TAG_END {
            return None;
        }
        let name = cursor.read_string()?;
        if name == "Data" && tag_type == TAG_COMPOUND {
            return parse_data_compound(&mut cursor, 1);
        }
        cursor.skip_payload(tag_type, 1)?;
    }
}

fn read_level_dat_file(path: &Path) -> Option<LevelDatMeta> {
    let file = File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.len() > MAX_DECOMPRESSED_NBT_BYTES {
        return None;
    }
    let mut raw = Vec::new();
    file.take(MAX_DECOMPRESSED_NBT_BYTES + 1)
        .read_to_end(&mut raw)
        .ok()?;
    parse_level_dat_bytes(&raw)
}

fn read_world_icon_data_url(world_dir: &Path) -> Option<String> {
    const PNG_MAGIC: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    let icon_path = world_dir.join("icon.png");
    let file = File::open(icon_path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_ICON_PNG_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_ICON_PNG_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_ICON_PNG_BYTES || bytes.get(..8) != Some(PNG_MAGIC.as_slice()) {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}

fn file_mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

#[must_use]
pub fn scan_recent_worlds_blocking(saves_dir: &Path) -> Vec<WorldSummary> {
    let Ok(read_dir) = std::fs::read_dir(saves_dir) else {
        return Vec::new();
    };

    struct CandidateWorld {
        folder_name: String,
        world_dir: PathBuf,
        level_dat_path: PathBuf,
        mtime_ms: u64,
    }

    let mut candidates = Vec::new();
    for entry in read_dir.flatten() {
        let world_dir = entry.path();
        if !world_dir.is_dir() {
            continue;
        }
        // Only treat subdirectories containing a real `level.dat` file as Minecraft worlds
        let level_dat_path = world_dir.join("level.dat");
        if !level_dat_path.is_file() {
            continue;
        }
        let level_mtime = file_mtime_ms(&level_dat_path);
        let dir_mtime = file_mtime_ms(&world_dir);
        let mtime_ms = level_mtime.max(dir_mtime);
        candidates.push(CandidateWorld {
            folder_name: entry.file_name().to_string_lossy().into_owned(),
            world_dir,
            level_dat_path,
            mtime_ms,
        });
    }

    // Bound NBT reads to the most recently modified valid world directories
    candidates.sort_by_key(|c| std::cmp::Reverse(c.mtime_ms));
    candidates.truncate(MAX_CANDIDATE_WORLDS);

    let mut parsed: Vec<(PathBuf, WorldSummary)> = candidates
        .into_iter()
        .map(|cand| {
            let meta = read_level_dat_file(&cand.level_dat_path).unwrap_or_default();
            let last_played_ms = meta.last_played_ms.unwrap_or(cand.mtime_ms);
            let level_name = meta.level_name.unwrap_or_else(|| cand.folder_name.clone());
            let summary = WorldSummary {
                folder_name: cand.folder_name,
                level_name,
                game_type: meta.game_type,
                hardcore: meta.hardcore,
                last_played_ms,
                last_modified_ms: last_played_ms,
                mc_version: meta.mc_version,
                seed: meta.seed,
                icon_data_url: None,
            };
            (cand.world_dir, summary)
        })
        .collect();

    parsed.sort_by_key(|(_, w)| std::cmp::Reverse(w.last_played_ms));
    parsed.truncate(MAX_RECENT_WORLDS);

    parsed
        .into_iter()
        .map(|(world_dir, mut summary)| {
            summary.icon_data_url = read_world_icon_data_url(&world_dir);
            summary
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::write::GzEncoder;
    use flate2::Compression;

    use super::{
        parse_level_dat_bytes, scan_recent_worlds_blocking, TAG_BYTE, TAG_BYTE_ARRAY, TAG_COMPOUND,
        TAG_END, TAG_INT, TAG_INT_ARRAY, TAG_LIST, TAG_LONG, TAG_LONG_ARRAY, TAG_STRING,
    };

    fn push_nbt_string(buf: &mut Vec<u8>, s: &str) {
        let len = s.len() as u16;
        buf.extend_from_slice(&len.to_be_bytes());
        buf.extend_from_slice(s.as_bytes());
    }

    fn push_tag_header(buf: &mut Vec<u8>, tag_type: u8, name: &str) {
        buf.push(tag_type);
        push_nbt_string(buf, name);
    }

    fn gzip_bytes(raw: &[u8]) -> Result<Vec<u8>, std::io::Error> {
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(raw)?;
        enc.finish()
    }

    fn build_modern_level_dat_nbt(
        level_name: &str,
        game_type: i32,
        hardcore: bool,
        last_played: i64,
        version_name: &str,
        seed: i64,
    ) -> Vec<u8> {
        let mut buf = Vec::new();
        // Root compound ""
        push_tag_header(&mut buf, TAG_COMPOUND, "");
        // Data compound
        push_tag_header(&mut buf, TAG_COMPOUND, "Data");

        // Place TAG_Byte_Array, TAG_Int_Array, TAG_Long_Array and empty TAG_List(0, 0) BEFORE target fields
        push_tag_header(&mut buf, TAG_BYTE_ARRAY, "PaddingBytes");
        buf.extend_from_slice(&3_i32.to_be_bytes());
        buf.extend_from_slice(&[0xAA, 0xBB, 0xCC]);

        push_tag_header(&mut buf, TAG_INT_ARRAY, "UUID");
        buf.extend_from_slice(&4_i32.to_be_bytes());
        for v in [1_i32, 2, 3, 4] {
            buf.extend_from_slice(&v.to_be_bytes());
        }

        push_tag_header(&mut buf, TAG_LONG_ARRAY, "PackedChunks");
        buf.extend_from_slice(&2_i32.to_be_bytes());
        for v in [0x0102_0304_0506_0708_i64, -999_999_999_i64] {
            buf.extend_from_slice(&v.to_be_bytes());
        }

        // Empty list with elem_type == TAG_END (0) and count == 0
        push_tag_header(&mut buf, TAG_LIST, "ScheduledEvents");
        buf.push(TAG_END);
        buf.extend_from_slice(&0_i32.to_be_bytes());

        // Non-empty list of strings
        push_tag_header(&mut buf, TAG_LIST, "ServerBrands");
        buf.push(TAG_STRING);
        buf.extend_from_slice(&2_i32.to_be_bytes());
        push_nbt_string(&mut buf, "vanilla");
        push_nbt_string(&mut buf, "fabric");

        push_tag_header(&mut buf, TAG_STRING, "LevelName");
        push_nbt_string(&mut buf, level_name);

        push_tag_header(&mut buf, TAG_INT, "GameType");
        buf.extend_from_slice(&game_type.to_be_bytes());

        push_tag_header(&mut buf, TAG_BYTE, "hardcore");
        buf.push(u8::from(hardcore));

        push_tag_header(&mut buf, TAG_LONG, "LastPlayed");
        buf.extend_from_slice(&last_played.to_be_bytes());

        // WorldGenSettings compound with nested tags + 64-bit seed
        push_tag_header(&mut buf, TAG_COMPOUND, "WorldGenSettings");
        push_tag_header(&mut buf, TAG_BYTE, "generate_features");
        buf.push(1);
        push_tag_header(&mut buf, TAG_LONG, "seed");
        buf.extend_from_slice(&seed.to_be_bytes());
        buf.push(TAG_END);

        // Version compound
        push_tag_header(&mut buf, TAG_COMPOUND, "Version");
        push_tag_header(&mut buf, TAG_INT, "Id");
        buf.extend_from_slice(&4189_i32.to_be_bytes());
        push_tag_header(&mut buf, TAG_STRING, "Name");
        push_nbt_string(&mut buf, version_name);
        buf.push(TAG_END);

        buf.push(TAG_END); // End Data
        buf.push(TAG_END); // End Root
        buf
    }

    #[test]
    fn test_parse_modern_gzip_level_dat_skips_all_arrays_and_preserves_i64_seed()
    -> Result<(), Box<dyn std::error::Error>> {
        let seed_64: i64 = -7_654_321_098_765_432_109;
        let raw = build_modern_level_dat_nbt(
            "Neo-Kyoto Base",
            0,
            true,
            1_732_000_123_456,
            "1.21.4",
            seed_64,
        );
        let gz = gzip_bytes(&raw)?;
        let parsed = parse_level_dat_bytes(&gz).ok_or("failed to parse modern level.dat")?;

        assert_eq!(parsed.level_name.as_deref(), Some("Neo-Kyoto Base"));
        assert_eq!(parsed.game_type.as_deref(), Some("survival"));
        assert!(parsed.hardcore);
        assert_eq!(parsed.last_played_ms, Some(1_732_000_123_456));
        assert_eq!(parsed.mc_version.as_deref(), Some("1.21.4"));
        assert_eq!(parsed.seed.as_deref(), Some("-7654321098765432109"));
        Ok(())
    }

    #[test]
    fn test_parse_legacy_random_seed_without_version() -> Result<(), Box<dyn std::error::Error>> {
        let mut buf = Vec::new();
        push_tag_header(&mut buf, TAG_COMPOUND, "");
        push_tag_header(&mut buf, TAG_COMPOUND, "Data");
        push_tag_header(&mut buf, TAG_STRING, "LevelName");
        push_nbt_string(&mut buf, "Classic 1.12");
        push_tag_header(&mut buf, TAG_INT, "GameType");
        buf.extend_from_slice(&1_i32.to_be_bytes());
        push_tag_header(&mut buf, TAG_LONG, "RandomSeed");
        buf.extend_from_slice(&424_242_424_242_i64.to_be_bytes());
        buf.push(TAG_END);
        buf.push(TAG_END);

        let gz = gzip_bytes(&buf)?;
        let parsed = parse_level_dat_bytes(&gz).ok_or("failed to parse legacy level.dat")?;

        assert_eq!(parsed.level_name.as_deref(), Some("Classic 1.12"));
        assert_eq!(parsed.game_type.as_deref(), Some("creative"));
        assert!(!parsed.hardcore);
        assert_eq!(parsed.mc_version, None);
        assert_eq!(parsed.seed.as_deref(), Some("424242424242"));
        Ok(())
    }

    #[test]
    fn test_truncated_or_corrupt_level_dat_never_panics() {
        assert_eq!(parse_level_dat_bytes(&[]), None);
        assert_eq!(parse_level_dat_bytes(&[0x1f, 0x8b, 0x08, 0x00]), None);
        assert_eq!(parse_level_dat_bytes(&[TAG_COMPOUND, 0x00, 0x05, b'a']), None);
    }

    #[test]
    fn test_scan_recent_worlds_ignores_dirs_without_level_dat_and_reads_icon()
    -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-worlds-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&tmp)?;

        // Invalid dir (no level.dat) must be ignored
        std::fs::create_dir_all(tmp.join("not-a-world"))?;

        // Valid world 1 (older)
        let w1 = tmp.join("world-old");
        std::fs::create_dir_all(&w1)?;
        let raw1 = build_modern_level_dat_nbt("Mundo Antiguo", 2, false, 1_700_000_000_000, "1.20.4", 123);
        std::fs::write(w1.join("level.dat"), gzip_bytes(&raw1)?)?;

        // Valid world 2 (newer) with valid PNG icon
        let w2 = tmp.join("world-new");
        std::fs::create_dir_all(&w2)?;
        let raw2 = build_modern_level_dat_nbt("Mundo Principal", 0, false, 1_735_000_000_000, "1.21.4", 987654321);
        std::fs::write(w2.join("level.dat"), gzip_bytes(&raw2)?)?;
        let fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x40\x00\x00\x00\x40";
        std::fs::write(w2.join("icon.png"), fake_png)?;

        let worlds = scan_recent_worlds_blocking(&tmp);
        assert_eq!(worlds.len(), 2);
        assert_eq!(worlds[0].folder_name, "world-new");
        assert_eq!(worlds[0].level_name, "Mundo Principal");
        assert_eq!(worlds[0].mc_version.as_deref(), Some("1.21.4"));
        assert!(worlds[0]
            .icon_data_url
            .as_deref()
            .is_some_and(|u| u.starts_with("data:image/png;base64,")));

        assert_eq!(worlds[1].folder_name, "world-old");
        assert_eq!(worlds[1].game_type.as_deref(), Some("adventure"));
        assert_eq!(worlds[1].icon_data_url, None);

        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }
}
