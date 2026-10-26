package com.majlisk.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.view.accessibility.AccessibilityManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * إعلانات لقارئ الشاشة (TalkBack): يرسل النص مباشرة إلى TalkBack فيقرؤه بصوته
 * ويصفّ الإعلانات بالترتيب، بدل محرك نطق منفصل يقاطع كلامه.
 */
@CapacitorPlugin(name = "Announce")
public class AnnouncePlugin extends Plugin {

    @PluginMethod
    public void announce(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().announceForAccessibility(text);
            call.resolve();
        });
    }

    /** هل TalkBack (أو أي قارئ يستكشف باللمس) مفعّل الآن؟ */
    @PluginMethod
    public void isScreenReaderOn(PluginCall call) {
        AccessibilityManager am = (AccessibilityManager) getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
        JSObject ret = new JSObject();
        ret.put("value", am != null && am.isEnabled() && am.isTouchExplorationEnabled());
        call.resolve(ret);
    }

    // ===== مستوى صوت المحادثة الصوتية =====
    // TalkBack يطلب "تركيز الصوت" مؤقتاً كلما تكلم، فيخفض النظام صوت التطبيق صاحب التركيز تلقائياً
    // فيضعف صوت اللاعبين. نمسك التركيز كمحادثة صوتية ونطلب ألا يخفضنا النظام
    // (setWillPauseWhenDucked)، ثم نتجاهل طلب الخفض فيبقى الجميع بنفس المستوى.

    private AudioFocusRequest focusRequest;
    private final AudioManager.OnAudioFocusChangeListener ignoreDuck = change -> { /* لا نخفض ولا نوقف */ };

    @PluginMethod
    public void keepVoiceLevel(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) {
            call.resolve();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (on && focusRequest == null) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setWillPauseWhenDucked(true)
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener(ignoreDuck)
                    .build();
                am.requestAudioFocus(focusRequest);
            } else if (!on && focusRequest != null) {
                am.abandonAudioFocusRequest(focusRequest);
                focusRequest = null;
            }
        } else if (on) {
            am.requestAudioFocus(ignoreDuck, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN);
        } else {
            am.abandonAudioFocus(ignoreDuck);
        }
        call.resolve();
    }

    /** تشغيل المحادثة في الخلفية (خدمة أمامية بإشعار ثابت) أو إيقافها */
    @PluginMethod
    public void backgroundVoice(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        boolean mic = Boolean.TRUE.equals(call.getBoolean("mic", false));
        Context ctx = getContext();
        Intent i = new Intent(ctx, VoiceService.class).putExtra("mic", mic);
        try {
            if (on) {
                // إذن الإشعارات (Android 13+) يُطلب مرة عند فتح الميكروفون حتى يظهر إشعار المحادثة
                if (mic && Build.VERSION.SDK_INT >= 33
                    && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    && !ctx.getSharedPreferences("majlisk", Context.MODE_PRIVATE).getBoolean("askedNotify", false)) {
                    ctx.getSharedPreferences("majlisk", Context.MODE_PRIVATE).edit().putBoolean("askedNotify", true).apply();
                    ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7002);
                }
                ContextCompat.startForegroundService(ctx, i);
            } else {
                ctx.stopService(i);
            }
        } catch (Exception e) {
            // لا نوقف المحادثة إن تعذّرت الخدمة؛ تعمل والتطبيق ظاهر
        }
        call.resolve();
    }
}
