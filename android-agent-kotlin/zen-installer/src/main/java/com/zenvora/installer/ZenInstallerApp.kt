package com.zenvora.installer

import android.app.Application
import android.util.Log

class ZenInstallerApp : Application() {

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "ZenInstaller initialized")
    }

    companion object {
        private const val TAG = "ZenInstallerApp"
    }
}
