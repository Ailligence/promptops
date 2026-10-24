//! Diagnostic output must not abort the desktop when its launcher's stderr
//! pipe/terminal disappears. This intentionally shadows std::eprintln! within
//! this crate, including commands invoked on the native UI thread.
//! Formatting panics are not caught; only output I/O errors are discarded.

macro_rules! eprintln {
    () => { eprintln!("") };
    ($($arg:tt)*) => {{
        use std::io::Write as _;
        let message = format!($($arg)*);
        let _ = writeln!(std::io::stderr().lock(), "{}", message);
        crate::diagnostics::observe_log(&message, concat!(file!(), ":", line!(), ":", column!()));
    }};
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::fd::OwnedFd;
    use std::os::unix::net::UnixStream;
    use std::process::{Command, Stdio};

    fn child() -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "logging::tests::emit_diagnostics", "--nocapture"])
            .env("PROMPTOPS_LOGGING_TEST_CHILD", "1");
        command
    }

    #[test]
    fn emit_diagnostics() {
        if std::env::var_os("PROMPTOPS_LOGGING_TEST_CHILD").is_none() {
            return;
        }
        let parent = "standalone";
        eprintln!("[subagent_list] parent {parent} -> {} agent(s)", 0);
        eprintln!();
        std::thread::spawn(|| eprintln!("[session] background diagnostic"))
            .join()
            .unwrap();
    }

    #[test]
    fn preserves_diagnostics_when_stderr_is_writable() {
        let output = child().output().unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stderr).unwrap(),
            "[subagent_list] parent standalone -> 0 agent(s)\n\n[session] background diagnostic\n"
        );
    }

    #[test]
    fn survives_disconnected_stderr() {
        // Use a child process so the test runner's own stderr is never changed.
        let (writer, reader) = UnixStream::pair().unwrap();
        drop(reader);
        let fd: OwnedFd = writer.into();
        let output = child().stderr(Stdio::from(fd)).output().unwrap();
        assert!(output.status.success(), "child exited: {:?}", output.status);
    }

    #[test]
    fn survives_unwritable_stderr() {
        let read_only = std::fs::File::open("/dev/null").unwrap();
        let output = child().stderr(Stdio::from(read_only)).output().unwrap();
        assert!(output.status.success(), "child exited: {:?}", output.status);
    }
}
