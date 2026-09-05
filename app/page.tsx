"use client";

import { Button } from "@/components/ui/button";
import { ZenvoraLogo } from "@/components/zenvora-logo";
import Link from "next/link";
import { Smartphone, Zap, Lock, Users, Shield, ArrowRight, Check, Globe, Cpu, Wifi, AlertCircle, TrendingUp, Cloud } from "lucide-react";
import { useEffect, useState } from "react";

export default function Home() {
  const [isVisible, setIsVisible] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    setIsVisible(true);
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const features = [
    {
      icon: Smartphone,
      title: "Remote Device Control",
      description: "Monitor and control Android devices from anywhere with real-time screen streaming",
    },
    {
      icon: Zap,
      title: "Instant Access",
      description: "Access cameras, files, notifications, and device settings instantly",
    },
    {
      icon: Lock,
      title: "Enterprise Security",
      description: "End-to-end encryption and secure authentication protocols",
    },
    {
      icon: Users,
      title: "User Management",
      description: "Complete user and device management with role-based access control",
    },
    {
      icon: Shield,
      title: "Admin Controls",
      description: "Full audit logs, security monitoring, and system administration",
    },
  ];

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className={`border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur transition-all duration-700 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
      }`}>
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-foreground hover-lift transition-transform">
              <ZenvoraLogo />
            </div>
            <span className="font-display text-xl font-semibold">Zenvora</span>
          </div>
          <Link href="/dashboard">
            <Button className="bg-foreground hover:bg-foreground/90 text-background px-6 rounded-full gap-2 group transition-all hover:shadow-lg">
              Launch App
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Animated background */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-foreground/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-foreground/5 rounded-full blur-3xl -z-10" />

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-40 relative">
        <div className="text-center mb-16">
          <div className={`transition-all duration-700 delay-100 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground mb-6 px-4 py-2 bg-accent/50 rounded-full border border-border/50">
              <Check className="w-4 h-4" />
              Enterprise-grade Mobile Device Management
            </span>
          </div>

          <h1 className={`text-5xl lg:text-7xl font-display tracking-tight mb-6 leading-[1.1] transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}>
            Remote Device{" "}
            <span className="relative inline-block">
              Management
              <span className="absolute -bottom-4 left-0 right-0 h-3 bg-foreground/10 rounded-full" />
            </span>
          </h1>
          
          <p className={`text-lg lg:text-xl text-muted-foreground max-w-3xl mx-auto mb-10 leading-relaxed transition-all duration-700 delay-300 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}>
            Monitor, control, and manage Android devices remotely with enterprise-grade security. Built for teams that demand reliability and security.
          </p>

          <div className={`flex flex-col sm:flex-row items-center justify-center gap-4 transition-all duration-700 delay-400 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}>
            <Link href="/dashboard">
              <Button size="lg" className="bg-foreground hover:bg-foreground/90 text-background px-8 h-14 text-base rounded-full gap-2 group transition-all hover:shadow-xl">
                Get Started Now
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="border-border hover:bg-accent/10 px-8 h-14 text-base rounded-full">
              View Demo
            </Button>
          </div>
        </div>

        {/* Animated hero visualization */}
        <div className={`transition-all duration-700 delay-500 ${
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
        }`}>
          <div className="relative h-96 sm:h-[500px] md:h-[600px] rounded-3xl border border-border overflow-hidden bg-gradient-to-br from-card via-sidebar to-background">
            {/* Animated gradient background */}
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-0 left-1/4 w-72 h-72 bg-foreground/20 rounded-full mix-blend-multiply filter blur-3xl animate-blob" />
              <div className="absolute top-0 right-1/4 w-72 h-72 bg-accent/20 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000" />
              <div className="absolute -bottom-8 left-1/2 w-72 h-72 bg-foreground/10 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000" />
            </div>

            {/* Animated grid lines */}
            <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>

            {/* Central animated elements */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-64 h-64 sm:w-80 sm:h-80">
                {/* Rotating rings */}
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground border-r-accent/50 animate-spin" style={{ animationDuration: '8s' }} />
                <div className="absolute inset-8 rounded-full border-2 border-transparent border-b-foreground border-l-accent/50 animate-spin" style={{ animationDuration: '6s', animationDirection: 'reverse' }} />
                <div className="absolute inset-16 rounded-full border border-accent/30 animate-pulse" />

                {/* Central WiFi logo */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="scale-150 text-foreground opacity-80">
                    <ZenvoraLogo />
                  </div>
                </div>

                {/* Orbiting dots */}
                <div className="absolute inset-0 animate-spin" style={{ animationDuration: '20s' }}>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-accent rounded-full" />
                </div>
                <div className="absolute inset-0 animate-spin" style={{ animationDuration: '20s', animationDirection: 'reverse' }}>
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-accent/60 rounded-full" />
                </div>
              </div>
            </div>

            {/* Responsive info overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 bg-gradient-to-t from-background via-background/80 to-transparent">
              <p className="text-sm sm:text-base font-semibold text-foreground text-center mb-2">
                Enterprise Device Management
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground text-center">
                Real-time monitoring, security controls & seamless device management
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
            Powerful Features
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need to manage devices securely and efficiently
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className={`p-8 bg-card border border-border rounded-xl hover:bg-accent/10 hover:border-foreground/20 transition-all duration-300 group hover-lift opacity-0 animate-[fadeInUp_0.6s_ease-out_forwards]`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="w-12 h-12 bg-accent rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Icon className="w-6 h-6 text-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-3">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* User Capabilities */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
            What You Can Do
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Comprehensive capabilities for users and administrators
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <div className="bg-gradient-to-br from-card to-accent/5 border border-border rounded-xl p-8 hover:border-foreground/20 transition-all hover-lift group">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-3 h-3 rounded-full bg-foreground" />
              <h3 className="text-2xl font-display">User Features</h3>
            </div>
            <ul className="space-y-3">
              {[
                "Manage paired devices with QR code pairing",
                "Monitor live device status, battery, storage",
                "Browse and manage files on devices",
                "View live screen and capture screenshots",
                "Access front and rear cameras",
                "Receive and manage notifications",
                "View complete activity history",
              ].map((feature, idx) => (
                <li key={idx} className="flex items-start gap-3 group/item">
                  <Check className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5 group-hover/item:scale-110 transition-transform" />
                  <span className="text-muted-foreground group-hover/item:text-foreground transition-colors">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-gradient-to-br from-card to-accent/5 border border-border rounded-xl p-8 hover:border-foreground/20 transition-all hover-lift group">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-3 h-3 rounded-full bg-foreground" />
              <h3 className="text-2xl font-display">Admin Features</h3>
            </div>
            <ul className="space-y-3">
              {[
                "Manage all users with ban/unblock controls",
                "Monitor global device health and status",
                "Force disconnect any device remotely",
                "Full audit logs and security tracking",
                "IP blocklist and security controls",
                "API key management and rate limiting",
                "System-wide feature enable/disable",
              ].map((feature, idx) => (
                <li key={idx} className="flex items-start gap-3 group/item">
                  <Shield className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5 group-hover/item:scale-110 transition-transform" />
                  <span className="text-muted-foreground group-hover/item:text-foreground transition-colors">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="bg-gradient-to-r from-card to-accent/20 border border-border rounded-2xl p-12 lg:p-16 text-center hover:border-foreground/20 transition-all">
          <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
            Ready to get started?
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
            Join enterprise teams that trust DeviceGuard for secure device management
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard">
              <Button
                size="lg"
                className="bg-foreground hover:bg-foreground/90 text-background px-8 h-14 text-base rounded-full gap-2 group transition-all hover:shadow-xl"
              >
                Launch Dashboard
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="border-border hover:bg-accent/10 px-8 h-14 text-base rounded-full"
            >
              Contact Sales
            </Button>
          </div>
        </div>
      </section>

      {/* Performance Metrics */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
            Trusted by Enterprise Teams
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            DeviceGuard powers device management for thousands of companies worldwide
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { number: "10K+", label: "Devices Managed", icon: Smartphone },
            { number: "99.9%", label: "Uptime SLA", icon: Cloud },
            { number: "50+", label: "Enterprise Clients", icon: Globe },
          ].map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div
                key={idx}
                className={`text-center p-8 bg-card border border-border rounded-xl hover:border-foreground/20 transition-all opacity-0 animate-[fadeInUp_0.6s_ease-out_forwards]`}
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 bg-accent rounded-xl flex items-center justify-center">
                    <Icon className="w-8 h-8 text-foreground" />
                  </div>
                </div>
                <p className="text-4xl font-display font-semibold mb-2">{stat.number}</p>
                <p className="text-muted-foreground">{stat.label}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
            Get Started in Minutes
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Simple setup process to get your devices managed
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { step: 1, title: "Create Account", description: "Sign up and set up your workspace", icon: Users },
            { step: 2, title: "Install Agent", description: "Deploy the agent on your devices", icon: Cpu },
            { step: 3, title: "Configure", description: "Set policies and permissions", icon: Shield },
            { step: 4, title: "Monitor", description: "Start managing in real-time", icon: TrendingUp },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <div key={idx} className="relative opacity-0 animate-[fadeInUp_0.6s_ease-out_forwards]" style={{ animationDelay: `${idx * 100}ms` }}>
                <div className="absolute -top-8 left-0 right-0 text-center">
                  <span className="inline-flex w-10 h-10 items-center justify-center rounded-full bg-foreground text-background font-display font-semibold">
                    {item.step}
                  </span>
                </div>
                <div className="p-8 bg-card border border-border rounded-xl hover:border-foreground/20 transition-all mt-4">
                  <Icon className="w-8 h-8 mb-4 text-accent" />
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                {idx < 3 && (
                  <div className="hidden md:block absolute right top-12 w-6 h-0.5 bg-border" />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Security Highlights */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
            Security You Can Trust
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Enterprise-grade security standards and compliance certifications
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { title: "End-to-End Encryption", desc: "All data encrypted in transit and at rest", icon: Lock },
            { title: "Zero Trust Architecture", desc: "Verify every access request", icon: Shield },
            { title: "Real-time Monitoring", desc: "Continuous threat detection and response", icon: AlertCircle },
            { title: "Compliance Ready", desc: "GDPR, HIPAA, SOC 2 Type II certified", icon: Check },
            { title: "Network Isolation", desc: "Secure VPN and IP whitelisting", icon: Wifi },
            { title: "Audit Logs", desc: "Complete activity tracking and reporting", icon: Cloud },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className={`p-8 bg-card border border-border rounded-xl hover:border-foreground/20 transition-all opacity-0 animate-[fadeInUp_0.6s_ease-out_forwards]`}
                style={{ animationDelay: `${idx * 80}ms` }}
              >
                <Icon className="w-8 h-8 text-accent mb-4" />
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-4xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="space-y-4">
          {[
            { q: "What devices are supported?", a: "DeviceGuard supports Android 8.0 and above, with plans for iOS support in Q3 2025." },
            { q: "How much does it cost?", a: "Flexible pricing starting from $99/month for up to 100 devices. Enterprise plans available." },
            { q: "Can I integrate with existing tools?", a: "Yes, we support integration with major MDM solutions, SIEM platforms, and ticketing systems." },
            { q: "What's the setup time?", a: "Most deployments are up and running within 30 minutes of agent installation." },
          ].map((faq, idx) => (
            <details
              key={idx}
              className="p-6 bg-card border border-border rounded-xl hover:border-foreground/20 transition-all group cursor-pointer"
            >
              <summary className="font-semibold flex items-center justify-between">
                {faq.q}
                <ArrowRight className="w-4 h-4 group-open:rotate-90 transition-transform" />
              </summary>
              <p className="text-muted-foreground mt-4">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 py-20 lg:py-32 border-t border-border">
        <div className="relative bg-gradient-to-br from-card via-accent/10 to-background border border-border rounded-3xl p-12 lg:p-20 text-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-foreground/0 via-foreground/5 to-foreground/0 pointer-events-none" />
          <div className="relative z-10">
            <h2 className="text-4xl lg:text-5xl font-display tracking-tight mb-6">
              Transform Your Device Management Today
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-12">
              Join hundreds of enterprises already using DeviceGuard to secure and manage their mobile infrastructure.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/dashboard">
                <Button
                  size="lg"
                  className="bg-foreground hover:bg-foreground/90 text-background px-8 h-14 text-base rounded-full gap-2 group transition-all hover:shadow-xl"
                >
                  Start Free Trial
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="border-border hover:bg-accent/10 px-8 h-14 text-base rounded-full"
              >
                Schedule Demo
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border mt-12">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <ZenvoraLogo />
                <span className="font-display font-semibold">Zenvora</span>
              </div>
              <p className="text-sm text-muted-foreground">Enterprise Mobile Device Management Platform</p>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">About</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Privacy</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Terms</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Support</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">© 2025 DeviceGuard. All rights reserved.</p>
            <p className="text-sm text-muted-foreground">Enterprise-grade security & management</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
