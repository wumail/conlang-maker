use std::path::PathBuf;

use conlang_maker_lib::commands::{
    corpus::{load_corpus_index_with_revision, load_corpus_text_with_revision},
    font::{inspect_language_font, list_language_fonts},
    fork::copy_dir_recursive,
    grammar::load_grammar_with_revision,
    lexicon::load_all_words_with_revision,
    oplog::list_all_snapshots,
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

#[test]
fn t0_3_synthetic_fixture_workspace_and_fonts_load_cleanly() {
    let root = repo_root();
    let src_fixture = root.join("tests/fixtures/workspace-basic");
    assert!(src_fixture.is_dir(), "workspace-basic fixture must exist");

    for font_name in ["liga-test.ttf", "no-names-test.ttf"] {
        let font_path = root.join("tests/fixtures/fonts").join(font_name);
        let bytes = std::fs::read(&font_path).expect("read fixture font");
        let face = ttf_parser::Face::parse(&bytes, 0).expect("valid ttf-parser face");
        assert!(face.number_of_glyphs() >= 6);
    }

    let tmp = tempfile::tempdir().expect("tempdir");
    let proj_dir = tmp.path().join("workspace-basic");
    copy_dir_recursive(&src_fixture, &proj_dir).expect("copy fixture to tempdir");

    let proj_str = proj_dir.to_string_lossy().into_owned();
    let ws_file = proj_dir.join("workspace.conlang");
    let ws_str = ws_file.to_string_lossy().into_owned();

    let ws_res = load_workspace_with_revision(ws_str.clone()).expect("load workspace");
    assert_eq!(ws_res.config.languages.len(), 4);
    assert_eq!(ws_res.revision.len(), 16);
    assert!(ws_res
        .config
        .extra
        .contains_key("x_unknown_workspace_sentinel"));

    // Font inheritance matrix:
    // - lang_root: own font
    // - lang_child: inherits from lang_root
    // - lang_leaf: own font overrides ancestor
    // - lang_other: no font anywhere in chain
    let font_statuses = list_language_fonts(proj_str.clone(), ws_str.clone()).expect("list fonts");
    assert_eq!(font_statuses.len(), 4);

    let root_font = inspect_language_font(
        proj_str.clone(),
        ws_str.clone(),
        "lang_root".to_string(),
    )
    .expect("inspect root font");
    assert!(root_font.present && root_font.has_own && !root_font.inherited);

    let child_font = inspect_language_font(
        proj_str.clone(),
        ws_str.clone(),
        "lang_child".to_string(),
    )
    .expect("inspect child font");
    assert!(child_font.present && !child_font.has_own && child_font.inherited);
    assert_eq!(child_font.owner_language_id.as_deref(), Some("lang_root"));

    let leaf_font = inspect_language_font(
        proj_str.clone(),
        ws_str.clone(),
        "lang_leaf".to_string(),
    )
    .expect("inspect leaf font");
    assert!(leaf_font.present && leaf_font.has_own && !leaf_font.inherited);
    assert_eq!(leaf_font.owner_language_id.as_deref(), Some("lang_leaf"));

    let other_font = inspect_language_font(
        proj_str.clone(),
        ws_str.clone(),
        "lang_other".to_string(),
    )
    .expect("inspect other font");
    assert!(!other_font.present && !other_font.has_own && !other_font.inherited);

    // Load phonology, legacy writing inspection, lexicon, grammar, sca, corpus across all 4 languages
    for lang in &ws_res.config.languages {
        let phono = load_phonology(proj_str.clone(), lang.path.clone()).expect("load phonology");
        assert_eq!(
            phono.local_config.as_ref().expect("local_config").language_id,
            lang.language_id
        );

        let legacy =
            inspect_legacy_writing(proj_str.clone(), lang.path.clone()).expect("inspect legacy");
        if lang.language_id == "lang_child" {
            assert!(legacy.present, "lang_child has legacy writing_systems fixture");
        }

        let lex =
            load_all_words_with_revision(proj_str.clone(), lang.path.clone()).expect("load words");
        if lang.language_id == "lang_child" {
            assert!(
                !lex.skipped.is_empty(),
                "lang_child fixture intentionally exercises skipped/malformed NDJSON reporting"
            );
        }

        let gram =
            load_grammar_with_revision(proj_str.clone(), lang.path.clone()).expect("load grammar");
        assert_eq!(gram.config.language_id, lang.language_id);

        let sca = load_sca_with_revision(proj_str.clone(), lang.path.clone()).expect("load sca");
        assert_eq!(sca.config.language_id, lang.language_id);

        let cidx = load_corpus_index_with_revision(proj_str.clone(), lang.path.clone())
            .expect("load corpus index");
        if lang.language_id == "lang_leaf" {
            assert!(!cidx.entries.is_empty());
            let ctext = load_corpus_text_with_revision(
                proj_str.clone(),
                lang.path.clone(),
                "corp_leaf_1".to_string(),
            )
            .expect("load leaf corpus text");
            assert_eq!(ctext.corpus.corpus_id, "corp_leaf_1");
        }
    }

    // Legacy manifest-less snapshot in stages/child/.oplog
    let snaps = list_all_snapshots(proj_str, Some(ws_str), Some("lang_child".to_string()))
        .expect("list child snapshots");
    assert!(
        snaps.iter().any(|s| s.snapshot_id == "legacy_001" && s.scope == "lexicon"),
        "expected legacy_001 manifest-less snapshot to be listed as lexicon scope"
    );
}
