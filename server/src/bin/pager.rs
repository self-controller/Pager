//! `pager [file]`: Pager's command line.

use pager_server::cli::{run_cli, SystemDeps};

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let code = run_cli(&argv, &mut SystemDeps);
    std::process::exit(code);
}
