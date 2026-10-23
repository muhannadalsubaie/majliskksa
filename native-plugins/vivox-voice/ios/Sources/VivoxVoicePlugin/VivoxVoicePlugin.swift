import Foundation
import Capacitor

/// جسر Vivox لآيفون.
/// TODO: استدعاءات Vivox SDK الفعلية غير مكتوبة عمداً — يجب أخذ أسماء الكلاسات والدوال
/// من وثائق Vivox iOS SDK بعد تحميلها، لا من التخمين.
@objc(VivoxVoicePlugin)
public class VivoxVoicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VivoxVoicePlugin"
    public let jsName = "VivoxVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "joinChannel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leaveChannel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMicrophoneMuted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isConnected", returnType: CAPPluginReturnPromise),
    ]

    private var connected = false

    @objc func initialize(_ call: CAPPluginCall) {
        guard call.getString("server") != nil, call.getString("domain") != nil, call.getString("issuer") != nil else {
            return call.reject("server, domain and issuer are required")
        }
        // TODO(Vivox): تهيئة العميل
        call.resolve()
    }

    @objc func joinChannel(_ call: CAPPluginCall) {
        guard call.getString("token") != nil, call.getString("channelName") != nil else {
            return call.reject("token and channelName are required")
        }
        // TODO(Vivox): تسجيل الدخول ثم الانضمام للقناة
        connected = true
        call.resolve()
    }

    @objc func leaveChannel(_ call: CAPPluginCall) {
        // TODO(Vivox): مغادرة القناة
        connected = false
        call.resolve()
    }

    @objc func setMicrophoneMuted(_ call: CAPPluginCall) {
        guard call.getBool("muted") != nil else { return call.reject("muted is required") }
        // TODO(Vivox): كتم/فتح الميكروفون
        call.resolve()
    }

    @objc func isConnected(_ call: CAPPluginCall) {
        call.resolve(["connected": connected])
    }
}
