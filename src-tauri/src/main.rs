// Prevents additional console window on Windows in release, not on macOS
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    chorus_lib::run();
}
