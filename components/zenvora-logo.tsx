"use client";

type ZenvoraLogoProps = {
  className?: string;
};

export function ZenvoraLogo({ className }: ZenvoraLogoProps) {
  return (
    <div className={`relative flex items-center justify-center ${className ?? "w-12 h-12"}`}>
      {/* Animated WiFi rings */}
      <svg
        className="w-full h-full"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ring - slowest */}
        <circle
          cx="50"
          cy="50"
          r="45"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.3"
          className="animate-[pulse_3s_ease-in-out_infinite]"
        />
        
        {/* Middle ring - medium */}
        <circle
          cx="50"
          cy="50"
          r="35"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.5"
          className="animate-[pulse_2s_ease-in-out_infinite] delay-100"
        />
        
        {/* Inner ring - fastest */}
        <circle
          cx="50"
          cy="50"
          r="25"
          stroke="currentColor"
          strokeWidth="2.5"
          opacity="0.8"
          className="animate-[pulse_1s_ease-in-out_infinite] delay-200"
        />
        
        {/* Center dot */}
        <circle
          cx="50"
          cy="50"
          r="8"
          fill="currentColor"
          className="animate-[pulse_1.5s_ease-in-out_infinite]"
        />
      </svg>
    </div>
  );
}
