pub mod commands;
pub mod models;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // Lexicon
            commands::lexicon::load_all_words,
            commands::lexicon::load_all_words_with_revision,
            commands::lexicon::save_word,
            commands::lexicon::save_words_batch,
            commands::lexicon::delete_word,
            commands::lexicon::delete_words_batch,
            commands::lexicon::count_words_all_languages,
            // Phonology & Legacy Writing
            commands::phonology::load_phonology,
            commands::phonology::save_phonology,
            commands::phonology::inspect_legacy_writing,
            // Grammar
            commands::grammar::load_grammar,
            commands::grammar::load_grammar_with_revision,
            commands::grammar::save_grammar,
            // Workspace
            commands::workspace::load_workspace,
            commands::workspace::load_workspace_with_revision,
            commands::workspace::save_workspace,
            commands::workspace::create_language_dir,
            commands::workspace::create_new_project,
            commands::workspace::copy_project,
            commands::workspace::show_in_folder,
            // Fork, Trash & Link Migration
            commands::fork::fork_language,
            commands::fork::delete_language,
            commands::fork::list_language_trash,
            commands::fork::restore_language,
            commands::fork::migrate_inherited_lexicon_links,
            // SCA
            commands::sca::load_sca,
            commands::sca::load_sca_with_revision,
            commands::sca::save_sca,
            // Corpus
            commands::corpus::load_corpus_index,
            commands::corpus::load_corpus_index_with_revision,
            commands::corpus::load_corpus_text,
            commands::corpus::load_corpus_text_with_revision,
            commands::corpus::save_corpus_text,
            commands::corpus::delete_corpus_text,
            // Export / Import
            commands::export_import::export_workspace_bundle,
            commands::export_import::import_workspace_bundle,
            commands::export_import::write_text_file,
            commands::export_import::save_text_file_atomic,
            // Global Registry
            commands::registry::load_registry,
            commands::registry::load_registry_with_revision,
            commands::registry::save_registry,
            commands::registry::register_family,
            commands::registry::unregister_family,
            commands::registry::set_active_family,
            commands::registry::validate_conlang_file,
            // Operation Log & Language/Project Snapshots
            commands::oplog::load_operation_log,
            commands::oplog::create_snapshot,
            commands::oplog::rollback_to_snapshot,
            commands::oplog::set_max_snapshots,
            commands::oplog::create_project_snapshot,
            commands::oplog::list_all_snapshots,
            commands::oplog::preview_snapshot_rollback,
            commands::oplog::rollback_any_snapshot,
            // Native Dialogs
            commands::dialog::pick_file_path_macos,
            commands::dialog::pick_directory_path_macos,
            commands::dialog::pick_save_file_path_macos,
            // Fonts
            commands::font::list_language_fonts,
            commands::font::read_resolved_font,
            commands::font::import_language_font,
            commands::font::read_font_candidate,
            commands::font::import_checked_language_font,
            commands::font::clear_language_font,
            commands::font::inspect_language_font,
            // Watcher (T3.8)
            commands::watcher::watch_project,
            commands::watcher::unwatch_project,
            // MCP Sidecar & Audit Logs (T5.2)
            commands::mcp::get_mcp_binary_path,
            commands::mcp::get_mcp_audit_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
