use tauri_plugin_fs::FsExt;

// Concede l'accesso in lettura alla cartella scelta dall'utente e a tutto il suo
// sottoalbero. Necessario perché il dialog autorizza solo il path selezionato,
// non le sottocartelle: senza questo, readDir sui figli fallisce con "forbidden path".
#[tauri::command]
fn allow_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    // Stesso permesso al protocollo asset: serve all'anteprima HTML, che
    // carica il file vero in un iframe (così CSS, script e immagini con
    // percorso relativo si risolvono da soli come in un browser).
    use tauri::Manager;
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    // ...e nella forma con le barre in avanti. L'anteprima costruisce un URL
    // con i separatori VERI (senza, tutto il percorso diventa un unico pezzo
    // di indirizzo e i riferimenti relativi si perdono): il controllo dello
    // scope confronta il percorso così com'è scritto nell'URL, quindi deve
    // essere autorizzata anche questa forma.
    let forward = path.replace('\\', "/");
    if forward != path {
        app.asset_protocol_scope()
            .allow_directory(&forward, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Un comando invocabile dalla webview non deve accettare path arbitrari:
// accettiamo solo percorsi dentro lo scope fs concesso (il vault aperto).
fn ensure_in_scope(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    if app.fs_scope().is_allowed(std::path::Path::new(path)) {
        Ok(())
    } else {
        Err("Percorso fuori dallo scope consentito".into())
    }
}

// Sposta un file/cartella nel Cestino di Windows (recuperabile), al posto
// dell'eliminazione definitiva.
#[tauri::command]
fn trash_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    ensure_in_scope(&app, &path)?;
    trash::delete(&path).map_err(|e| e.to_string())
}

// Imposta l'attributo "nascosto" su un file (Windows). Usato per i backup .bak,
// così non ingombrano Esplora risorse pur restando come rete di sicurezza.
#[tauri::command]
fn set_hidden(app: tauri::AppHandle, path: String) -> Result<(), String> {
    ensure_in_scope(&app, &path)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000; // niente finestra console lampeggiante
        Command::new("attrib")
            .args(["+h", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

// Un file del vault, come lo vuole il frontend.
#[derive(serde::Serialize)]
struct VaultFile {
    path: String,
    name: String,
    rel: String,
}

// Stesse esclusioni del FileTree e della ricerca: file di servizio, backup,
// cartelle nascoste e node_modules restano fuori.
fn skip_entry(name: &str) -> bool {
    name.starts_with('.')
        || name == "node_modules"
        || name.ends_with(".tmp")
        || name.ends_with(".bak")
        || name.ends_with(".atelier")
}

// Elenca TUTTI i file del vault in UNA sola chiamata. Farlo dal frontend
// costava una chiamata per cartella (centinaia, in fila): su un vault vero
// erano secondi all'avvio e a ogni modifica su disco.
#[tauri::command]
fn list_vault_files(app: tauri::AppHandle, root: String) -> Result<Vec<VaultFile>, String> {
    ensure_in_scope(&app, &root)?;
    let root_path = std::path::Path::new(&root);
    let mut out = Vec::new();
    // Pila esplicita invece della ricorsione: niente stack overflow su alberi
    // patologici. Il tetto è la rete di sicurezza contro i cicli da symlink.
    let mut stack = vec![(root_path.to_path_buf(), 0u32)];
    const MAX_DEPTH: u32 = 64;
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // cartella illeggibile: la saltiamo, non è un errore fatale
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if skip_entry(&name) {
                continue;
            }
            let full = entry.path();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let is_link = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
            if is_dir {
                if !is_link {
                    stack.push((full, depth + 1));
                }
            } else {
                let path_s = full.to_string_lossy().to_string();
                let rel = path_s
                    .strip_prefix(&root)
                    .map(|r| r.trim_start_matches(|c| c == '\\' || c == '/').to_string())
                    .unwrap_or_else(|| name.clone());
                out.push(VaultFile { path: path_s, name, rel });
            }
        }
    }
    Ok(out)
}

// File passato all'avvio da "Apri con" (o trascinato sull'eseguibile):
// Windows lo mette fra gli argomenti della riga di comando. Restituiamo il
// primo argomento che è davvero un file esistente, così i flag non contano.
// Il frontend lo chiede al boot e lo apre.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1) // il primo è il percorso dell'eseguibile
        .filter(|a| !a.starts_with('-'))
        .map(std::path::PathBuf::from)
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // Esecuzione comandi: alimenta il terminale e il pannello Git della
        // modalità Developer (interpreti consentiti nello scope della capability).
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            allow_path,
            set_hidden,
            trash_path,
            list_vault_files,
            startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
