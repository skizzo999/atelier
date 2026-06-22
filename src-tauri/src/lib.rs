use tauri_plugin_fs::FsExt;

// Concede l'accesso in lettura alla cartella scelta dall'utente e a tutto il suo
// sottoalbero. Necessario perché il dialog autorizza solo il path selezionato,
// non le sottocartelle: senza questo, readDir sui figli fallisce con "forbidden path".
#[tauri::command]
fn allow_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![allow_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
