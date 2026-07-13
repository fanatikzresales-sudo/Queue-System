import Foundation
import Capacitor
import UserNotifications

/// Native iOS plan alerts — reliable scheduling via UNUserNotificationCenter.
@objc(PlanAlarmPlugin)
public class PlanAlarmPlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {
    public let identifier = "PlanAlarmPlugin"
    public let jsName = "PlanAlarm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "showNow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleAlarms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAlarms", returnType: CAPPluginReturnPromise),
    ]

    private var delegateInstalled = false

    public override func load() {
        installDelegateIfNeeded()
    }

    private func installDelegateIfNeeded() {
        guard !delegateInstalled else { return }
        let center = UNUserNotificationCenter.current()
        if center.delegate == nil {
            center.delegate = self
        }
        delegateInstalled = true
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .list, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    @objc func showNow(_ call: CAPPluginCall) {
        installDelegateIfNeeded()
        let id = call.getInt("id") ?? Int(Date().timeIntervalSince1970) % 1_000_000
        let title = call.getString("title") ?? "FR Queue Optimizer"
        let body = call.getString("body") ?? ""
        let atMs = Date().timeIntervalSince1970 * 1000 + 500
        scheduleOne(id: id, title: title, body: body, atMs: atMs, call: call)
    }

    @objc func scheduleAlarms(_ call: CAPPluginCall) {
        installDelegateIfNeeded()
        guard let alarms = call.getArray("alarms", JSObject.self) else {
            call.reject("Missing alarms array")
            return
        }

        let nowMs = Date().timeIntervalSince1970 * 1000
        var scheduled = 0
        let group = DispatchGroup()

        for item in alarms {
            guard let id = item["id"] as? Int else { continue }
            let atMs: Double
            if let n = item["atMs"] as? Double {
                atMs = n
            } else if let n = item["atMs"] as? Int {
                atMs = Double(n)
            } else if let n = item["atMs"] as? NSNumber {
                atMs = n.doubleValue
            } else {
                continue
            }
            if atMs <= nowMs + 500 { continue }

            let title = (item["title"] as? String) ?? "FR Queue Optimizer"
            let body = (item["body"] as? String) ?? ""

            group.enter()
            enqueue(id: id, title: title, body: body, atMs: atMs) { ok in
                if ok { scheduled += 1 }
                group.leave()
            }
        }

        group.notify(queue: .main) {
            call.resolve(["scheduled": scheduled])
        }
    }

    @objc func cancelAlarms(_ call: CAPPluginCall) {
        guard let ids = call.getArray("ids", Int.self), !ids.isEmpty else {
            call.reject("Missing ids array")
            return
        }
        let center = UNUserNotificationCenter.current()
        let idStrings = ids.map { String($0) }
        center.removePendingNotificationRequests(withIdentifiers: idStrings)
        center.removeDeliveredNotifications(withIdentifiers: idStrings)
        call.resolve()
    }

    private func scheduleOne(id: Int, title: String, body: String, atMs: Double, call: CAPPluginCall) {
        enqueue(id: id, title: title, body: body, atMs: atMs) { ok in
            if ok {
                call.resolve(["scheduled": 1])
            } else {
                call.reject("Could not schedule notification")
            }
        }
    }

    private func enqueue(id: Int, title: String, body: String, atMs: Double, completion: @escaping (Bool) -> Void) {
        let content = UNMutableNotificationContent()
        content.title = String(title.prefix(64))
        content.body = String(body.prefix(240))
        content.sound = .default

        let fireDate = Date(timeIntervalSince1970: atMs / 1000.0)
        let nowMs = Date().timeIntervalSince1970 * 1000
        let delaySec = max(0.5, (atMs - nowMs) / 1000.0)

        // Calendar triggers are more reliable than long time-interval triggers (e.g. days before queue).
        let trigger: UNNotificationTrigger
        if delaySec > 3600 {
            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second],
                from: fireDate
            )
            trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        } else {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: delaySec, repeats: false)
        }

        let request = UNNotificationRequest(identifier: String(id), content: content, trigger: trigger)

        UNUserNotificationCenter.current().add(request) { error in
            completion(error == nil)
        }
    }
}
