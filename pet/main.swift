// Roost pet: a floating ghost that tells you when a session needs you.
// It asks `roost-attention` every few seconds; a session claims you only if it
// reached Needs input / Failed / Done after you last looked at it, and your own
// PRs do when they are approved or get changes requested.
import Cocoa
import QuartzCore
import Carbon.HIToolbox
import CoreMediaIO

struct Item: Decodable { let id: String; let name: String; let kind: String; let label: String; let since: Double; let detail: String?; let url: String? }
struct Muted: Decodable { let id: String; let name: String; let until: Double }
struct Attention: Decodable { let items: [Item]; let muted: [Muted]?; let working: Int; let total: Int; let quota: Double? }
struct Config: Decodable { let node: String; let attention: String; let roost: String }

let POLL_SECONDS = 4.0
let SIZE = NSSize(width: 104, height: 112)
let FPS = 30.0
let TIRED_AT = 85.0
let FOCUS_FILE = (NSHomeDirectory() as NSString).appendingPathComponent(".roost/focus")
let JIRA_KEY = try! NSRegularExpression(pattern: "\\b[A-Z][A-Z0-9]+-\\d+\\b")
let ICON = ["needs": "●", "failed": "✕", "done": "✓", "approved": "✓", "changes": "✕"]

func jiraKey(_ text: String) -> String? {
  guard let m = JIRA_KEY.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
  return String(text[Range(m.range, in: text)!])
}

// The ghost is a Lottie animation pre-rendered to PNG frames at build time and
// played with Core Animation. A WKWebView stopped painting for an instant on
// every Space switch (the flash); window-server animations do not.
final class Sprite {
  let frames: [CGImage]
  let segments: [String: [Int]]
  init(dir: URL) {
    var imgs: [CGImage] = []
    var i = 0
    while let src = CGImageSourceCreateWithURL(dir.appendingPathComponent(String(format: "%03d.png", i)) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) {
      imgs.append(img); i += 1
    }
    frames = imgs
    let data = (try? Data(contentsOf: dir.appendingPathComponent("segments.json"))) ?? Data("{}".utf8)
    segments = (try? JSONDecoder().decode([String: [Int]].self, from: data)) ?? [:]
  }
  func animation(_ state: String) -> CAKeyframeAnimation {
    let seg = segments[state] ?? segments["idle"] ?? [0, frames.count]
    let slice = Array(frames[max(0, seg[0])..<min(frames.count, seg[1])])
    let a = CAKeyframeAnimation(keyPath: "contents")
    a.values = slice
    a.calculationMode = .discrete
    a.duration = Double(slice.count) / FPS
    a.repeatCount = .infinity
    a.isRemovedOnCompletion = false
    return a
  }
}

final class GhostView: NSView {
  var onClick: (() -> Void)?
  var onHover: ((Bool) -> Void)?
  var onDragText: ((String?) -> Void)?
  var onDrop: ((String) -> Void)?
  private var downAt: NSPoint = .zero
  private var origin: NSPoint = .zero
  private var dragged = false

  override init(frame: NSRect) {
    super.init(frame: frame)
    registerForDraggedTypes([.URL, .string])
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  required init?(coder: NSCoder) { fatalError() }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseEntered(with event: NSEvent) { onHover?(true) }
  override func mouseExited(with event: NSEvent) { onHover?(false) }

  override func mouseDown(with event: NSEvent) {
    downAt = NSEvent.mouseLocation
    origin = window?.frame.origin ?? .zero
    dragged = false
    onHover?(false)
  }

  override func mouseDragged(with event: NSEvent) {
    let now = NSEvent.mouseLocation
    let dx = now.x - downAt.x, dy = now.y - downAt.y
    if abs(dx) + abs(dy) > 3 { dragged = true }
    window?.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy))
  }

  override func mouseUp(with event: NSEvent) {
    if dragged, let o = window?.frame.origin {
      UserDefaults.standard.set([o.x, o.y], forKey: "origin")
    } else {
      onClick?()
    }
  }

  // A Jira link dragged from the browser starts a session for that ticket.
  private func text(_ info: NSDraggingInfo) -> String? {
    let pb = info.draggingPasteboard
    let s = (pb.readObjects(forClasses: [NSURL.self])?.first as? URL)?.absoluteString ?? pb.string(forType: .string)
    return s.flatMap { jiraKey($0) != nil ? $0 : nil }
  }
  override func draggingEntered(_ info: NSDraggingInfo) -> NSDragOperation {
    let t = text(info)
    onDragText?(t)
    return t == nil ? [] : .copy
  }
  override func draggingExited(_ info: NSDraggingInfo?) { onDragText?(nil) }
  override func performDragOperation(_ info: NSDraggingInfo) -> Bool {
    guard let t = text(info) else { return false }
    onDrop?(t)
    return true
  }
}

// Even on every Space, a window is redrawn with the Space-switch animation.
// The window server's private "sticky" tag keeps it fixed in place. Looked up
// at run time: if this macOS lacks the symbols, it does nothing.
func makeSticky(_ window: NSWindow) {
  typealias ConnFn = @convention(c) () -> Int32
  typealias TagsFn = @convention(c) (Int32, Int32, UnsafeMutablePointer<Int32>, Int32) -> Int32
  let h = dlopen(nil, RTLD_NOW)
  guard let connSym = dlsym(h, "CGSMainConnectionID") ?? dlsym(h, "SLSMainConnectionID"),
        let tagSym = dlsym(h, "CGSSetWindowTags") ?? dlsym(h, "SLSSetWindowTags") else { return }
  let conn = unsafeBitCast(connSym, to: ConnFn.self)()
  var tags: [Int32] = [0x0800, 0]
  _ = unsafeBitCast(tagSym, to: TagsFn.self)(conn, Int32(window.windowNumber), &tags, 32)
}

func floatingPanel(_ rect: NSRect) -> NSPanel {
  let p = NSPanel(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
  p.isOpaque = false
  p.backgroundColor = .clear
  p.hasShadow = false
  // Above normal and floating windows, over full-screen apps, on every Space.
  // isFloatingPanel resets the level to .floating, so it must come first.
  p.isFloatingPanel = true
  p.level = .statusBar
  p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
  p.hidesOnDeactivate = false
  return p
}

// What the ghost says, in a bubble beside it. It never takes clicks.
final class Bubble {
  let panel = floatingPanel(NSRect(x: 0, y: 0, width: 10, height: 10))
  let label = NSTextField(wrappingLabelWithString: "")
  var hideTimer: Timer?

  init() {
    panel.ignoresMouseEvents = true
    let box = NSView()
    box.wantsLayer = true
    box.layer?.backgroundColor = NSColor(calibratedRed: 0.12, green: 0.12, blue: 0.14, alpha: 0.95).cgColor
    box.layer?.cornerRadius = 10
    box.layer?.borderWidth = 1
    box.layer?.borderColor = NSColor(white: 1, alpha: 0.15).cgColor
    label.font = NSFont.systemFont(ofSize: 12)
    label.textColor = NSColor(white: 0.92, alpha: 1)
    label.maximumNumberOfLines = 8
    label.lineBreakMode = .byTruncatingTail
    box.addSubview(label)
    panel.contentView = box
  }

  func show(_ text: String, beside anchor: NSRect, for seconds: Double? = nil) {
    hideTimer?.invalidate()
    label.stringValue = text
    let maxWidth: CGFloat = 300
    label.preferredMaxLayoutWidth = maxWidth
    let fit = label.sizeThatFits(NSSize(width: maxWidth, height: 400))
    let size = NSSize(width: min(maxWidth, ceil(fit.width)) + 24, height: ceil(fit.height) + 16)
    label.frame = NSRect(x: 12, y: 8, width: size.width - 24, height: size.height - 16)
    let screen = NSScreen.screens.first { $0.frame.intersects(anchor) }?.visibleFrame ?? NSScreen.main!.visibleFrame
    var x = anchor.minX - size.width - 4
    if x < screen.minX { x = anchor.maxX + 4 }
    let y = min(max(anchor.midY - size.height / 2 + 16, screen.minY), screen.maxY - size.height)
    panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
    if !panel.isVisible { panel.orderFrontRegardless(); makeSticky(panel) }
    if let s = seconds { hideTimer = Timer.scheduledTimer(withTimeInterval: s, repeats: false) { [weak self] _ in self?.hide() } }
  }

  func hide() {
    hideTimer?.invalidate()
    panel.orderOut(nil)
  }
}

// In a call: the camera is on. A microphone in use is no sign of a call:
// Bluetooth earbuds report theirs running with no call at all. You can also
// force it with ~/.roost/focus, e.g. from a Shortcuts automation on your
// Focus modes, which apps cannot read.
enum Call {
  static func cameraOn() -> Bool {
    var addr = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
                                         mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                         mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var size: UInt32 = 0
    guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, &size) == 0, size > 0 else { return false }
    var ids = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
    var used: UInt32 = 0
    CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &addr, 0, nil, size, &used, &ids)
    return ids.contains { id in
      var r = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
                                        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeWildcard),
                                        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementWildcard))
      var v: UInt32 = 0, u: UInt32 = 0
      CMIOObjectGetPropertyData(id, &r, 0, nil, 4, &u, &v)
      return v != 0
    }
  }
}

// ⌥⌘S from any app: open the next session that needs you.
var hotKeyAction: (() -> Void)?
func registerHotKey() {
  var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
  InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
    DispatchQueue.main.async { hotKeyAction?() }
    return noErr
  }, 1, &spec, nil, nil)
  var ref: EventHotKeyRef?
  RegisterEventHotKey(UInt32(kVK_ANSI_S), UInt32(cmdKey | optionKey), EventHotKeyID(signature: OSType(0x534E4348), id: 1),
                      GetApplicationEventTarget(), 0, &ref)
}

final class Pet: NSObject, NSApplicationDelegate, NSMenuDelegate {
  var panel: NSPanel!
  var ghost = CALayer()
  var badge = CALayer()
  var badgeText = CATextLayer()
  var sprite: Sprite!
  var bubble = Bubble()
  var shownState = ""
  var config: Config!
  var last = Attention(items: [], muted: [], working: 0, total: 0, quota: nil)
  var announced: Set<String>?
  var hovering = false
  var inCall = false

  // Snooze: no alert, no badge, half transparent until the time is up.
  // Stored, so it survives quitting the pet.
  var snoozeUntil: Date? {
    get { (UserDefaults.standard.object(forKey: "snoozeUntil") as? Date).flatMap { $0 > Date() ? $0 : nil } }
    set { UserDefaults.standard.set(newValue, forKey: "snoozeUntil") }
  }

  // Off for people who want the ghost on screen in their meetings too.
  var hideOnCamera: Bool {
    get { UserDefaults.standard.object(forKey: "hideOnCamera") as? Bool ?? true }
    set { UserDefaults.standard.set(newValue, forKey: "hideOnCamera") }
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    let res = Bundle.main.resourceURL!
    config = try! JSONDecoder().decode(Config.self, from: Data(contentsOf: res.appendingPathComponent("config.json")))

    var origin = NSPoint(x: (NSScreen.main?.visibleFrame.maxX ?? 1200) - SIZE.width - 24, y: 80)
    if let saved = UserDefaults.standard.array(forKey: "origin") as? [Double], saved.count == 2 {
      origin = NSPoint(x: saved[0], y: saved[1])
    }
    panel = floatingPanel(NSRect(origin: origin, size: SIZE))

    sprite = Sprite(dir: res.appendingPathComponent("frames"))
    let root = NSView(frame: NSRect(origin: .zero, size: SIZE))
    root.wantsLayer = true
    root.layer?.backgroundColor = .clear
    ghost.frame = root.bounds
    ghost.contentsGravity = .resizeAspect
    ghost.contentsScale = 2
    ghost.contents = sprite.frames.first
    root.layer?.addSublayer(ghost)
    badge.frame = CGRect(x: SIZE.width - 30, y: SIZE.height - 28, width: 22, height: 20)
    badge.cornerRadius = 10
    badge.backgroundColor = CGColor(red: 1, green: 0.4, blue: 0.4, alpha: 1)
    badge.isHidden = true
    badgeText.frame = CGRect(x: 0, y: 2, width: 22, height: 16)
    badgeText.alignmentMode = .center
    badgeText.fontSize = 12
    badgeText.font = NSFont.boldSystemFont(ofSize: 12)
    badgeText.foregroundColor = .white
    badgeText.contentsScale = 2
    badge.addSublayer(badgeText)
    root.layer?.addSublayer(badge)
    // A transparent view on top takes every click, drag, hover and drop.
    let hit = GhostView(frame: root.bounds)
    hit.onClick = { [weak self] in self?.showMenu() }
    hit.onHover = { [weak self] on in self?.hover(on) }
    hit.onDragText = { [weak self] text in self?.dragging(text) }
    hit.onDrop = { [weak self] text in self?.startSession(text) }
    root.addSubview(hit)
    panel.contentView = root
    panel.orderFrontRegardless()
    makeSticky(panel)

    hotKeyAction = { [weak self] in self?.openNext() }
    registerHotKey()

    render()
    poll()
    Timer.scheduledTimer(withTimeInterval: POLL_SECONDS, repeats: true) { [weak self] _ in self?.poll() }
  }

  func run(_ args: [String], done: @escaping (Data) -> Void) {
    DispatchQueue.global().async {
      let p = Process()
      p.executableURL = URL(fileURLWithPath: self.config.node)
      p.arguments = [self.config.attention] + args
      var env = ProcessInfo.processInfo.environment
      let nodeDir = (self.config.node as NSString).deletingLastPathComponent
      env["PATH"] = "\(nodeDir):\(NSHomeDirectory())/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      p.environment = env
      let out = Pipe()
      p.standardOutput = out
      p.standardError = FileHandle.nullDevice
      do { try p.run() } catch { return }
      let data = out.fileHandleForReading.readDataToEndOfFile()
      p.waitUntilExit()
      DispatchQueue.main.async { done(data) }
    }
  }

  func poll() {
    checkCall()
    run([]) { [weak self] data in
      guard let self, let a = try? JSONDecoder().decode(Attention.self, from: data) else { return }
      self.last = a
      self.announce()
      self.refreshHover()
      self.render()
    }
  }

  func checkCall() {
    let now = (hideOnCamera && Call.cameraOn()) || FileManager.default.fileExists(atPath: FOCUS_FILE)
    if now != inCall {
      inCall = now
      if now { bubble.hide() }
      render()
    }
  }

  // A new item makes the ghost say what it is, once, for a few seconds.
  func announce() {
    let keys = last.items.map { "\($0.id)@\($0.since)" }
    defer { announced = (announced ?? []).union(keys) }
    guard let seen = announced, snoozeUntil == nil, !inCall, !hovering else { return }
    guard let fresh = last.items.first(where: { !seen.contains("\($0.id)@\($0.since)") }) else { return }
    bubble.show(describe(fresh, full: true), beside: panel.frame, for: 7)
  }

  func describe(_ item: Item, full: Bool) -> String {
    var s = "\(ICON[item.kind] ?? "·") \(item.name) — \(item.label)"
    if let d = item.detail?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty, d != item.name {
      s += "\n" + (full || d.count <= 90 ? d : String(d.prefix(88)) + "…")
    }
    return s
  }

  func hover(_ on: Bool) {
    hovering = on
    guard on, !inCall else { bubble.hide(); return }
    var lines: [String]
    if last.items.isEmpty {
      lines = ["Nothing needs you · \(last.working) working"]
    } else {
      lines = last.items.prefix(3).map { describe($0, full: false) }
      if last.items.count > 3 { lines.append("…and \(last.items.count - 3) more") }
    }
    if let q = last.quota, q >= TIRED_AT { lines.append("5h quota at \(Int(q))%") }
    if let until = snoozeUntil { lines.append("💤 snoozed until \(clock(until))") }
    lines.append("⌥⌘S opens the next one")
    bubble.show(lines.joined(separator: "\n\n"), beside: panel.frame)
  }

  // A lost mouse-exit (a click opens the menu) would leave the bubble up with
  // old news: each poll rewrites it, or closes it once the mouse is gone.
  func refreshHover() {
    guard hovering else { return }
    if panel.frame.contains(NSEvent.mouseLocation) { hover(true) } else { hover(false) }
  }

  func dragging(_ text: String?) {
    if let t = text, let key = jiraKey(t) {
      bubble.show("Drop to start a session for \(key)", beside: panel.frame)
    } else {
      bubble.hide()
    }
  }

  func startSession(_ text: String) {
    bubble.show("Starting \(jiraKey(text) ?? "a session")…", beside: panel.frame)
    run(["--dispatch", text]) { [weak self] data in
      guard let self else { return }
      let parts = (String(data: data, encoding: .utf8) ?? "").split(separator: "\t").map(String.init)
      let msg = parts.count == 2 ? "Started \(parts[0]) in \(parts[1])" : "Could not start the session"
      self.bubble.show(msg, beside: self.panel.frame, for: 5)
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.poll() }
    }
  }

  // The pose follows the most urgent item: needs you = alert, bad news =
  // serious, good news = happy. With nothing pending: tired when the 5h quota
  // is nearly spent, else working, idle, or asleep at night.
  func pose() -> String {
    if snoozeUntil != nil { return "sleep" }
    if let top = last.items.first {
      switch top.kind {
      case "needs": return "alert"
      case "failed", "changes": return "serious"
      default: return "happy"
      }
    }
    if let q = last.quota, q >= TIRED_AT { return "tired" }
    if last.working > 0 { return "working" }
    let hour = Calendar.current.component(.hour, from: Date())
    return hour >= 8 && hour < 20 ? "idle" : "sleep"
  }

  func render() {
    // In a call the ghost hides, so it is never on a shared screen.
    panel.alphaValue = inCall ? 0 : (snoozeUntil != nil ? 0.45 : 1)
    panel.ignoresMouseEvents = inCall
    let count = snoozeUntil != nil ? 0 : last.items.count
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    badge.isHidden = count == 0
    badgeText.string = count > 9 ? "9+" : "\(count)"
    CATransaction.commit()
    let state = pose()
    if state != shownState {
      shownState = state
      ghost.removeAnimation(forKey: "play")
      ghost.add(sprite.animation(state), forKey: "play")
    }
    CATransaction.flush()
  }

  func clock(_ d: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "EEE HH:mm"
    return f.string(from: d)
  }

  func age(_ ms: Double) -> String {
    let s = max(0, Date().timeIntervalSince1970 - ms / 1000)
    if s < 60 { return "\(Int(s))s" }
    if s < 3600 { return "\(Int(s / 60))m" }
    if s < 86400 { return "\(Int(s / 3600))h" }
    return "\(Int(s / 86400))d"
  }

  func menuItem(_ title: String, _ action: Selector?, tag: Int = 0, object: Any? = nil) -> NSMenuItem {
    let mi = NSMenuItem(title: title, action: action, keyEquivalent: "")
    mi.target = self
    mi.tag = tag
    mi.representedObject = object
    return mi
  }

  func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
    let mi = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let sub = NSMenu()
    items.forEach(sub.addItem)
    mi.submenu = sub
    return mi
  }

  func showMenu() {
    hovering = false
    bubble.hide()
    let menu = NSMenu()
    menu.autoenablesItems = false
    let what = last.items.isEmpty ? "Nothing needs you · \(last.working) working" : "\(last.items.count) need your attention"
    let head = NSMenuItem(title: snoozeUntil.map { "💤 \(what) — snoozed until \(self.clock($0))" } ?? what, action: nil, keyEquivalent: "")
    head.isEnabled = false
    menu.addItem(head)
    menu.addItem(.separator())
    for item in last.items {
      menu.addItem(menuItem("\(ICON[item.kind] ?? "·")  \(item.name)   — \(item.label) · \(age(item.since))", #selector(openItem(_:)), object: item))
    }
    let sessions = last.items.filter { $0.url == nil }
    if !last.items.isEmpty {
      menu.addItem(.separator())
      menu.addItem(menuItem("Mark all as seen", #selector(markAll)))
    }
    if !sessions.isEmpty {
      menu.addItem(submenu("Mute a session", sessions.map { item in
        submenu(item.name, [("For 2 hours", 120), ("Until tomorrow 9:00", -1), ("Always", 0)].map {
          menuItem($0.0, #selector(muteItem(_:)), tag: $0.1, object: item.id)
        })
      }))
    }
    if let muted = last.muted, !muted.isEmpty {
      menu.addItem(submenu("Muted (\(muted.count))", muted.map { m in
        let until = m.until == 0 ? "always" : "until \(clock(Date(timeIntervalSince1970: m.until / 1000)))"
        return menuItem("Unmute \(m.name) (\(until))", #selector(unmuteItem(_:)), object: m.id)
      }))
    }
    if let until = snoozeUntil {
      menu.addItem(menuItem("Resume now (snoozed until \(clock(until)))", #selector(resumeNow)))
    } else {
      menu.addItem(submenu("Snooze", [("15 minutes", 15), ("1 hour", 60), ("3 hours", 180), ("Until tomorrow 9:00", -1)].map {
        menuItem($0.0, #selector(snooze(_:)), tag: $0.1)
      }))
    }
    let camera = menuItem("Hide when the camera is on", #selector(toggleHideOnCamera))
    camera.state = hideOnCamera ? .on : .off
    menu.addItem(camera)
    menu.addItem(menuItem("Open roost", #selector(openRoost)))
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Quit pet", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
    let at = NSPoint(x: SIZE.width / 2, y: SIZE.height / 2)
    menu.popUp(positioning: nil, at: at, in: panel.contentView)
  }

  // A new iTerm window running roost; it marks the session seen when it opens it.
  func terminal(_ command: String) {
    let cmd = command.replacingOccurrences(of: "\"", with: "\\\"")
    let source = """
    tell application "iTerm"
      activate
      create window with default profile command "/bin/zsh -ilc \\"\(cmd)\\""
    end tell
    """
    var err: NSDictionary?
    NSAppleScript(source: source)?.executeAndReturnError(&err)
  }

  // Bring forward the iTerm tab whose session runs on this tty.
  func focus(tty: String) {
    let source = """
    tell application "iTerm"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if tty of s is "\(tty)" then
              select w
              tell t to select
              tell s to select
            end if
          end repeat
        end repeat
      end repeat
      activate
    end tell
    """
    var err: NSDictionary?
    NSAppleScript(source: source)?.executeAndReturnError(&err)
  }

  // The roost already open takes the session (and leaves the one it is in);
  // only when none is listening does a new iTerm window open. A PR opens in
  // the browser.
  func open(_ item: Item) {
    bubble.hide()
    if let url = item.url {
      run(["--open-pr", url]) { [weak self] _ in self?.poll() }
      return
    }
    run(["--open", item.id]) { [weak self] data in
      guard let self else { return }
      let reply = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if reply.isEmpty {
        self.terminal("\(self.config.roost) --open \(item.id)")
      } else if reply.hasPrefix("/dev/") {
        self.focus(tty: reply)
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.poll() }
    }
  }

  @objc func openItem(_ sender: NSMenuItem) {
    if let item = sender.representedObject as? Item { open(item) }
  }

  func openNext() {
    if let item = last.items.first { open(item) } else { openRoost() }
  }

  @objc func openRoost() {
    let info = (NSHomeDirectory() as NSString).appendingPathComponent(".roost/roost.json")
    if let data = FileManager.default.contents(atPath: info),
       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let pid = obj["pid"] as? Int, kill(pid_t(pid), 0) == 0, let tty = obj["tty"] as? String, tty.hasPrefix("/dev/") {
      focus(tty: tty)
    } else {
      terminal(config.roost)
    }
  }

  func minutesUntilTomorrow9() -> Int {
    let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date())!
    let at = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow)!
    return Int(ceil(at.timeIntervalSinceNow / 60))
  }

  @objc func snooze(_ sender: NSMenuItem) {
    let minutes = sender.tag > 0 ? sender.tag : minutesUntilTomorrow9()
    snoozeUntil = Date().addingTimeInterval(Double(minutes) * 60)
    bubble.hide()
    render()
  }

  @objc func toggleHideOnCamera() {
    hideOnCamera.toggle()
    checkCall()
  }

  @objc func resumeNow() {
    snoozeUntil = nil
    render()
  }

  @objc func muteItem(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    let minutes = sender.tag < 0 ? minutesUntilTomorrow9() : sender.tag
    run(["--mute", id, String(minutes)]) { [weak self] _ in self?.poll() }
  }

  @objc func unmuteItem(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    run(["--unmute", id]) { [weak self] _ in self?.poll() }
  }

  @objc func markAll() {
    run(["--seen-all"]) { [weak self] _ in self?.poll() }
  }
}

let app = NSApplication.shared
let delegate = Pet()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
