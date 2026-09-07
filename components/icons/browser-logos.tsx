import React from "react";

export function ChromeLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="20" fill="#EA4335" />
      <path
        d="M24 14.5C29.2467 14.5 33.5 18.7533 33.5 24C33.5 25.1 33.31 26.15 32.96 27.13L21.32 7.02C22.19 6.84 23.08 6.75 24 6.75C31.54 6.75 37.93 11.64 40.23 18.45L27.65 18.45C26.68 16.09 24.38 14.5 24 14.5Z"
        fill="#FBBC05"
      />
      <path
        d="M24 33.5C20.08 33.5 16.73 30.98 15.42 27.42L5.89 10.95C4.07 14.65 3 18.84 3 23.25C3 34.02 11.23 42.87 21.73 43.68L28.18 32.55C26.85 33.16 25.46 33.5 24 33.5Z"
        fill="#34A853"
      />
      <circle cx="24" cy="24" r="9.5" fill="#FFFFFF" />
      <circle cx="24" cy="24" r="7.5" fill="#4285F4" />
    </svg>
  );
}

export function EdgeLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M40.8 33.1C39.4 39.4 33.2 44 26 44C16.1 44 8 35.9 8 26C8 16.1 16.1 8 26 8C27.9 8 29.8 8.3 31.5 8.9C29.2 11.1 27.8 14.2 27.8 17.6C27.8 23.2 32.4 27.8 38 27.8C39.1 27.8 40.1 27.6 41.1 27.2C41 29.2 40.9 31.2 40.8 33.1Z"
        fill="url(#edge-grad-1)"
      />
      <path
        d="M26 8C23.1 8 20.3 8.8 18 10.2C22.6 12.1 25.8 16.7 25.8 22C25.8 28.6 20.4 34 13.8 34C10.7 34 7.9 32.8 5.8 30.9C6.4 37.8 12.1 43.2 19.2 43.2C23.9 43.2 28.1 41.2 31 38C26.1 37.5 22.2 33.4 22.2 28.4C22.2 24.3 24.7 20.8 28.3 19.4C30.2 14.8 32.6 11.2 26 8Z"
        fill="url(#edge-grad-2)"
      />
      <defs>
        <linearGradient id="edge-grad-1" x1="8" y1="8" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0C8DE4" />
          <stop offset="0.5" stopColor="#14B0F7" />
          <stop offset="1" stopColor="#0FD8A8" />
        </linearGradient>
        <linearGradient id="edge-grad-2" x1="5" y1="10" x2="35" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0B55A4" />
          <stop offset="1" stopColor="#00A88E" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BraveLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M39.6 14.4L33.2 7.2C32.4 6.3 31.2 5.8 30 5.8H18C16.8 5.8 15.6 6.3 14.8 7.2L8.4 14.4C7.5 15.4 7.1 16.8 7.3 18.2L9.4 32.2C9.7 34.3 11 36.1 12.9 37L22.2 41.5C23.3 42 24.7 42 25.8 41.5L35.1 37C37 36.1 38.3 34.3 38.6 32.2L40.7 18.2C40.9 16.8 40.5 15.4 39.6 14.4Z"
        fill="#FF2000"
      />
      <path
        d="M24 11L15 17L17 28L24 35L31 28L33 17L24 11Z"
        fill="#FB542B"
      />
      <path
        d="M24 18L19 22L21 28L24 30L27 28L29 22L24 18Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function FirefoxLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="19" fill="url(#ff-grad-1)" />
      <path
        d="M38.2 16.5C36.8 12.3 33.1 9.2 28.7 8.3C32.2 11.1 33.9 15.2 33 19.5C32.1 23.7 28.5 26.9 24.2 27.2C19.3 27.6 15 23.9 14.6 19C14.3 15.7 15.8 12.7 18.2 10.8C11.5 12.9 6.8 19.1 6.8 26.5C6.8 35.6 14.2 43 23.3 43C32.4 43 39.8 35.6 39.8 26.5C39.8 22.9 39.2 19.5 38.2 16.5Z"
        fill="url(#ff-grad-2)"
      />
      <path
        d="M27 15C27 19.4 23.4 23 19 23C16.8 23 14.8 22.1 13.4 20.6C12.5 22.3 12 24.3 12 26.4C12 33 17.4 38.4 24 38.4C30.6 38.4 36 33 36 26.4C36 20.7 32 16 27 15Z"
        fill="#FFD200"
      />
      <defs>
        <linearGradient id="ff-grad-1" x1="5" y1="5" x2="43" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF7A00" />
          <stop offset="0.5" stopColor="#FF2A00" />
          <stop offset="1" stopColor="#8000FF" />
        </linearGradient>
        <linearGradient id="ff-grad-2" x1="10" y1="10" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFDB00" />
          <stop offset="0.6" stopColor="#FF4A00" />
          <stop offset="1" stopColor="#B300FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function OperaLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M24 6C13.5 6 5 14.1 5 24C5 33.9 13.5 42 24 42C34.5 42 43 33.9 43 24C43 14.1 34.5 6 24 6ZM24 37C18.5 37 14.5 31.2 14.5 24C14.5 16.8 18.5 11 24 11C29.5 11 33.5 16.8 33.5 24C33.5 31.2 29.5 37 24 37Z"
        fill="url(#opera-grad)"
      />
      <defs>
        <linearGradient id="opera-grad" x1="5" y1="6" x2="43" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF1B2D" />
          <stop offset="1" stopColor="#A70010" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function OperaGxLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#141416" />
      <path
        d="M24 8C15.2 8 8 15.2 8 24C8 32.8 15.2 40 24 40C32.8 40 40 32.8 40 24C40 15.2 32.8 8 24 8ZM24 35C19 35 15.5 30 15.5 24C15.5 18 19 13 24 13C29 13 32.5 18 32.5 24C32.5 30 29 35 24 35Z"
        fill="#FA1E4E"
      />
      <circle cx="36" cy="12" r="3" fill="#FA1E4E" />
    </svg>
  );
}

export function VivaldiLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="12" fill="#EF3939" />
      <path
        d="M17.5 14C15.6 14 14 15.6 14 17.5C14 18.2 14.2 18.8 14.6 19.4L21.8 32.4C22.6 33.8 24.1 34.6 25.7 34.4C27.2 34.2 28.5 33.1 29.1 31.6L34.6 18C34.8 17.5 35 16.9 35 16.3C35 14.5 33.5 13 31.7 13C30.3 13 29.1 13.9 28.6 15.2L24.8 25.2L20.2 15C19.7 14.4 18.7 14 17.5 14Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function SafariLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="20" fill="url(#safari-grad)" />
      <circle cx="24" cy="24" r="18" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.5" />
      <path d="M24 7V9M24 39V41M7 24H9M39 24H41" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <polygon points="34,14 26,22 22,26 14,34 22,26 26,22" fill="#EA4335" />
      <polygon points="14,34 22,26 26,22 34,14 26,22 22,26" fill="#FFFFFF" />
      <circle cx="24" cy="24" r="2" fill="#1E3A8A" />
      <defs>
        <linearGradient id="safari-grad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00C6FF" />
          <stop offset="1" stopColor="#0072FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function GenericBrowserLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function BrowserLogo({ browser, className = "w-4 h-4" }: { browser: string; className?: string }) {
  const b = String(browser || "").toLowerCase();
  if (b.includes("chrome")) return <ChromeLogo className={className} />;
  if (b.includes("edge")) return <EdgeLogo className={className} />;
  if (b.includes("brave")) return <BraveLogo className={className} />;
  if (b.includes("firefox")) return <FirefoxLogo className={className} />;
  if (b.includes("opera gx") || b.includes("operagx")) return <OperaGxLogo className={className} />;
  if (b.includes("opera")) return <OperaLogo className={className} />;
  if (b.includes("vivaldi")) return <VivaldiLogo className={className} />;
  if (b.includes("safari")) return <SafariLogo className={className} />;
  return <GenericBrowserLogo className={className} />;
}
