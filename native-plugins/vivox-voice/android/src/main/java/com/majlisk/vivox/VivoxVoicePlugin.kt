package com.majlisk.vivox

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

/**
 * جسر Vivox لأندرويد.
 * TODO: استدعاءات Vivox SDK الفعلية غير مكتوبة عمداً — يجب أخذ أسماء الكلاسات والدوال
 * من وثائق Vivox Android SDK بعد تحميلها، لا من التخمين.
 */
@CapacitorPlugin(
    name = "VivoxVoice",
    permissions = [Permission(strings = [android.Manifest.permission.RECORD_AUDIO], alias = "microphone")]
)
class VivoxVoicePlugin : Plugin() {
    private var connected = false

    @PluginMethod
    fun initialize(call: PluginCall) {
        val server = call.getString("server") ?: return call.reject("server required")
        val domain = call.getString("domain") ?: return call.reject("domain required")
        val issuer = call.getString("issuer") ?: return call.reject("issuer required")
        // TODO(Vivox): تهيئة العميل باستخدام server/domain/issuer
        call.resolve()
    }

    @PluginMethod
    fun joinChannel(call: PluginCall) {
        val token = call.getString("token") ?: return call.reject("token required")
        val channelName = call.getString("channelName") ?: return call.reject("channelName required")
        // TODO(Vivox): تسجيل الدخول ثم الانضمام للقناة بالتوكن الصادر من الخادم
        connected = true
        call.resolve()
    }

    @PluginMethod
    fun leaveChannel(call: PluginCall) {
        // TODO(Vivox): مغادرة القناة
        connected = false
        call.resolve()
    }

    @PluginMethod
    fun setMicrophoneMuted(call: PluginCall) {
        val muted = call.getBoolean("muted") ?: return call.reject("muted required")
        // TODO(Vivox): كتم/فتح جهاز الإدخال. اطلب إذن الميكروفون فقط عند أول فتح.
        call.resolve()
    }

    @PluginMethod
    fun isConnected(call: PluginCall) {
        call.resolve(JSObject().put("connected", connected))
    }
}
