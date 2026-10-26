package com.majlisk.app;

import android.content.Context;
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
}
