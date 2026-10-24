//! Native macOS notifications via `UNUserNotificationCenter` (UserNotifications.framework).
//!
//! Why not the plugin: on macOS `tauri-plugin-notification` goes through
//! `notify-rust` → `mac-notification-sys` → `NSUserNotificationCenter`, an API
//! deprecated since macOS 10.14 that macOS 26 no longer delivers. Symptoms seen
//! live: no notification, no sound, the app doesn't even show up in
//! Settings → Notifications (no authorization prompt ever shown).
//!
//! Here we use the modern framework: explicit authorization (alert + sound +
//! badge, requested at bootstrap), default sound, and clicking the notification
//! brings the window to the front and navigates to the session
//! (`hook:navigate-session`, which the plugin did not allow).
//!
//! Constraint: `UNUserNotificationCenter` requires a bundle (Info.plist with
//! CFBundleIdentifier); outside the bundle (`tauri dev`, bare binary) it raises
//! an ObjC exception. `is_available()` acts as a guard and the caller falls back to the
//! plugin (which in dev poses as Terminal, as always).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread};
use objc2_foundation::{NSBundle, NSDictionary, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Manager};

/// Key in `userInfo` holding the PromptOps session id (for click → navigate).
const SESSION_KEY: &str = "sessionId";
/// `IpcChannels.HOOK_NAVIGATE_SESSION`.
const HOOK_NAVIGATE_SESSION: &str = "hook:navigate-session";

static APP: OnceLock<AppHandle> = OnceLock::new();
static DELEGATE_INSTALLED: AtomicBool = AtomicBool::new(false);
/// `true` after a successful `requestAuthorization` (or already granted).
static AUTHORIZED: AtomicBool = AtomicBool::new(false);
static SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Payload {
    title: String,
    body: String,
    session_id: Option<String>,
}

/// Available only inside a `.app` bundle (CFBundleIdentifier present).
pub fn is_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| NSBundle::mainBundle().bundleIdentifier().is_some())
}

/// Call once in Tauri `setup`: installs the delegate (click) and
/// asks for permission right away, so the system prompt shows up on first launch
/// and not while the user is elsewhere waiting for the first notification.
pub fn bootstrap(app: &AppHandle) {
    if !is_available() {
        return;
    }
    let _ = APP.set(app.clone());
    let _ = app.run_on_main_thread(|| {
        install_delegate();
        request_authorization(None);
    });
}

/// Shows a notification. `false` = not available (outside the bundle): the caller
/// must fall back to the plugin. The "window focused" guard is the caller's.
pub fn show(app: &AppHandle, title: &str, body: &str, session_id: Option<&str>) -> bool {
    if !is_available() {
        return false;
    }
    let _ = APP.set(app.clone());
    let payload = Payload {
        title: title.to_string(),
        body: body.to_string(),
        session_id: session_id.map(str::to_string).filter(|s| !s.is_empty()),
    };
    let _ = app.run_on_main_thread(move || {
        install_delegate();
        if AUTHORIZED.load(Ordering::SeqCst) {
            deliver(&payload);
        } else {
            // Permission not (yet) granted: we ask for it and deliver
            // as soon as the yes arrives. If the user denied it, the completion
            // returns `false` and the notification is dropped, as any app would do.
            request_authorization(Some(Box::new(move || deliver(&payload))));
        }
    });
    true
}

// ── Delegate: click on the notification → focus + navigate ───────────────

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop; no ivars.
    #[unsafe(super(NSObject))]
    #[name = "PromptOpsNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            // With the window in front the caller doesn't notify (guard in
            // notify.rs); if we get here it is an explicit `force` → banner +
            // sound anyway, instead of the macOS default that suppresses them.
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &block2::DynBlock<dyn Fn()>,
        ) {
            on_click(session_id_of(response));
            completion.call(());
        }
    }
);

fn install_delegate() {
    if DELEGATE_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    let delegate: Retained<Delegate> = unsafe { msg_send![Delegate::alloc(), init] };
    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // The center holds the delegate `weak`: it must live as long as the app.
    std::mem::forget(delegate);
}

fn request_authorization(then: Option<Box<dyn FnOnce() + Send + 'static>>) {
    let then = Mutex::new(then);
    let block = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
        let ok = granted.as_bool();
        AUTHORIZED.store(ok, Ordering::SeqCst);
        if !ok {
            eprintln!("[notify] macOS notification permission not granted");
            return;
        }
        if let Some(f) = then.lock().ok().and_then(|mut g| g.take()) {
            f();
        }
    });
    let options = UNAuthorizationOptions::Alert
        | UNAuthorizationOptions::Sound
        | UNAuthorizationOptions::Badge;
    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(options, &block);
}

/// Builds and enqueues the request. Thread-safe (UNUserNotificationCenter
/// is): it can run both on the main thread and from the authorization completion.
fn deliver(p: &Payload) {
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&p.title));
    content.setBody(&NSString::from_str(&p.body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    if let Some(sid) = &p.session_id {
        let key = NSString::from_str(SESSION_KEY);
        let value = NSString::from_str(sid);
        let info: Retained<NSDictionary<NSString, NSString>> =
            NSDictionary::from_slices(&[&*key], &[&*value]);
        // SAFETY: NSDictionary<NSString, NSString> is an NSDictionary; the
        // binding wants the non-generic type (id/id) — an erasure-only cast.
        let info: Retained<NSDictionary> = unsafe { Retained::cast_unchecked(info) };
        unsafe { content.setUserInfo(&info) };
    }
    let id = NSString::from_str(&format!(
        "promptops-{}",
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(&request, None);
}

fn session_id_of(response: &UNNotificationResponse) -> Option<String> {
    let content = response.notification().request().content();
    let info = content.userInfo();
    let key = NSString::from_str(SESSION_KEY);
    let value = info.objectForKey(&key)?;
    let value = value.downcast::<NSString>().ok()?;
    let text = value.to_string();
    (!text.is_empty()).then_some(text)
}

fn on_click(session_id: Option<String>) {
    let Some(app) = APP.get().cloned() else {
        return;
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = handle.get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        if let Some(id) = session_id {
            let _ = handle.emit(HOOK_NAVIGATE_SESSION, id);
        }
    });
}
