use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use conlang_maker_lib::commands::{
    corpus::{load_corpus_index_with_revision, load_corpus_text_with_revision},
    font::{inspect_language_font, list_language_fonts},
    fork::copy_dir_recursive,
    grammar::load_grammar_with_revision,
    lexicon::load_all_words_with_revision,
    phonology::{inspect_legacy_writing, load_phonology},
    sca::load_sca_with_revision,
    workspace::load_workspace_with_revision,
};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn canonicalize_value(val: Value) -> Value {
    match val {
        Value::Object(map) => {
            let mut sorted: BTreeMap<String, Value> = BTreeMap::new();
            for (k, v) in map {
                sorted.insert(k, canonicalize_value(v));
            }
            let mut out = serde_json::Map::new();
            for (k, v) in sorted {
                out.insert(k, v);
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(canonicalize_value).collect()),
        other => other,
    }
}

fn check_or_update_golden<T: Serialize>(golden_dir: &Path, file_name: &str, actual: &T) {
    let raw = serde_json::to_value(actual).expect("serialize actual");
    let canonical = canonicalize_value(raw);
    let formatted = serde_json::to_string_pretty(&canonical).expect("pretty json") + "\n";
    let target = golden_dir.join(file_name);

    let update = std::env::var("UPDATE_GOLDEN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if update {
        fs::create_dir_all(golden_dir).expect("create golden dir");
        fs::write(&target, &formatted).expect("write golden file");
    } else {
        let expected_raw = fs::read_to_string(&target).unwrap_or_else(|e| {
            panic!(
                "Missing golden file {} ({e}). Run with UPDATE_GOLDEN=1 to generate.",
                target.display()
            )
        });
        let expected_val: Value =
            serde_json::from_str(&expected_raw).expect("parse expected golden json");
        let expected_canonical = canonicalize_value(expected_val);
        assert_eq!(
            canonical, expected_canonical,
            "Golden mismatch in {}",
            file_name
        );
    }
}

#[test]
fn t1_12_rust_read_layer_golden_conformance() {
    let root = repo_root();
    let src_fixture = root.join("tests/fixtures/workspace-basic");
    let golden_dir = root.join("tests/golden");

    let tmp = tempfile::tempdir().expect("tempdir");
    let proj_dir = tmp.path().join("workspace-basic");
    copy_dir_recursive(&src_fixture, &proj_dir).expect("copy fixture");

    let proj_str = proj_dir.to_string_lossy().into_owned();
    let ws_str = proj_dir
        .join("workspace.conlang")
        .to_string_lossy()
        .into_owned();

    let ws_res = load_workspace_with_revision(ws_str.clone()).expect("load workspace");
    check_or_update_golden(&golden_dir, "workspace.json", &ws_res);

    let fonts_list = list_language_fonts(proj_str.clone(), ws_str.clone()).expect("list fonts");
    check_or_update_golden(&golden_dir, "fonts_list.json", &fonts_list);

    for lang in &ws_res.config.languages {
        let id = &lang.language_id;

        let phono = load_phonology(proj_str.clone(), lang.path.clone()).expect("load phonology");
        check_or_update_golden(&golden_dir, &format!("phonology_{id}.json"), &phono);

        let legacy =
            inspect_legacy_writing(proj_str.clone(), lang.path.clone()).expect("inspect legacy");
        check_or_update_golden(&golden_dir, &format!("legacy_writing_{id}.json"), &legacy);

        let lex =
            load_all_words_with_revision(proj_str.clone(), lang.path.clone()).expect("load words");
        check_or_update_golden(&golden_dir, &format!("lexicon_{id}.json"), &lex);

        let gram =
            load_grammar_with_revision(proj_str.clone(), lang.path.clone()).expect("load grammar");
        check_or_update_golden(&golden_dir, &format!("grammar_{id}.json"), &gram);

        let sca = load_sca_with_revision(proj_str.clone(), lang.path.clone()).expect("load sca");
        check_or_update_golden(&golden_dir, &format!("sca_{id}.json"), &sca);

        let cidx = load_corpus_index_with_revision(proj_str.clone(), lang.path.clone())
            .expect("load corpus index");
        check_or_update_golden(&golden_dir, &format!("corpus_index_{id}.json"), &cidx);

        for entry in &cidx.entries {
            let ctext = load_corpus_text_with_revision(
                proj_str.clone(),
                lang.path.clone(),
                entry.corpus_id.clone(),
            )
            .expect("load corpus text");
            check_or_update_golden(
                &golden_dir,
                &format!("corpus_text_{id}_{}.json", entry.corpus_id),
                &ctext,
            );
        }

        let finspect =
            inspect_language_font(proj_str.clone(), ws_str.clone(), id.clone()).expect("inspect");
        check_or_update_golden(&golden_dir, &format!("font_inspect_{id}.json"), &finspect);
    }
}

