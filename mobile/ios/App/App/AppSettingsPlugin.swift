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
        let direct = Self.usesDirectNotificationSettingsURL()
        openURL(Self.notificationSettingsURLString(), direct: direct, call: call)
    }

    @objc func openAppDetails(_ call: CAPPluginCall) {
        openNotificationSettings(call)
    }

    @objc func openExactAlarmSettings(_ call: CAPPluginCall) {
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

    private static func usesDirectNotificationSettingsURL() -> Bool {
        if #available(iOS 15.4, *) {
            return true
        }
        return false
    }

    private static func notificationSettingsURLString() -> String {
        if #available(iOS 15.4, *) {
            return UIApplicationOpenNotificationSettingsURLString
        }
        return UIApplication.openSettingsURLString
    }

    private func openURL(_ urlString: String, direct: Bool, call: CAPPluginCall) {
        guard let url = URL(string: urlString) else {
            call.reject("Could not open notification settings")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve(["opened": true, "direct": direct])
                } else if direct, let fallback = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(fallback, options: [:]) { _ in
                        call.resolve(["opened": true, "direct": false, "fallback": true])
                    }
                } else {
                    call.reject("Could not open notification settings")
                }
            }
        }
    }
}
