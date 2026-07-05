package com.frqueue.optimizer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class PlanAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        int id = intent.getIntExtra("id", 0);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String channel = intent.getStringExtra("channel");
        NotificationHelper.show(context, id, title, body, channel);
    }
}
