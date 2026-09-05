package com.zenvora.agent.admin

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import com.zenvora.agent.service.ConnectionHealer

/**
 * Optional Device Admin — workspace companion / MDM-style control.
 * Enables lock + policy hooks; does not hide uninstall (Play Protect / policy compliant).
 */
class ZenvoraDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Toast.makeText(context, "Zenvora administrator enabled", Toast.LENGTH_SHORT).show()
        ConnectionHealer.heal(context, "device_admin_enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Toast.makeText(context, "Zenvora administrator disabled", Toast.LENGTH_SHORT).show()
    }
}
