"use client";

import React from "react";
import { ZenvoraLogo } from "./zenvora-logo";

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="min-hscreen w-full bg-background flex font-sans overflow-hidden relative h-[95vh]">
      {/* Visual Side (Left) - Displaying the user's custom animated card */}
      <div className="hidden lg:flex lg:w-1/2 bg-muted/30 relative items-center justify-center  overflow-hidden select-none border-r border-border/10">

        {/* User Custom Animated Logo Display Component */}
        <div className="transition-all duration-700 delay-500 opacity-100 translate-y-0 h-[100%] w-full max-w-full">
          <div className="relative h-[100%] w-full from-card via-sidebar">
            {/* Ambient blur blobs */}
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-0 left-1/4 w-72 h-72 bg-foreground/20 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
              <div className="absolute top-0 right-1/4 w-72 h-72 bg-accent/20 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
              <div className="absolute -bottom-8 left-1/2 w-72 h-72 bg-foreground/10 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
            </div>

            {/* Pattern Grid */}
            <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
              <defs>
                <pattern id="layout-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5"></path>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#layout-grid)"></rect>
            </svg>

            {/* 3D Orbit & Rotating Elements */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-64 h-64 sm:w-80 sm:h-80">
                {/* 3D Spin Outer Ring */}
                <div
                  className="absolute inset-0 rounded-full border-2 border-transparent border-t-foreground border-r-accent/50 animate-spin"
                  style={{ animationDuration: "8s" }}
                ></div>

                {/* 3D Spin Middle Ring */}
                <div
                  className="absolute inset-8 rounded-full border-2 border-transparent border-b-foreground border-l-accent/50 animate-spin"
                  style={{ animationDuration: "6s", animationDirection: "reverse" }}
                ></div>

                {/* Pulsing inner glow */}
                <div className="absolute inset-16 rounded-full border border-accent/30 animate-pulse"></div>

                {/* Glowing Concentric Logo */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="scale-150 text-foreground opacity-80">
                    <div className="relative w-12 h-12 flex items-center justify-center">
                      <svg className="w-full h-full" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="2" opacity="0.3" className="animate-[pulse_3s_ease-in-out_infinite]"></circle>
                        <circle cx="50" cy="50" r="35" stroke="currentColor" strokeWidth={2} opacity="0.5" className="animate-[pulse_2s_ease-in-out_infinite] delay-100"></circle>
                        <circle cx="50" cy="50" r="25" stroke="currentColor" strokeWidth={2.5} opacity="0.8" className="animate-[pulse_1s_ease-in-out_infinite] delay-200"></circle>
                        <circle cx="50" cy="50" r="8" fill="currentColor" className="animate-[pulse_1.5s_ease-in-out_infinite]"></circle>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Satellite dots */}
                <div className="absolute inset-0 animate-spin" style={{ animationDuration: "20s" }}>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-accent rounded-full"></div>
                </div>
                <div className="absolute inset-0 animate-spin" style={{ animationDuration: "20s", animationDirection: "reverse" }}>
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-accent/60 rounded-full"></div>
                </div>
              </div>
            </div>

            {/* Bottom banner details */}
            <div className="absolute bottom-0 left-0 right-0 pt-6 sm:p8 bg-gradient-to-t from-background via-background/80 to-transparent">
              <p className="text-sm sm:text-base font-semibold text-foreground text-center mb-2">Enterprise Device Management</p>
              <p className="text-xs sm:text-sm text-muted-foreground text-center">Real-time monitoring, security controls &amp; seamless device management</p>
            </div>
          </div>
        </div>

      </div>

      {/* Form Side (Right) */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 md:p-16 relative bg-background">

        {/* Mobile top logo */}
        <div className="lg:hidden absolute top-8 left-8 flex items-center gap-2">
          <div className="text-foreground scale-75">
            <ZenvoraLogo />
          </div>
          <span className="font-display text-lg tracking-tight text-foreground font-semibold">Zenvora</span>
        </div>

        <div className="w-full max-m space-y-8 animate-fadeIn">
          {/* Header text */}
          <div className="space-y-2">
            <h2 className="text-3xl font-display font-medium text-foreground tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground font-sans">{subtitle}</p>
          </div>

          {/* Form slot */}
          {children}
        </div>
      </div>
    </div>
  );
}
