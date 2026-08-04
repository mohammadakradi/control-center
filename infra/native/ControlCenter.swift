// Agent Control Center — a native macOS window around the local dashboard.
//
// Why this exists: launching Chrome with `--app=` gives you a Chrome window, so macOS shows
// Chrome in the Dock and ⌘Tab. The Dock entry follows whichever process owns the window, so the
// only way to get *our* icon there is to own the window ourselves. This is that: an
// NSApplication with a WKWebView pointed at the local server.
//
// It is deliberately thin. Everything real still lives in the local server; this process starts
// it if it isn't up, waits, and shows it. It never talks to the network beyond localhost.
//
// Built at install time by infra/native/build.sh with the Swift that ships in Xcode Command
// Line Tools. Compiling locally (rather than shipping a binary) also sidesteps Gatekeeper:
// nothing downloaded means nothing quarantined, so no signing or notarisation is needed.

import Cocoa
import WebKit

let appURL = URL(string: ProcessInfo.processInfo.environment["CC_URL"] ?? "http://localhost:3001")!
/// The launcher that starts the server, updates the install, and runs migrations.
let cliPath = ProcessInfo.processInfo.environment["CC_CLI"]
    ?? ("\(NSHomeDirectory())/.local/bin/control-center")

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    private var waited = 0.0
    /// True when *this* app started the server, and is therefore responsible for stopping it
    /// again. If the server was already up — someone ran `control-center start` in a terminal —
    /// quitting the window must leave it alone.
    private var ownsServer = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        // The dashboard streams task output over SSE and stores theme choices in
        // localStorage; both want a persistent, normal web environment.
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // Match the dashboard's own light/dark handling rather than forcing one.
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Agent Control Center"
        window.titlebarAppearsTransparent = true
        window.contentView = webView
        window.minSize = NSSize(width: 720, height: 480)
        // Remembers size and position between launches, like any Mac app.
        window.setFrameAutosaveName("ControlCenterWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        showStatus("Starting Agent Control Center…")
        // Adopt a server that's already up rather than starting a second one; only start (and
        // therefore own) one if nothing answers.
        if isServerUp() {
            webView.load(URLRequest(url: appURL))
        } else {
            startServer()
            waitForServer()
        }
    }

    // A window-less app on macOS keeps running with nothing to show; quitting on close is what
    // a single-window app should do.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Is something already serving? A synchronous probe, because the answer decides whether we
    /// start a server we then have to stop.
    private func isServerUp() -> Bool {
        var request = URLRequest(url: appURL)
        request.timeoutInterval = 1.5
        request.httpMethod = "HEAD"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        var up = false
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { _, response, _ in
            up = response != nil
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 2)
        return up
    }

    /// Start the server. `start` also checks for a new release, applies it, and runs migrations —
    /// so opening this app keeps the install current.
    private func startServer() {
        guard FileManager.default.isExecutableFile(atPath: cliPath) else {
            showStatus("Couldn't find the control-center command at \(cliPath).")
            return
        }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "'\(cliPath)' start"]
        // The window is the UI; the launcher's own window-opening would be a duplicate.
        var env = ProcessInfo.processInfo.environment
        env["CC_NO_OPEN"] = "1"
        task.environment = env
        do {
            try task.run()
            ownsServer = true
        } catch {
            showStatus("Couldn't start the server: \(error.localizedDescription)")
        }
    }

    /// Closing the window quits the app, and quitting takes the server with it — but only the
    /// one we started. Synchronous on purpose: macOS gives an app a moment to tidy up on
    /// terminate, and a detached `stop` would race that deadline and leave the server running.
    func applicationWillTerminate(_ notification: Notification) {
        guard ownsServer, FileManager.default.isExecutableFile(atPath: cliPath) else { return }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "'\(cliPath)' stop"]
        try? task.run()
        // Bounded: never hang the quit on a wedged shutdown.
        DispatchQueue.global().asyncAfter(deadline: .now() + 8) { if task.isRunning { task.terminate() } }
        task.waitUntilExit()
    }

    /// Poll until the server answers, then load it. A first run compiles on demand, so this is
    /// patient — but it says what it's waiting for rather than showing a blank window.
    private func waitForServer() {
        var request = URLRequest(url: appURL)
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            guard let self else { return }
            DispatchQueue.main.async {
                if response != nil {
                    self.webView.load(URLRequest(url: appURL))
                    return
                }
                self.waited += 1
                if self.waited > 180 {
                    self.showStatus(
                        "The server at \(appURL.absoluteString) didn't come up.<br>"
                            + "Check <code>~/.control-center/logs/web.log</code>."
                    )
                    return
                }
                if self.waited.truncatingRemainder(dividingBy: 10) == 0 {
                    self.showStatus(
                        self.ownsServer
                            ? "Starting Agent Control Center…<br><small>a fresh install compiles on first run</small>"
                            : "Waiting for \(appURL.absoluteString)…"
                    )
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.waitForServer() }
            }
        }.resume()
    }

    /// A holding page in the app's own colours, so the window is never blank or white-flashing.
    private func showStatus(_ message: String) {
        let html = """
            <html><head><meta name="color-scheme" content="light dark"><style>
              html,body{height:100%;margin:0}
              body{display:flex;align-items:center;justify-content:center;
                   font:14px -apple-system,system-ui,sans-serif;color:#8a8a92;background:#0a0a0b;
                   text-align:center;line-height:1.6}
              small{opacity:.7} code{font-size:12px}
              @media (prefers-color-scheme: light){body{background:#f7f7f8;color:#5f5f6a}}
            </style></head><body><div>\(message)</div></body></html>
            """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - Navigation

    /// Keep the app on the local dashboard; anything else is a real web link and belongs in the
    /// user's browser (the Anthropic console, GitHub release notes, a project's remote).
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let isLocal = url.host == appURL.host || url.host == "127.0.0.1" || url.scheme == "about"
        if isLocal || url.scheme == "data" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    /// `target="_blank"` and `window.open` — same rule, opened outside.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showStatus("Couldn't load the dashboard.<br><small>\(error.localizedDescription)</small>")
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        // Usually the server going away mid-session; go back to polling for it.
        waited = 0
        showStatus("Reconnecting to Agent Control Center…")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.waitForServer() }
    }

    // MARK: - Menus
    // Built in code because there's no nib. Without them ⌘Q, ⌘R and — importantly for a web
    // app — ⌘C/⌘V/⌘A wouldn't work at all: WKWebView gets those through the responder chain,
    // and the responder chain needs menu items carrying the key equivalents.

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Agent Control Center", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Agent Control Center", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Agent Control Center", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        mainMenu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    @objc private func reload() {
        if webView.url?.host == nil {
            webView.load(URLRequest(url: appURL)) // came from the holding page
        } else {
            webView.reload()
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular) // a real Dock icon and ⌘Tab entry — the whole point
let delegate = AppDelegate()
app.delegate = delegate
app.run()
