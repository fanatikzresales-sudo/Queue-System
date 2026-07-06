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
        let settingsURL: String
        let isDirectNotificationSettings: Bool
        if #available(iOS 16.0, *) {
            settingsURL = UIApplication.openNotificationSettingsURLString
            isDirectNotificationSettings = true
        } else {
            settingsURL = UIApplication.openSettingsURLString
            isDirectNotificationSettings = false
        }

        guard let url = URL(string: settingsURL) else {
            call.reject("Could not open notification settings")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve(["opened": true, "direct": isDirectNotificationSettings])
                } else if isDirectNotificationSettings {
                    // Fallback if deep link fails (e.g. notifications never requested yet)
                    if let fallback = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(fallback, options: [:]) { _ in
                            call.resolve(["opened": true, "direct": false, "fallback": true])
                        }
                    } else {
                        call.reject("Could not open settings")
                    }
                } else {
                    call.reject("Could not open notification settings")
                }
            }
        }
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
}
