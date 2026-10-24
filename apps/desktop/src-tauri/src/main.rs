// Evita la console su Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    promptops_oss_lib::run()
}
