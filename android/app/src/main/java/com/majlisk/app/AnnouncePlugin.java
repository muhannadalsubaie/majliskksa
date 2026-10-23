package com.majlisk.app;

import android.content.Context;
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
}
