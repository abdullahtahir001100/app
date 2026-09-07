package com.zenvora.agent.activity

import android.app.Activity
import android.os.Bundle
import com.zenvora.agent.service.KeepAlive

/** Brief trampoline so Android 12+ can start the foreground service after a kill. */
class RestartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        KeepAlive.pulse(this)
        finish()
    }
}
