import Foundation
import Capacitor
import UserNotifications
import UIKit

@objc(AppSettingsPlugin)
public class AppSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppSettingsPlugin"
    public let jsName = "AppSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openNotificationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkNotificationEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppDetails", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openExactAlarmSettings", returnType: CAPPluginReturnPromise),
    ]

    @objc func openNotificationSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("Could not open settings")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { _ in
                call.resolve(["opened": true])
            }
        }
    }

    @objc func openAppDetails(_ call: CAPPluginCall) {
        openNotificationSettings(call)
    }

    @objc func openExactAlarmSettings(_ call: CAPPluginCall) {
        // iOS has no separate exact-alarm setting — notifications cover scheduled alerts.
        openNotificationSettings(call)
    }

    @objc func checkNotificationEnabled(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let enabled: Bool
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                enabled = true
            default:
                enabled = false
            }
            call.resolve(["enabled": enabled])
        }
    }
}
