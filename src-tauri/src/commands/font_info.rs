#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontFaceInfo {
    pub family_name: Option<String>,
    pub version: Option<String>,
    pub codepoints: Vec<u32>,
    /// Codepoints that draw the same glyph, one group per glyph.
    pub glyphs: Vec<Vec<u32>>,
}

pub fn inspect_font_bytes(data: &[u8]) -> Result<FontFaceInfo, String> {
    let tables = font_tables(data)?;
    let cmap = tables
        .iter()
        .find(|table| table.tag == *b"cmap")
        .ok_or_else(|| "Font has no character map".to_string())?;
    let name = tables.iter().find(|table| table.tag == *b"name");
    let (family_name, version) = name
        .map(|table| read_names(data, table))
        .unwrap_or((None, None));
    let mapped = read_cmap(data, cmap)?;
    Ok(FontFaceInfo {
        family_name,
        version,
        codepoints: mapped.codepoints,
        glyphs: mapped.glyphs,
    })
}

struct MappedChars {
    codepoints: Vec<u32>,
    glyphs: Vec<Vec<u32>>,
}

fn finish_map(mut pairs: Vec<(u32, u32)>) -> MappedChars {
    pairs.retain(|(code, glyph)| *glyph != 0 && *code != 0xFFFF);
    pairs.sort_unstable();
    pairs.dedup();
    let mut by_glyph: std::collections::BTreeMap<u32, Vec<u32>> = std::collections::BTreeMap::new();
    for (code, glyph) in pairs {
        by_glyph.entry(glyph).or_default().push(code);
    }
    let mut glyphs: Vec<Vec<u32>> = by_glyph.into_values().collect();
    for group in &mut glyphs {
        group.sort_unstable();
        group.dedup();
    }
    glyphs.sort_by_key(|group| group[0]);
    let mut codepoints: Vec<u32> = glyphs.iter().flatten().copied().collect();
    codepoints.sort_unstable();
    MappedChars { codepoints, glyphs }
}

struct TaggedTable {
    tag: [u8; 4],
    offset: usize,
    length: usize,
}

fn font_tables(data: &[u8]) -> Result<Vec<TaggedTable>, String> {
    if data.len() < 12 {
        return Err("Font file is truncated".to_string());
    }
    let num_tables = read_u16(data, 4)? as usize;
    let mut tables = Vec::with_capacity(num_tables);
    for index in 0..num_tables {
        let pos = 12 + index * 16;
        if pos + 16 > data.len() {
            return Err("Font table directory is truncated".to_string());
        }
        let mut tag = [0; 4];
        tag.copy_from_slice(&data[pos..pos + 4]);
        let offset = read_u32(data, pos + 8)? as usize;
        let length = read_u32(data, pos + 12)? as usize;
        if offset.saturating_add(length) > data.len() {
            return Err(format!(
                "Font table {} is outside the file",
                String::from_utf8_lossy(&tag)
            ));
        }
        tables.push(TaggedTable { tag, offset, length });
    }
    Ok(tables)
}

fn read_cmap(data: &[u8], table: &TaggedTable) -> Result<MappedChars, String> {
    let base = table.offset;
    if table.length < 4 {
        return Err("Character map is truncated".to_string());
    }
    let num_tables = read_u16(data, base + 2)? as usize;
    let mut best: Option<(u8, MappedChars)> = None;
    for index in 0..num_tables {
        let rec = base + 4 + index * 8;
        if rec + 8 > base + table.length {
            return Err("Character map records are truncated".to_string());
        }
        let platform = read_u16(data, rec)?;
        let encoding = read_u16(data, rec + 2)?;
        let sub_off = read_u32(data, rec + 4)? as usize;
        let sub = base + sub_off;
        if sub + 2 > data.len() {
            continue;
        }
        let format = read_u16(data, sub)?;
        let score = cmap_score(platform, encoding, format);
        if score == 0 {
            continue;
        }
        let mapped = match format {
            0 => parse_format0(data, sub)?,
            4 => parse_format4(data, sub)?,
            6 => parse_format6(data, sub)?,
            12 | 13 => parse_format12(data, sub)?,
            _ => continue,
        };
        let replace = match &best {
            None => true,
            Some((best_score, best_map)) => {
                score > *best_score
                    || (score == *best_score && mapped.codepoints.len() > best_map.codepoints.len())
            }
        };
        if replace {
            best = Some((score, mapped));
        }
    }
    best.map(|(_, mapped)| mapped)
        .ok_or_else(|| "Font has no Unicode character map".to_string())
}

fn cmap_score(platform: u16, encoding: u16, format: u16) -> u8 {
    let unicode = platform == 0 || (platform == 3 && (encoding == 1 || encoding == 10));
    if !unicode {
        return 0;
    }
    match format {
        12 | 13 => 3,
        4 => 2,
        6 | 0 => 1,
        _ => 0,
    }
}

fn parse_format4(data: &[u8], sub: usize) -> Result<MappedChars, String> {
    let length = read_u16(data, sub + 2)? as usize;
    if length < 16 || sub + length > data.len() {
        return Err("Format 4 character map is truncated".to_string());
    }
    let seg_count = (read_u16(data, sub + 6)? / 2) as usize;
    let end_pos = sub + 14;
    let start_pos = end_pos + seg_count * 2 + 2;
    let delta_pos = start_pos + seg_count * 2;
    let offset_pos = delta_pos + seg_count * 2;
    if offset_pos + seg_count * 2 > sub + length {
        return Err("Format 4 character map is truncated".to_string());
    }
    let mut out = Vec::new();
    for index in 0..seg_count {
        let end = read_u16(data, end_pos + index * 2)? as u32;
        let start = read_u16(data, start_pos + index * 2)? as u32;
        if start == 0xFFFF && end == 0xFFFF {
            continue;
        }
        if start > end {
            continue;
        }
        if end - start > 100_000 {
            return Err("Character map segment is too large".to_string());
        }
        let delta = read_i16(data, delta_pos + index * 2)? as i32;
        let range_offset = read_u16(data, offset_pos + index * 2)? as usize;
        let mut code = start;
        while code <= end {
            let glyph = if range_offset == 0 {
                (code as i32 + delta) as u16
            } else {
                let glyph_pos = offset_pos + index * 2 + range_offset + (code - start) as usize * 2;
                let glyph_id = read_u16(data, glyph_pos)? as i32;
                if glyph_id == 0 {
                    0
                } else {
                    (glyph_id + delta) as u16
                }
            };
            if glyph != 0 && code != 0xFFFF {
                out.push((code, glyph as u32));
            }
            if code == end {
                break;
            }
            code += 1;
        }
    }
    Ok(finish_map(out))
}

fn parse_format12(data: &[u8], sub: usize) -> Result<MappedChars, String> {
    let length = read_u32(data, sub + 4)? as usize;
    if length < 16 || sub + length > data.len() {
        return Err("Format 12 character map is truncated".to_string());
    }
    let groups = read_u32(data, sub + 12)? as usize;
    let mut pos = sub + 16;
    let mut out = Vec::new();
    for _ in 0..groups {
        let start = read_u32(data, pos)?;
        let end = read_u32(data, pos + 4)?;
        let mut glyph = read_u32(data, pos + 8)?;
        pos += 12;
        if start > end {
            continue;
        }
        if end - start > 100_000 {
            return Err("Character map group is too large".to_string());
        }
        let mut code = start;
        while code <= end {
            if glyph != 0 {
                out.push((code, glyph));
            }
            if code == end {
                break;
            }
            code += 1;
            glyph = glyph.wrapping_add(1);
        }
    }
    Ok(finish_map(out))
}

fn parse_format6(data: &[u8], sub: usize) -> Result<MappedChars, String> {
    let length = read_u16(data, sub + 2)? as usize;
    if sub + length > data.len() {
        return Err("Format 6 character map is truncated".to_string());
    }
    let first = read_u16(data, sub + 6)? as u32;
    let count = read_u16(data, sub + 8)? as u32;
    let mut out = Vec::new();
    for index in 0..count {
        let glyph = read_u16(data, sub + 10 + index as usize * 2)?;
        if glyph != 0 {
            out.push((first + index, glyph as u32));
        }
    }
    Ok(finish_map(out))
}

fn parse_format0(data: &[u8], sub: usize) -> Result<MappedChars, String> {
    if sub + 6 + 256 > data.len() {
        return Err("Byte character map is truncated".to_string());
    }
    let mut out = Vec::new();
    for code in 0..256 {
        let glyph = data[sub + 6 + code] as u32;
        if glyph != 0 {
            out.push((code as u32, glyph));
        }
    }
    Ok(finish_map(out))
}

struct NameHit {
    score: i32,
    text: String,
}

fn read_names(data: &[u8], table: &TaggedTable) -> (Option<String>, Option<String>) {
    let base = table.offset;
    if table.length < 6 {
        return (None, None);
    }
    let count = read_u16(data, base + 2).unwrap_or(0) as usize;
    let string_offset = read_u16(data, base + 4).unwrap_or(0) as usize;
    let mut family_16: Option<NameHit> = None;
    let mut family_1: Option<NameHit> = None;
    let mut version: Option<NameHit> = None;
    for index in 0..count {
        let rec = base + 6 + index * 12;
        if rec + 12 > base + table.length {
            break;
        }
        let platform = read_u16(data, rec).unwrap_or(0);
        let language = read_u16(data, rec + 4).unwrap_or(0);
        let name_id = read_u16(data, rec + 6).unwrap_or(0);
        let length = read_u16(data, rec + 8).unwrap_or(0) as usize;
        let offset = read_u16(data, rec + 10).unwrap_or(0) as usize;
        let start = base + string_offset + offset;
        if start + length > data.len() {
            continue;
        }
        let Some(text) = decode_name(platform, &data[start..start + length]) else {
            continue;
        };
        let score = match (platform, language) {
            (3, 0x409) => 3,
            (3, _) => 2,
            (0, _) => 1,
            _ => 0,
        };
        let hit = NameHit { score, text };
        let slot = match name_id {
            16 => &mut family_16,
            1 => &mut family_1,
            5 => &mut version,
            _ => continue,
        };
        if slot.as_ref().map(|item| item.score).unwrap_or(-1) < score {
            *slot = Some(hit);
        }
    }
    let family = family_16.or(family_1).map(|item| item.text);
    (family, version.map(|item| item.text))
}

fn decode_name(platform: u16, bytes: &[u8]) -> Option<String> {
    let text = if platform == 0 || platform == 3 {
        if bytes.len() % 2 != 0 {
            return None;
        }
        let units: Vec<u16> = bytes
            .chunks(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16(&units).ok()?
    } else {
        bytes.iter().map(|byte| *byte as char).collect()
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16, String> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or_else(|| "Unexpected end of font".to_string())?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn read_i16(data: &[u8], offset: usize) -> Result<i16, String> {
    Ok(read_u16(data, offset)? as i16)
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, String> {
    let bytes = data
        .get(offset..offset + 4)
        .ok_or_else(|| "Unexpected end of font".to_string())?;
    Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn be16(value: u16) -> [u8; 2] {
        value.to_be_bytes()
    }

    fn utf16_be(text: &str) -> Vec<u8> {
        text.encode_utf16()
            .flat_map(|unit| unit.to_be_bytes())
            .collect()
    }

    fn format4_abc() -> Vec<u8> {
        let mut cmap = vec![0, 0, 0, 1];
        cmap.extend_from_slice(&be16(3));
        cmap.extend_from_slice(&be16(1));
        cmap.extend_from_slice(&12u32.to_be_bytes());
        let mut sub = Vec::new();
        sub.extend_from_slice(&be16(4));
        sub.extend_from_slice(&be16(32));
        sub.extend_from_slice(&be16(0));
        sub.extend_from_slice(&be16(4));
        sub.extend_from_slice(&be16(0));
        sub.extend_from_slice(&be16(0));
        sub.extend_from_slice(&be16(0));
        sub.extend_from_slice(&be16(0x0043));
        sub.extend_from_slice(&be16(0xFFFF));
        sub.extend_from_slice(&be16(0));
        sub.extend_from_slice(&be16(0x0041));
        sub.extend_from_slice(&be16(0xFFFF));
        sub.extend_from_slice(&(-0x40i16).to_be_bytes());
        sub.extend_from_slice(&be16(0));
        sub.extend_from_slice(&be16(0));
        sub.extend_from_slice(&be16(0));
        cmap.extend_from_slice(&sub);
        cmap
    }

    fn name_table() -> Vec<u8> {
        let family = utf16_be("Lamitic");
        let version = utf16_be("Version 1");
        let mut name = vec![0, 0, 0, 2];
        let string_offset = 6 + 24;
        name.extend_from_slice(&be16(string_offset as u16));
        for (name_id, offset, length) in [
            (1u16, 0u16, family.len() as u16),
            (5, family.len() as u16, version.len() as u16),
        ] {
            name.extend_from_slice(&be16(3));
            name.extend_from_slice(&be16(1));
            name.extend_from_slice(&be16(0x409));
            name.extend_from_slice(&be16(name_id));
            name.extend_from_slice(&be16(length));
            name.extend_from_slice(&be16(offset));
        }
        name.extend_from_slice(&family);
        name.extend_from_slice(&version);
        name
    }

    fn wrap_font(cmap: &[u8], name: &[u8]) -> Vec<u8> {
        let mut data = vec![0u8; 12 + 32];
        data[5] = 2;
        let cmap_at = data.len();
        data.extend_from_slice(cmap);
        let name_at = data.len();
        data.extend_from_slice(name);
        let write = |data: &mut [u8], index: usize, tag: &[u8; 4], offset: usize, length: usize| {
            let pos = 12 + index * 16;
            data[pos..pos + 4].copy_from_slice(tag);
            data[pos + 8..pos + 12].copy_from_slice(&(offset as u32).to_be_bytes());
            data[pos + 12..pos + 16].copy_from_slice(&(length as u32).to_be_bytes());
        };
        write(&mut data, 0, b"cmap", cmap_at, cmap.len());
        write(&mut data, 1, b"name", name_at, name.len());
        data
    }

    #[test]
    fn reads_family_name_and_mapped_letters() {
        let info = inspect_font_bytes(&wrap_font(&format4_abc(), &name_table())).unwrap();
        assert_eq!(info.family_name.as_deref(), Some("Lamitic"));
        assert_eq!(info.version.as_deref(), Some("Version 1"));
        assert_eq!(info.codepoints, vec![0x41, 0x42, 0x43]);
        assert_eq!(info.glyphs, vec![vec![0x41], vec![0x42], vec![0x43]]);
    }

    #[test]
    fn fixture_font_lists_its_encoded_characters() {
        let info = inspect_font_bytes(include_bytes!("../../tests/fixtures/regular.ttf")).unwrap();
        assert_eq!(info.family_name.as_deref(), Some("Conlang Test"));
        assert_eq!(info.version.as_deref(), Some("Version 1.0"));
        assert_eq!(info.codepoints, vec![0x20, 0x61]);
        assert_eq!(info.glyphs, vec![vec![0x20], vec![0x61]]);
    }
}
