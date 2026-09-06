"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Lock, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  CreditCard, 
  Zap, 
  Star, 
  ArrowRight, 
  X, 
  ShieldAlert, 
  Award,
  Clock,
  Send
} from "lucide-react";
import { toast } from "sonner";

export interface PremiumGateProps {
  featureKey: string;
  title: string;
  description?: string;
  price?: string;
  badge?: string;
  bullets?: string[];
  onUnlocked?: () => void;
  className?: string;
  compact?: boolean;
}

const DEFAULT_FEATURE_CONFIG: Record<string, { title: string; desc: string; price: string; bullets: string[] }> = {
  camera: {
    title: "Live Camera Surveillance",
    desc: "Remote HD video streaming with real-time front & back camera switching, snapshot capture, and audio stream sync.",
    price: "$14.99/mo",
    bullets: [
      "Real-time low-latency HD camera feed",
      "Switch between front and back camera lenses",
      "One-click high resolution snapshots to cloud storage",
      "Encrypted transmission with zero device notification",
    ],
  },
  screen: {
    title: "Screen Monitor HD",
    desc: "Stream and observe remote displays at up to 60fps with full display resolution and multi-monitor switching.",
    price: "$14.99/mo",
    bullets: [
      "Smooth 60fps remote desktop & mobile screen streaming",
      "Multi-monitor detection and instant selector",
      "Full canvas rendering with auto-reconnect",
      "Live activity recording and capture timeline",
    ],
  },
  files: {
    title: "Remote File Manager",
    desc: "Browse, download, upload, and manage entire directory trees on target systems with Cloudinary cloud storage.",
    price: "$9.99/mo",
    bullets: [
      "Full remote file system directory tree traversal",
      "Fast download & background multi-file upload",
      "Cloudinary integration for automatic media sync",
      "Public file sharing with secure one-time links",
    ],
  },
  shell: {
    title: "Interactive Shell Terminal",
    desc: "Execute shell commands, PowerShell scripts, and bash routines directly on remote targets with full terminal I/O.",
    price: "$19.99/mo",
    bullets: [
      "Real-time interactive VT100 / Xterm terminal emulator",
      "Run elevated PowerShell, CMD, or bash commands",
      "Command history, persistent sessions, and auto-complete",
      "Full session transcript logging for compliance audit",
    ],
  },
  ops: {
    title: "Agent Operations & Automation",
    desc: "Deploy intelligent automation tasks, monitor background workers, and configure automated cron jobs.",
    price: "$12.99/mo",
    bullets: [
      "Automated heartbeat telemetry & system health tasks",
      "Scheduled maintenance jobs & self-healing agents",
      "Process priority control & memory leak monitoring",
      "Multi-agent task orchestration across fleet",
    ],
  },
  apps: {
    title: "Remote App Installer",
    desc: "Deploy and install software packages, APKs, or desktop executables silently across managed devices.",
    price: "$9.99/mo",
    bullets: [
      "Silent background application deployment",
      "App launch, force-stop, and process termination",
      "Software version audit and update enforcement",
      "Support for Android APKs, Windows EXEs, and Linux packages",
    ],
  },
  fleet: {
    title: "Fleet Grid Operations",
    desc: "Monitor dozens of devices simultaneously in a high-density matrix grid with real-time video previews.",
    price: "$19.99/mo",
    bullets: [
      "Real-time multi-device thumbnail grid",
      "Synchronized bulk command broadcasting",
      "Geo-location distribution map and IP tracking",
      "Instant group tagging, filtering, and status alerts",
    ],
  },
  cockpit: {
    title: "Hardware Cockpit Control",
    desc: "Low-level diagnostic sensors, battery health, RAM/CPU load, and direct hardware toggles.",
    price: "$14.99/mo",
    bullets: [
      "Real-time sensor telemetry (battery, RAM, disk, thermal)",
      "Remote device reboot, shutdown, and sleep controls",
      "Network interface analyzer and public IP inspector",
      "Hardware integrity report & security posture check",
    ],
  },
  logs: {
    title: "Activity Logs & History Suite",
    desc: "Comprehensive auditing and monitoring including full browser histories, app usages, and device activity trails.",
    price: "$12.99/mo",
    bullets: [
      "Full browser URL history and visit frequency indexing",
      "Application launch and window focus timeline",
      "Device pairing and security event audit log",
      "Fast searchable SQL database records with date range filters",
    ],
  },
  "logs.browser": {
    title: "Browser History Intelligence",
    desc: "Deep inspection of visited URLs, page titles, visit counts, and search engine queries across Chrome, Edge, and Brave.",
    price: "$4.99/mo",
    bullets: [
      "Full URL and webpage title history logs",
      "Search and sort by visit time, frequency, and keywords",
      "Browser profile identification and multi-user tracking",
      "Export browser logs to CSV or JSON format",
    ],
  },
  "logs.activity": {
    title: "Device Activity Stream",
    desc: "Real-time timeline of file transfers, screen captures, camera accesses, and administrative changes.",
    price: "$4.99/mo",
    bullets: [
      "Chronological activity log with severity levels",
      "Window focus and active title tracking",
      "Administrative audit log for paired devices",
      "Live socket streaming of real-time events",
    ],
  },
  "logs.apps": {
    title: "App Usage Intelligence",
    desc: "Track which applications are opened, duration of use, and foreground execution timestamps.",
    price: "$4.99/mo",
    bullets: [
      "Detailed list of executed apps and executables",
      "Session duration & total screen-time metrics",
      "Windows user profile association",
      "Filter by category (games, productivity, social)",
    ],
  },
  phone: {
    title: "Phone Intelligence & Communications",
    desc: "Full telecommunications suite including call logs, SMS message history, contacts database, and remote device lock.",
    price: "$14.99/mo",
    bullets: [
      "Incoming, outgoing, and missed call recording with duration",
      "SMS text message history with sender addresses and timestamps",
      "Complete device address book contacts list",
      "Remote lock screen with PIN, password, or pattern override",
    ],
  },
  "phone.calls": {
    title: "Call Logs Intelligence",
    desc: "Inspect incoming, outgoing, and missed phone calls with contact names, phone numbers, and call durations.",
    price: "$4.99/mo",
    bullets: [
      "Complete incoming, outgoing, and missed call records",
      "Caller name and dialed phone number indexing",
      "Call duration in seconds and exact timestamps",
      "Real-time synchronization with Android gateway",
    ],
  },
  "phone.sms": {
    title: "SMS Message Intelligence",
    desc: "Inspect incoming and outgoing text messages, sender addresses, read states, and delivery timestamps.",
    price: "$4.99/mo",
    bullets: [
      "Full SMS conversation history",
      "Sender and recipient phone numbers",
      "Message delivery and read timestamps",
      "Real-time SMS synchronization with Android gateway",
    ],
  },
  "phone.contacts": {
    title: "Phone Contacts Directory",
    desc: "Complete address book inspection with contact names, mobile numbers, and associated profiles.",
    price: "$3.99/mo",
    bullets: [
      "Full device address book directory",
      "Contact names and associated phone numbers",
      "Fast live searching and instant export",
      "Automatic sync with Android device agent",
    ],
  },
  usage: {
    title: "Resource & Telemetry Suite",
    desc: "In-depth hardware resource metrics, bandwidth utilization, battery wear, and CPU thermal trends.",
    price: "$7.99/mo",
    bullets: [
      "Historical CPU, RAM, and Disk charts",
      "Network bandwidth & packet throughput monitoring",
      "Battery drain analysis & charge cycle logs",
      "Threshold-based alerting and push notifications",
    ],
  },
  notifications: {
    title: "Notification Dispatcher",
    desc: "Send push alerts, broadcast system notifications, and trigger automated device sound cues.",
    price: "$4.99/mo",
    bullets: [
      "Instant remote desktop & phone push notifications",
      "Custom notification title, message, and icon styling",
      "Broadcast alerts to all online fleet devices simultaneously",
      "High-priority audible emergency alarms",
    ],
  },
  architecture: {
    title: "System Architecture & Topology",
    desc: "Interactive system diagrams, socket mesh topologies, and data flow pipeline visualizations.",
    price: "$4.99/mo",
    bullets: [
      "Live WebSocket connection mesh diagram",
      "Database replication & Cloudinary media routing map",
      "Device gateway architecture diagrams",
      "High-resolution diagram export",
    ],
  },
};

export function PremiumGate({
  featureKey,
  title,
  description,
  price,
  badge,
  bullets,
  onUnlocked,
  className = "",
  compact = false,
}: PremiumGateProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardNumber, setCardNumber] = useState("•••• •••• •••• 4242");
  const [cardExpiry, setCardExpiry] = useState("12/28");
  const [cardCvc, setCardCvc] = useState("789");
  const [cardName, setCardName] = useState("Muhammad Zubair");
  const [promoCode, setPromoCode] = useState("");
  const [requestSent, setRequestSent] = useState(false);

  const fallbackConfig = DEFAULT_FEATURE_CONFIG[featureKey] || {
    title: title || "Premium Feature",
    desc: description || "This feature requires a premium plan or specific administrator permission.",
    price: price || "$9.99/mo",
    bullets: bullets || [
      "Instant access upon activation",
      "Full historical synchronization",
      "Enterprise 256-bit encryption",
      "Priority gateway bandwidth",
    ],
  };

  const finalTitle = title || fallbackConfig.title;
  const finalDesc = description || fallbackConfig.desc;
  const finalPrice = price || fallbackConfig.price;
  const finalBullets = bullets || fallbackConfig.bullets;
  const finalBadge = badge || "PREMIUM FEATURE";

  const handleSimulatedPurchase = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setModalOpen(false);
      toast.success(`🎉 Purchase Successful! ${finalTitle} has been unlocked for your account.`);
      if (onUnlocked) {
        onUnlocked();
      }
    }, 1200);
  };

  const handleRequestAdmin = () => {
    setRequestSent(true);
    toast.success(`Upgrade request sent to Workspace Admin for "${finalTitle}".`);
  };

  if (compact) {
    return (
      <div className={`p-6 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-background to-blue-500/5 flex flex-col items-center justify-center text-center ${className}`}>
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-3">
          <Lock className="w-6 h-6 text-amber-400" />
        </div>
        <div className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-1">
          {finalBadge}
        </div>
        <h3 className="text-lg font-bold text-foreground mb-1">{finalTitle}</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-4">{finalDesc}</p>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setModalOpen(true)}
            className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-lg shadow-amber-500/20 gap-2 h-9 px-4 text-xs font-semibold"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Unlock for {finalPrice}
          </Button>
          <Button
            variant="outline"
            onClick={handleRequestAdmin}
            disabled={requestSent}
            className="text-xs h-9 px-3 gap-1.5 border-border"
          >
            <Send className="w-3.5 h-3.5 text-muted-foreground" />
            {requestSent ? "Request Sent" : "Ask Admin"}
          </Button>
        </div>
        {renderModal()}
      </div>
    );
  }

  function renderModal() {
    if (!modalOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="relative w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
          {/* Top Banner */}
          <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-6 text-white relative">
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              Instant Upgrade
            </div>
            <h2 className="text-2xl font-bold">{finalTitle}</h2>
            <p className="text-white/80 text-sm mt-1">{finalDesc}</p>
          </div>

          {/* Checkout Body */}
          <div className="p-6 space-y-5">
            {/* Price Tag Box */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/60 border border-border">
              <div>
                <span className="text-xs text-muted-foreground uppercase font-medium">Selected Tier</span>
                <div className="font-semibold text-foreground">Standard License</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-blue-500">{finalPrice}</div>
                <div className="text-[11px] text-muted-foreground">Cancel anytime</div>
              </div>
            </div>

            {/* Payment Options */}
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground">Payment Method</Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className="flex flex-col items-center justify-center p-3 rounded-xl border border-blue-500/50 bg-blue-500/10 text-foreground text-xs font-semibold transition-all"
                >
                  <CreditCard className="w-5 h-5 text-blue-400 mb-1" />
                  Credit Card
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center justify-center p-3 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 text-foreground text-xs font-semibold transition-all opacity-80"
                >
                  <Zap className="w-5 h-5 text-amber-400 mb-1" />
                  Instant Pay
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center justify-center p-3 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 text-foreground text-xs font-semibold transition-all opacity-80"
                >
                  <ShieldCheck className="w-5 h-5 text-emerald-400 mb-1" />
                  Admin Pass
                </button>
              </div>
            </div>

            {/* Card Form */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Cardholder Name</Label>
                <Input
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Card Number</Label>
                <div className="relative mt-1">
                  <Input
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    className="h-9 text-sm pr-10 font-mono"
                  />
                  <CreditCard className="w-4 h-4 text-muted-foreground absolute right-3 top-2.5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Expires</Label>
                  <Input
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(e.target.value)}
                    className="mt-1 h-9 text-sm font-mono"
                  />
                </div>
                <div>
                  <Label className="text-xs">CVC / CVV</Label>
                  <Input
                    value={cardCvc}
                    onChange={(e) => setCardCvc(e.target.value)}
                    className="mt-1 h-9 text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Security Guarantee */}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>256-bit TLS encrypted transaction · Verified Stripe Sandbox</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="flex-1 h-10 text-sm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSimulatedPurchase}
                disabled={isProcessing}
                className="flex-[2] h-10 text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-lg shadow-blue-500/20"
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing Payment...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Unlock Now · {finalPrice}
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-4xl mx-auto my-8 ${className}`}>
      <Card className="relative overflow-hidden border border-border/80 bg-card/60 backdrop-blur-xl shadow-2xl p-8 lg:p-10">
        {/* Ambient Glows */}
        <div className="absolute -top-32 -left-32 w-72 h-72 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-72 h-72 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 grid gap-8 lg:grid-cols-[1.4fr_1fr] items-center">
          {/* Left: Info & Bullets */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold mb-4">
              <Lock className="w-3.5 h-3.5" />
              <span>{finalBadge}</span>
            </div>

            <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground mb-3">
              {finalTitle}
            </h2>

            <p className="text-muted-foreground text-base leading-relaxed mb-6">
              {finalDesc}
            </p>

            {/* Bullets */}
            <div className="space-y-3 mb-6">
              {finalBullets.map((bullet, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mt-0.5 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <span className="text-sm text-foreground/90 font-medium">{bullet}</span>
                </div>
              ))}
            </div>

            {/* Note */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Award className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Administrators can grant instant capability access from Admin &gt; Permissions.</span>
            </div>
          </div>

          {/* Right: Purchase Action Card */}
          <div className="flex flex-col justify-between p-6 lg:p-8 rounded-2xl bg-gradient-to-b from-muted/80 to-muted/30 border border-border shadow-inner text-center">
            <div className="mb-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 mx-auto flex items-center justify-center text-white shadow-xl shadow-blue-500/25 mb-4">
                <Sparkles className="w-8 h-8" />
              </div>

              <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground mb-1">
                Full Capability Unlock
              </div>

              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl lg:text-5xl font-black tracking-tight text-foreground">
                  {finalPrice.split('/')[0]}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">
                  /{finalPrice.split('/')[1] || 'license'}
                </span>
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Instant activation for this device or user account.
              </p>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => setModalOpen(true)}
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-xl shadow-blue-500/25 gap-2 rounded-xl transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Purchase &amp; Unlock
                <ArrowRight className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                onClick={handleRequestAdmin}
                disabled={requestSent}
                className="w-full h-10 text-xs font-medium border-border rounded-xl gap-2"
              >
                <Send className="w-3.5 h-3.5 text-muted-foreground" />
                {requestSent ? "Activation Request Pending" : "Request Admin Permission"}
              </Button>
            </div>

            <div className="mt-6 pt-4 border-t border-border flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Encrypted
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Instant Access
              </span>
            </div>
          </div>
        </div>
      </Card>

      {renderModal()}
    </div>
  );
}

export default PremiumGate;
