pub mod commands;
pub mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::lexicon::load_all_words,
            commands::lexicon::save_word,
            commands::lexicon::delete_word,
            commands::lexicon::count_words_all_languages,
            commands::phonology::load_phonology,
            commands::phonology::save_phonology,
            commands::grammar::load_grammar,
            commands::grammar::save_grammar,
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::workspace::create_language_dir,
            commands::workspace::create_new_project,
            commands::fork::fork_language,
            commands::fork::delete_language,
            commands::sca::load_sca,
            commands::sca::save_sca,
            commands::corpus::load_corpus_index,
            commands::corpus::load_corpus_text,
            commands::corpus::save_corpus_text,
            commands::corpus::delete_corpus_text,
            commands::export_import::export_workspace_bundle,
            commands::export_import::import_workspace_bundle,
            commands::export_import::write_text_file,
            commands::workspace::copy_project,
            commands::registry::load_registry,
            commands::registry::save_registry,
            commands::registry::register_family,
            commands::registry::unregister_family,
            commands::registry::set_active_family,
            commands::registry::validate_conlang_file,
            commands::oplog::load_operation_log,
            commands::oplog::create_snapshot,
            commands::oplog::rollback_to_snapshot,
            commands::oplog::set_max_snapshots,
            commands::workspace::show_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
