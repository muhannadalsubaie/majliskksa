package com.majlisk.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // إضافة محلية: إعلانات TalkBack
        registerPlugin(AnnouncePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
